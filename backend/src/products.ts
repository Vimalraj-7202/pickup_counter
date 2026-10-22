// Catalog for GET /products. Availability uses the same rule as checkout (stock.ts).
import { withTransaction } from './db'
import { expireHolds } from './orders'
import { HELD_ORDER_SQL } from './stock'
import type { ProductView } from './types'

type ProductRow = {
  id: number
  name: string
  price_paise: number
  stock: number
  available_units: number
}

export async function listProducts(): Promise<ProductView[]> {
  return withTransaction(async (client) => {
    await expireHolds(client)
    const result = await client.query<ProductRow>(
      `SELECT
         p.id,
         p.name,
         p.price_paise,
         p.stock,
         (p.stock - COALESCE(held.units, 0))::int AS available_units
       FROM products p
       LEFT JOIN (
         SELECT oi.product_id, SUM(oi.quantity)::int AS units
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE ${HELD_ORDER_SQL}
         GROUP BY oi.product_id
       ) held ON held.product_id = p.id
       ORDER BY p.id`,
    )

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      pricePaise: row.price_paise,
      stock: row.stock,
      availableUnits: Number(row.available_units),
    }))
  })
}
