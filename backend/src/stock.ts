// What "available" means, and the product-row locks that stop two sales of the same unit.
//
// Available = physical stock minus units that are still spoken for:
//   - a pending order whose hold has not expired
//   - a paid order that has not been picked up
//   - a needs_review order that kept its hold (the amount was wrong, but the snack is still theirs)
//
// Paid orders are included on purpose. The brief's wording is "unpaid orders", but if a paid
// order stopped counting, the next customer could buy the same unit before the locker opened.
import type { DbClient } from './db'

export const HELD_ORDER_SQL =
  "(o.stock_held = true AND NOT (o.status = 'pending' AND o.hold_expires_at <= now()))"

// Always lock product ids in ascending order. Two checkouts that need the same products
// then wait in line instead of deadlocking (each holding one row and waiting for the other).
export async function lockProducts(client: DbClient, productIds: number[]): Promise<void> {
  const ids = [...new Set(productIds)].sort((left, right) => left - right)
  for (const id of ids) {
    await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id])
  }
}

// excludeOrderId is for a late payment re-checking its own lines. Those units must not
// count as "taken by someone else".
export async function availableUnits(
  client: DbClient,
  productId: number,
  excludeOrderId?: string,
): Promise<number> {
  const result = await client.query<{ available: number | null }>(
    `SELECT (
       p.stock - COALESCE((
         SELECT SUM(oi.quantity)::int
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = p.id
           AND ${HELD_ORDER_SQL}
           AND ($2::uuid IS NULL OR o.id <> $2::uuid)
       ), 0)
     )::int AS available
     FROM products p
     WHERE p.id = $1`,
    [productId, excludeOrderId ?? null],
  )

  if ((result.rowCount ?? 0) === 0) return 0
  return Number(result.rows[0]?.available ?? 0)
}
