// Payment webhook: signature is checked in app.ts before this runs.
//
// Late payment (a valid capture after the hold expired):
// If every line is still on the shelf, take the payment and hold the units again.
// If another customer already has them, mark needs_review and do not take their units.
// A wrong amount is never treated as paid. During a live hold the units stay held so a
// person can still hand the snack over. After the hold, a wrong amount holds nothing.
import type { DbClient } from './db'
import { withTransaction } from './db'
import { HttpError } from './errors'
import { isUuid } from './ids'
import { availableUnits, lockProducts } from './stock'
import type { OrderStatus } from './types'

export type WebhookResult = {
  ok: true
  duplicate: boolean
  orderId: string
  orderStatus: OrderStatus | string
}

type WebhookBody = {
  eventId: string
  orderId: string
  amountPaise: number
  status: 'captured'
}

type LockedOrder = {
  id: string
  status: string
  total_paise: number
  stock_held: boolean
  hold_elapsed: boolean
}

function parseWebhook(raw: Buffer): WebhookBody {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Invalid JSON')
  }

  const body = parsed as Record<string, unknown>
  if (typeof body.eventId !== 'string' || body.eventId.trim() === '') {
    throw new HttpError(400, 'eventId is required')
  }
  if (typeof body.orderId !== 'string' || !isUuid(body.orderId)) {
    throw new HttpError(400, 'orderId must be a uuid')
  }
  if (typeof body.amountPaise !== 'number' || !Number.isInteger(body.amountPaise) || body.amountPaise < 0) {
    throw new HttpError(400, 'amountPaise must be a whole number of paise')
  }
  if (body.status !== 'captured') {
    throw new HttpError(422, 'Only captured payments are accepted')
  }

  return {
    eventId: body.eventId,
    orderId: body.orderId,
    amountPaise: body.amountPaise,
    status: 'captured',
  }
}

async function reserveForLatePayment(client: DbClient, orderId: string): Promise<boolean> {
  const items = await client.query<{ product_id: number; quantity: number }>(
    `SELECT product_id, quantity
     FROM order_items
     WHERE order_id = $1
     ORDER BY product_id`,
    [orderId],
  )

  await lockProducts(
    client,
    items.rows.map((item) => item.product_id),
  )

  for (const item of items.rows) {
    const available = await availableUnits(client, item.product_id, orderId)
    if (available < item.quantity) return false
  }
  return true
}

export async function processWebhook(raw: Buffer): Promise<WebhookResult> {
  const body = parseWebhook(raw)

  return withTransaction(async (client) => {
    const existing = await client.query<LockedOrder>(
      `SELECT
         id,
         status,
         total_paise,
         stock_held,
         (hold_expires_at <= now()) AS hold_elapsed
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [body.orderId],
    )
    const order = existing.rows[0]
    if (!order) throw new HttpError(404, 'Order not found')

    // The first insert wins. A replay of this eventId changes nothing, including a replay
    // that arrives while the first one is still in its transaction.
    const inserted = await client.query(
      `INSERT INTO payment_events (event_id, order_id, amount_paise, provider_status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [body.eventId, body.orderId, body.amountPaise, body.status],
    )
    if ((inserted.rowCount ?? 0) === 0) {
      return { ok: true, duplicate: true, orderId: order.id, orderStatus: order.status }
    }

    if (order.status === 'paid' || order.status === 'picked_up' || order.status === 'needs_review') {
      return { ok: true, duplicate: false, orderId: order.id, orderStatus: order.status }
    }

    const holdActive = order.status === 'pending' && order.hold_elapsed === false

    if (order.total_paise !== body.amountPaise) {
      await client.query(
        `UPDATE orders
         SET status = 'needs_review', stock_held = $2
         WHERE id = $1`,
        [order.id, holdActive],
      )
      return { ok: true, duplicate: false, orderId: order.id, orderStatus: 'needs_review' }
    }

    if (holdActive) {
      await client.query(
        `UPDATE orders
         SET status = 'paid', stock_held = true, paid_at = now()
         WHERE id = $1`,
        [order.id],
      )
      return { ok: true, duplicate: false, orderId: order.id, orderStatus: 'paid' }
    }

    const reserved = await reserveForLatePayment(client, order.id)
    if (reserved) {
      await client.query(
        `UPDATE orders
         SET status = 'paid', stock_held = true, paid_at = now()
         WHERE id = $1`,
        [order.id],
      )
      return { ok: true, duplicate: false, orderId: order.id, orderStatus: 'paid' }
    }

    await client.query(
      `UPDATE orders
       SET status = 'needs_review', stock_held = false
       WHERE id = $1`,
      [order.id],
    )
    return { ok: true, duplicate: false, orderId: order.id, orderStatus: 'needs_review' }
  })
}
