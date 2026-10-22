import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  backdateHold,
  claimPickup,
  insertProduct,
  one,
  postOrder,
  postWebhook,
  request,
  resetRows,
  startTestApp,
  stopTestApp,
} from './helpers'

beforeAll(startTestApp)
beforeEach(resetRows)
afterAll(stopTestApp)

describe('catalog and holds', () => {
  it('returns the seconds left on the hold from the database clock', async () => {
    const productId = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 5 })

    const created = await postOrder([{ productId, quantity: 2 }])

    expect(created.status).toBe(201)
    expect(created.body.totalPaise).toBe(4000)
    expect(created.body.status).toBe('pending')
    expect(created.body.expiresInSeconds).toBeGreaterThanOrEqual(115)
    expect(created.body.expiresInSeconds).toBeLessThanOrEqual(120)
    expect(Number.isNaN(Date.parse(created.body.serverNow))).toBe(false)

    const products = await request('/products')
    expect(products.body).toEqual([
      expect.objectContaining({
        id: productId,
        pricePaise: 2000,
        stock: 5,
        availableUnits: 3,
      }),
    ])
  })

  it('prices a multi-item order in whole paise and snapshots each price', async () => {
    const chips = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 10 })
    const soda = await insertProduct({ name: 'Soda', pricePaise: 4500, stock: 10 })

    const created = await postOrder([
      { productId: soda, quantity: 1 },
      { productId: chips, quantity: 2 },
    ])

    expect(created.status).toBe(201)
    expect(created.body.totalPaise).toBe(8500)
    expect(created.body.items).toEqual([
      expect.objectContaining({ productId: chips, quantity: 2, unitPricePaise: 2000 }),
      expect.objectContaining({ productId: soda, quantity: 1, unitPricePaise: 4500 }),
    ])
  })

  it('holds nothing when one line does not have enough stock', async () => {
    const chips = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 5 })
    const soda = await insertProduct({ name: 'Soda', pricePaise: 4500, stock: 1 })

    const created = await postOrder([
      { productId: chips, quantity: 2 },
      { productId: soda, quantity: 2 },
    ])

    expect(created.status).toBe(409)
    expect(created.body.error).toBe('Not enough stock')
    const orders = await one<{ count: number }>('SELECT COUNT(*)::int AS count FROM orders')
    expect(orders.count).toBe(0)

    const products = await request('/products')
    const chipsRow = products.body.find((product: { id: number }) => product.id === chips)
    const sodaRow = products.body.find((product: { id: number }) => product.id === soda)
    expect(chipsRow.availableUnits).toBe(5)
    expect(sodaRow.availableUnits).toBe(1)
  })

  it('releases units after the hold time has passed', async () => {
    const productId = await insertProduct({ name: 'Water', pricePaise: 1000, stock: 4 })
    const created = await postOrder([{ productId, quantity: 1 }])
    await backdateHold(created.body.id)

    const products = await request('/products')
    expect(products.body[0].availableUnits).toBe(4)

    const expired = await request(`/orders/${created.body.id}`)
    expect(expired.body.status).toBe('expired')
    expect(expired.body.expiresInSeconds).toBe(0)
  })
})

describe('ten customers, two units', () => {
  it('holds exactly two units when ten customers order the last two at once', async () => {
    const productId = await insertProduct({ name: 'Last snacks', pricePaise: 1500, stock: 2 })

    const results = await Promise.all(
      Array.from({ length: 10 }, () => postOrder([{ productId, quantity: 1 }])),
    )

    const created = results.filter((result) => result.status === 201)
    const rejected = results.filter((result) => result.status === 409)
    expect(created).toHaveLength(2)
    expect(rejected).toHaveLength(8)
    for (const result of rejected) {
      expect(result.body.error).toBe('Not enough stock')
    }
    expect(results.some((result) => result.status === 500)).toBe(false)

    const stock = await one<{ stock: number; held: number; available: number }>(
      `SELECT
         p.stock,
         COALESCE(SUM(oi.quantity) FILTER (WHERE o.stock_held = true), 0)::int AS held,
         (p.stock - COALESCE(SUM(oi.quantity) FILTER (WHERE o.stock_held = true), 0))::int AS available
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id
       WHERE p.id = $1
       GROUP BY p.id`,
      [productId],
    )
    expect(stock.stock).toBe(2)
    expect(stock.held).toBe(2)
    expect(stock.available).toBe(0)

    const orders = await one<{ count: number }>('SELECT COUNT(*)::int AS count FROM orders')
    expect(orders.count).toBe(2)

    const products = await request('/products')
    expect(products.body[0].availableUnits).toBe(0)
  })

  it('does not deadlock when overlapping multi-item orders run together', async () => {
    const chips = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 2 })
    const soda = await insertProduct({ name: 'Soda', pricePaise: 4500, stock: 2 })

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        postOrder([
          { productId: chips, quantity: 1 },
          { productId: soda, quantity: 1 },
        ]),
      ),
    )

    expect(results.filter((result) => result.status === 201)).toHaveLength(2)
    expect(results.filter((result) => result.status === 409)).toHaveLength(8)
    expect(results.some((result) => result.status === 500)).toBe(false)
  })
})

