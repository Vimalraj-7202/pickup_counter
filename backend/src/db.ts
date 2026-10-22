// Connection pool, transactions, and startup SQL.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config } from './config'

export type DbClient = pg.PoolClient

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 20,
      application_name: 'pickup-counter',
      connectionTimeoutMillis: 5000,
    })
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}

export async function withTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The connection may already be unusable.
    }
    throw error
  } finally {
    client.release()
  }
}

function sqlPath(name: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', name)
}

export async function migrate(): Promise<void> {
  const schema = await readFile(sqlPath('schema.sql'), 'utf8')
  await getPool().query(schema)
}

export async function seedIfEmpty(): Promise<void> {
  const count = await getPool().query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products')
  if (count.rows[0]?.count) return
  const seed = await readFile(sqlPath('seed.sql'), 'utf8')
  await getPool().query(seed)
}

export async function waitForDatabase(): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await getPool().query('SELECT 1')
      return
    } catch (error) {
      lastError = error
      console.log(`Waiting for database (${attempt}/30)`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw lastError
}
