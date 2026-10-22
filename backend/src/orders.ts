// Creating an order, reading it, expiring a hold, and claiming pickup.
// The stock rule itself lives in stock.ts. The HTTP status codes live in app.ts.
import type { DbClient } from './db'
import { withTransaction } from './db'
import { HttpError } from './errors'
import { isUuid } from './ids'
import { availableUnits, lockProducts } from './stock'
import { config } from './config'
import { asOrderStatus, type OrderStatus, type OrderView } from './types'

type OrderItemInput = {
  productId: number
  quantity: number
}

type OrderRow = {
  id: string
  status: string
  total_paise: number
  hold_expires_at: Date
  server_now: Date
  expires_in_seconds: number
}

type ItemRow = {
  product_id: number
  name: string
  quantity: number
  unit_price_paise: number
}

type ProductRow = {
  id: number
  name: string
  price_paise: number
  stock: number
}

export function parseOrderItems(body: unknown): OrderItemInput[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be { items: [{ productId, quantity }] }')
  }

  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Add at least one item')
  }
  if (items.length > 20) {
    throw new HttpError(400, 'Too many lines')
  }

  const merged = new Map<number, number>()
  for (const line of items) {
    if (!line || typeof line !== 'object') {
      throw new HttpError(400, 'Each item needs a productId and a quantity')
    }
    const productId = (line as { productId?: unknown }).productId
    const quantity = (line as { quantity?: unknown }).quantity
    if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) {
      throw new HttpError(400, 'productId must be a positive whole number')
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
      throw new HttpError(400, 'quantity must be a whole number from 1 to 100')
    }
    merged.set(productId, (merged.get(productId) ?? 0) + quantity)
  }

  for (const quantity of merged.values()) {
    if (quantity > 100) {
      throw new HttpError(400, 'quantity must be a whole number from 1 to 100')
    }
  }

  return [...merged.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId - right.productId)
}

export async function expireHolds(client: DbClient): Promise<void> {
  await client.query(
    `UPDATE orders
     SET status = 'expired', stock_held = false
     WHERE status = 'pending' AND hold_expires_at <= now()`,
  )
}

export async function expireDueHolds(): Promise<void> {
  await withTransaction((client) => expireHolds(client))
}

async function loadOrder(client: DbClient, orderId: string): Promise<OrderView | null> {
  const orderResult = await client.query<OrderRow>(
    `SELECT
       id,
       status,
       total_paise,
       hold_expires_at,
       now() AS server_now,
       CASE
         WHEN status = 'pending' AND hold_expires_at > now()
         THEN CEIL(EXTRACT(EPOCH FROM (hold_expires_at - now())))::int
         ELSE 0
       END AS expires_in_seconds
     FROM orders
     WHERE id = $1`,
    [orderId],
  )
  const order = orderResult.rows[0]
  if (!order) return null

  const itemsResult = await client.query<ItemRow>(
    `SELECT oi.product_id, p.name, oi.quantity, oi.unit_price_paise
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.product_id`,
    [orderId],
  )

  return toOrderView(order, itemsResult.rows)
}

function toOrderView(order: OrderRow, items: ItemRow[]): OrderView {
  return {
    id: order.id,
    status: asOrderStatus(order.status),
    totalPaise: order.total_paise,
    expiresInSeconds: Number(order.expires_in_seconds),
    serverNow: order.server_now.toISOString(),
    holdExpiresAt: order.hold_expires_at.toISOString(),
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.name,
      quantity: item.quantity,
      unitPricePaise: item.unit_price_paise,
    })),
  }
}

