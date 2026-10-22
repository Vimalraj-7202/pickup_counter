// Starts the project database when this PC has no Docker and nothing is listening on 5432.
// Docker sets DATABASE_URL to host "db", so this does nothing inside docker compose.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let databaseProcess: ChildProcess | null = null

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const finish = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(400, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export async function ensureLocalDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pickup:pickup@127.0.0.1:5432/pickup'
  const url = new URL(databaseUrl)
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return

  const port = Number(url.port || 5432)
  if (await portOpen(port)) return

  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.local-pg/start.mjs')
  if (!existsSync(script)) {
    throw new Error(
      'PostgreSQL is not running. Install Docker Desktop and run "docker compose up --build" from the project folder.',
    )
  }

  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
  databaseProcess = child

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const succeed = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const watch = (chunk: Buffer) => {
      const text = chunk.toString()
      process.stdout.write(text)
      if (text.includes('Postgres is ready') || text.includes('already running')) succeed()
    }
    child.stdout?.on('data', watch)
    child.stderr?.on('data', watch)
    child.once('exit', (code) => {
      if (code === 0) succeed()
      else fail(new Error(`Database stopped before it was ready (exit ${code ?? 'unknown'})`))
    })
    child.once('error', (error) => fail(error))
  })
}

export async function stopLocalDatabase(): Promise<void> {
  const child = databaseProcess
  databaseProcess = null
  if (!child?.pid) return

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGINT')
}