describe('payment webhook', () => {
  it('rejects a webhook whose signature does not match', async () => {
    const productId = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 5 })
    const created = await postOrder([{ productId, quantity: 1 }])

    const rejected = await postWebhook(
      { eventId: 'evt_bad', orderId: created.body.id, amountPaise: 2000 },
      'not-the-signature',
    )

    expect(rejected.status).toBe(401)
    expect(rejected.body.error).toBe('Invalid signature')
    const order = await request(`/orders/${created.body.id}`)
    expect(order.body.status).toBe('pending')
    const events = await one<{ count: number }>('SELECT COUNT(*)::int AS count FROM payment_events')
    expect(events.count).toBe(0)
  })

  it('processes the same webhook event once', async () => {
    const productId = await insertProduct({ name: 'Soda', pricePaise: 4500, stock: 5 })
    const created = await postOrder([{ productId, quantity: 1 }])
    const payload = { eventId: 'evt_once', orderId: created.body.id, amountPaise: 4500 }

    const [first, second] = await Promise.all([postWebhook(payload), postWebhook(payload)])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const duplicates = [first, second].filter((result) => result.body.duplicate === true)
    expect(duplicates).toHaveLength(1)

    const order = await request(`/orders/${created.body.id}`)
    expect(order.body.status).toBe('paid')
    const events = await one<{ count: number }>('SELECT COUNT(*)::int AS count FROM payment_events')
    expect(events.count).toBe(1)

    const products = await request('/products')
    expect(products.body[0].availableUnits).toBe(4)
    expect(products.body[0].stock).toBe(5)
  })

  it('marks the order needs_review when the amount does not match and keeps the hold', async () => {
    const productId = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 5 })
    const created = await postOrder([{ productId, quantity: 2 }])

    const paid = await postWebhook({
      eventId: 'evt_wrong_amount',
      orderId: created.body.id,
      amountPaise: 2001,
    })

    expect(paid.status).toBe(200)
    expect(paid.body.orderStatus).toBe('needs_review')
    const order = await request(`/orders/${created.body.id}`)
    expect(order.body.status).toBe('needs_review')
    const products = await request('/products')
    expect(products.body[0].availableUnits).toBe(3)
  })

  it('accepts a late payment when the units are still there', async () => {
    const productId = await insertProduct({ name: 'Soda', pricePaise: 4500, stock: 1 })
    const created = await postOrder([{ productId, quantity: 1 }])
    await backdateHold(created.body.id)
    const expired = await request(`/orders/${created.body.id}`)
    expect(expired.body.status).toBe('expired')

    const paid = await postWebhook({
      eventId: 'evt_late_ok',
      orderId: created.body.id,
      amountPaise: 4500,
    })

    expect(paid.status).toBe(200)
    expect(paid.body.orderStatus).toBe('paid')
    const products = await request('/products')
    expect(products.body[0].availableUnits).toBe(0)
    expect(products.body[0].stock).toBe(1)
  })

  it('does not take units back when a late payment arrives after they were sold', async () => {
    const productId = await insertProduct({ name: 'Soda', pricePaise: 4500, stock: 1 })
    const first = await postOrder([{ productId, quantity: 1 }])
    await backdateHold(first.body.id)
    const expired = await request(`/orders/${first.body.id}`)
    expect(expired.body.status).toBe('expired')

    const second = await postOrder([{ productId, quantity: 1 }])
    expect(second.status).toBe(201)

    const late = await postWebhook({
      eventId: 'evt_late_sold',
      orderId: first.body.id,
      amountPaise: 4500,
    })

    expect(late.status).toBe(200)
    expect(late.body.orderStatus).toBe('needs_review')

    const stillHeld = await request(`/orders/${second.body.id}`)
    expect(stillHeld.body.status).toBe('pending')

    const held = await one<{ held: number; first_held: boolean }>(
      `SELECT
         COALESCE(SUM(oi.quantity) FILTER (WHERE o.stock_held = true), 0)::int AS held,
         COALESCE(BOOL_OR(o.id = $2 AND o.stock_held), false) AS first_held
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.product_id = $1`,
      [productId, first.body.id],
    )
    expect(held.held).toBe(1)
    expect(held.first_held).toBe(false)

    const products = await request('/products')
    expect(products.body[0].availableUnits).toBe(0)
    expect(products.body[0].stock).toBe(1)
  })
})

describe('pickup', () => {
  it('lets exactly one of two simultaneous pickup claims succeed', async () => {
    const productId = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 5 })
    const created = await postOrder([{ productId, quantity: 2 }])
    const paid = await postWebhook({
      eventId: 'evt_pick',
      orderId: created.body.id,
      amountPaise: 4000,
    })
    expect(paid.body.orderStatus).toBe('paid')

    const [first, second] = await Promise.all([
      claimPickup(created.body.id),
      claimPickup(created.body.id),
    ])

    const statuses = [first.status, second.status].sort((left, right) => left - right)
    expect(statuses).toEqual([200, 409])
    const winner = [first, second].find((result) => result.status === 200)
    const loser = [first, second].find((result) => result.status === 409)
    expect(winner?.body.status).toBe('picked_up')
    expect(loser?.body.error).toBe('Pickup already claimed')

    const stock = await one<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [productId])
    expect(stock.stock).toBe(3)

    const products = await request('/products')
    expect(products.body[0].availableUnits).toBe(3)
    expect(products.body[0].stock).toBe(3)
  })

  it('rejects pickup of an unpaid order without changing stock', async () => {
    const productId = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 5 })
    const created = await postOrder([{ productId, quantity: 1 }])

    const claimed = await claimPickup(created.body.id)

    expect(claimed.status).toBe(409)
    expect(claimed.body.error).toBe('Order cannot be picked up')
    const stock = await one<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [productId])
    expect(stock.stock).toBe(5)
  })

  it('rejects pickup of an expired order', async () => {
    const productId = await insertProduct({ name: 'Chips', pricePaise: 2000, stock: 5 })
    const created = await postOrder([{ productId, quantity: 1 }])
    await backdateHold(created.body.id)
    const expired = await request(`/orders/${created.body.id}`)
    expect(expired.body.status).toBe('expired')

    const claimed = await claimPickup(created.body.id)

    expect(claimed.status).toBe(409)
    const stock = await one<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [productId])
    expect(stock.stock).toBe(5)
  })
})
