// Sends one correctly signed payment webhook.
//
// npm run send-webhook -- --orderId <uuid> --amountPaise 4500 --eventId evt_123
import { signBody } from '../signature'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function printUsage(): void {
  console.log(`Usage:
  npm run send-webhook -- --orderId <uuid> --amountPaise <integer> [--eventId evt_123] [--status captured] [--api http://localhost:3001]

The amount is the order total in paise. One Mango Soda from the seed data is 4500.
WEBHOOK_SECRET defaults to dev-webhook-secret.`)
}

async function main(): Promise<void> {
  const orderId = argument('orderId')
  const amountRaw = argument('amountPaise')
  if (!orderId || !amountRaw) {
    printUsage()
    process.exitCode = 1
    return
  }

  const amountPaise = Number(amountRaw)
  if (!Number.isInteger(amountPaise) || amountPaise < 0) {
    throw new Error('amountPaise must be a whole number of paise')
  }

  const payload = {
    eventId: argument('eventId') ?? `evt_${Date.now()}`,
    orderId,
    amountPaise,
    status: argument('status') ?? 'captured',
  }
  const raw = Buffer.from(JSON.stringify(payload))
  const secret = argument('secret') ?? process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret'
  const signature = signBody(raw, secret)
  const api = (argument('api') ?? process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '')

  const response = await fetch(`${api}/payments/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
    },
    body: raw,
  })
  const text = await response.text()

  console.log(`POST ${api}/payments/webhook`)
  console.log(`X-Signature: ${signature}`)
  console.log(`status: ${response.status}`)
  console.log(text)
  if (!response.ok) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