export async function listOrders(): Promise<OrderView[]> {
  return withTransaction(async (client) => {
    await expireHolds(client)

    const orderResult = await client.query<OrderRow>(
      `SELECT
         id,
         status,
         total_paise,
         hold_expires_at,
         now() AS server_now,
         CASE
           WHEN status = 'pending' AND hold_expires_at > now()
           THEN CEIL(EXTRACT(EPOCH FROM (hold_expires_at - now())))::int
           ELSE 0
         END AS expires_in_seconds
       FROM orders
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    if (orderResult.rows.length === 0) return []

    const itemsResult = await client.query<ItemRow & { order_id: string }>(
      `SELECT oi.order_id, oi.product_id, p.name, oi.quantity, oi.unit_price_paise
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ANY($1::uuid[])
       ORDER BY oi.product_id`,
      [orderResult.rows.map((order) => order.id)],
    )

    const itemsByOrder = new Map<string, ItemRow[]>()
    for (const item of itemsResult.rows) {
      const lines = itemsByOrder.get(item.order_id) ?? []
      lines.push(item)
      itemsByOrder.set(item.order_id, lines)
    }

    return orderResult.rows.map((order) => toOrderView(order, itemsByOrder.get(order.id) ?? []))
  })
}

export async function getOrder(orderId: string): Promise<OrderView | null> {
  if (!isUuid(orderId)) throw new HttpError(400, 'Order id must be a uuid')

  return withTransaction(async (client) => {
    await expireHolds(client)
    return loadOrder(client, orderId)
  })
}

export async function createOrder(body: unknown): Promise<OrderView> {
  const items = parseOrderItems(body)

  return withTransaction(async (client) => {
    await expireHolds(client)

    const ids = items.map((item) => item.productId)
    // Other checkouts that need these products wait until this transaction commits.
    await lockProducts(client, ids)

    const products = await client.query<ProductRow>(
      `SELECT id, name, price_paise, stock
       FROM products
       WHERE id = ANY($1::int[])`,
      [ids],
    )
    if ((products.rowCount ?? 0) !== ids.length) {
      const found = new Set(products.rows.map((row) => row.id))
      const missing = ids.filter((id) => !found.has(id))
      throw new HttpError(400, 'Unknown product', { productIds: missing })
    }

    const byId = new Map(products.rows.map((row) => [row.id, row]))
    const shortages: Array<{ productId: number; name: string; requested: number; available: number }> = []

    for (const item of items) {
      const available = await availableUnits(client, item.productId)
      if (available < item.quantity) {
        const product = byId.get(item.productId)
        shortages.push({
          productId: item.productId,
          name: product?.name ?? 'Unknown',
          requested: item.quantity,
          available,
        })
      }
    }

    // Nothing is inserted unless every line fits. The rollback releases the locks.
    if (shortages.length > 0) {
      throw new HttpError(409, 'Not enough stock', shortages)
    }

    let totalPaise = 0
    for (const item of items) {
      const pricePaise = byId.get(item.productId)?.price_paise ?? 0
      const linePaise = pricePaise * item.quantity
      if (!Number.isSafeInteger(linePaise) || !Number.isSafeInteger(totalPaise + linePaise)) {
        throw new HttpError(400, 'Order total is too large')
      }
      totalPaise += linePaise
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO orders (total_paise, hold_expires_at, stock_held)
       VALUES ($1, now() + ($2 * interval '1 second'), true)
       RETURNING id`,
      [totalPaise, config.holdSeconds],
    )
    const orderId = inserted.rows[0]?.id
    if (!orderId) throw new HttpError(500, 'Order was not created')

    for (const item of items) {
      const pricePaise = byId.get(item.productId)?.price_paise ?? 0
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4)`,
        [orderId, item.productId, item.quantity, pricePaise],
      )
    }

    const order = await loadOrder(client, orderId)
    if (!order) throw new HttpError(500, 'Order was not created')
    return order
  })
}

async function rejectPickup(client: DbClient, orderId: string): Promise<never> {
  const current = await client.query<{ status: string }>(
    'SELECT status FROM orders WHERE id = $1',
    [orderId],
  )
  if ((current.rowCount ?? 0) === 0) throw new HttpError(404, 'Order not found')

  const status = current.rows[0]?.status
  if (status === 'picked_up') throw new HttpError(409, 'Pickup already claimed')
  throw new HttpError(409, 'Order cannot be picked up', { status })
}

export async function claimPickup(orderId: string): Promise<OrderView> {
  if (!isUuid(orderId)) throw new HttpError(400, 'Order id must be a uuid')

  return withTransaction(async (client) => {
    // Two lockers can run this together. Only the update that still sees status = paid
    // changes a row. The other waits, then sees the new status and gets a conflict.
    const updated = await client.query<{ id: string }>(
      `UPDATE orders
       SET status = 'picked_up', stock_held = false, picked_up_at = now()
       WHERE id = $1 AND status = 'paid'
       RETURNING id`,
      [orderId],
    )

    if ((updated.rowCount ?? 0) === 0) {
      return rejectPickup(client, orderId)
    }

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
      const reduced = await client.query(
        `UPDATE products
         SET stock = stock - $2
         WHERE id = $1 AND stock >= $2
         RETURNING stock`,
        [item.product_id, item.quantity],
      )
      if ((reduced.rowCount ?? 0) === 0) {
        throw new HttpError(409, 'Stock could not be reduced')
      }
    }

    const order = await loadOrder(client, orderId)
    if (!order) throw new HttpError(404, 'Order not found')
    return order
  })
}

export type { OrderStatus }
