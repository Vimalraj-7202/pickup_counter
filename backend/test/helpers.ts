// Shared setup for tests that talk to a real Postgres. They never touch the dev database.
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { createApp } from '../src/app'
import { closePool, getPool, migrate } from '../src/db'
import { signBody } from '../src/signature'

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://pickup:pickup@127.0.0.1:5432/pickup'
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://pickup:pickup@127.0.0.1:5432/pickup_test'

let server: Server | undefined
let baseUrl = ''

function assertTestDatabase(url: string): void {
  const databaseName = new URL(url).pathname
  if (databaseName !== '/pickup_test') {
    throw new Error(`Refusing to reset ${databaseName}. Tests only run against /pickup_test.`)
  }
}

export async function ensureTestDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: ADMIN_URL })
  try {
    await client.connect()
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', ['pickup_test'])
    if ((exists.rowCount ?? 0) === 0) {
      await client.query('CREATE DATABASE pickup_test')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Cannot prepare the test database. From the project root run "docker compose up -d db" first. ${message}`,
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export async function startTestApp(): Promise<void> {
  await ensureTestDatabase()
  process.env.DATABASE_URL = TEST_URL
  process.env.WEBHOOK_SECRET = 'dev-webhook-secret'
  process.env.HOLD_SECONDS = '120'
  assertTestDatabase(TEST_URL)

  await getPool().query('DROP TABLE IF EXISTS payment_events, order_items, orders, products CASCADE')
  await migrate()

  const app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server?.once('listening', () => resolve()))
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
}

export async function resetRows(): Promise<void> {
  process.env.HOLD_SECONDS = '120'
  await getPool().query(
    'TRUNCATE payment_events, order_items, orders, products RESTART IDENTITY CASCADE',
  )
}

export async function stopTestApp(): Promise<void> {
  if (server) {
    const current = server
    server = undefined
    await new Promise<void>((resolve, reject) => {
      current.close((error) => (error ? reject(error) : resolve()))
    })
  }
  await closePool()
}

type ApiResult = {
  status: number
  body: any
}

export async function request(path: string, init?: RequestInit): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body }
}

export function postOrder(items: Array<{ productId: number; quantity: number }>): Promise<ApiResult> {
  return request('/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  })
}

export function postWebhook(
  payload: { eventId: string; orderId: string; amountPaise: number; status?: string },
  signature?: string,
): Promise<ApiResult> {
  const raw = JSON.stringify({
    eventId: payload.eventId,
    orderId: payload.orderId,
    amountPaise: payload.amountPaise,
    status: payload.status ?? 'captured',
  })
  const header = signature ?? signBody(Buffer.from(raw), process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret')
  return request('/payments/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': header,
    },
    body: raw,
  })
}

export function claimPickup(orderId: string): Promise<ApiResult> {
  return request(`/orders/${orderId}/pickup-claim`, { method: 'POST' })
}

export async function insertProduct(input: {
  name: string
  pricePaise: number
  stock: number
}): Promise<number> {
  const result = await getPool().query<{ id: number }>(
    'INSERT INTO products (name, price_paise, stock) VALUES ($1, $2, $3) RETURNING id',
    [input.name, input.pricePaise, input.stock],
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error('Product was not inserted')
  return id
}

export async function one<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T> {
  const result = await getPool().query<T>(text, values)
  const row = result.rows[0]
  if (!row) throw new Error(`Expected a row from: ${text}`)
  return row
}

export async function backdateHold(orderId: string): Promise<void> {
  await getPool().query(
    `UPDATE orders SET hold_expires_at = now() - interval '5 seconds' WHERE id = $1`,
    [orderId],
  )
}
