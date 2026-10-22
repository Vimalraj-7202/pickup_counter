// Process entry: wait for Postgres, create tables, seed snacks, listen.
import { createApp } from './app'
import { config } from './config'
import { closePool, migrate, seedIfEmpty, waitForDatabase } from './db'
import { ensureLocalDatabase, stopLocalDatabase } from './local-db'
import { expireDueHolds } from './orders'

async function main(): Promise<void> {
  await ensureLocalDatabase()
  await waitForDatabase()
  await migrate()
  await seedIfEmpty()

  const server = createApp().listen(config.port, () => {
    console.log(`Pickup counter API listening on ${config.port}`)
    console.log(`Hold time is ${config.holdSeconds} seconds`)
  })
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`API is already running on port ${config.port}`)
      process.exit(0)
    }
    console.error(error)
    process.exit(1)
  })

  const timer = setInterval(() => {
    expireDueHolds().catch((error: unknown) => {
      console.error('Could not expire holds', error)
    })
  }, 5000)
  timer.unref()

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(timer)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await closePool()
    await stopLocalDatabase()
  }

  process.on('SIGINT', () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error)
        process.exit(1)
      })
  })
  process.on('SIGTERM', () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error)
        process.exit(1)
      })
  })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
