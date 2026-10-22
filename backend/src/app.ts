// Every URL the counter exposes. Business rules are in orders.ts, payments.ts, and stock.ts.
// Change a status code or a path here.
import express, { type NextFunction, type Request, type Response } from 'express'
import { config } from './config'
import { getPool } from './db'
import { HttpError } from './errors'
import { claimPickup, createOrder, getOrder, listOrders } from './orders'
import { processWebhook } from './payments'
import { listProducts } from './products'
import { signBody, verifySignature } from './signature'

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next)
  }
}

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function sendError(error: unknown, res: Response): void {
  if (error instanceof HttpError) {
    const payload: { error: string; details?: unknown } = { error: error.message }
    if (error.details !== undefined) payload.details = error.details
    res.status(error.status).json(payload)
    return
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid JSON' })
    return
  }

  console.error(error)
  res.status(500).json({ error: 'Internal error' })
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signature')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.get(
    '/health',
    asyncRoute(async (_req, res) => {
      await getPool().query('SELECT 1')
      res.json({ ok: true })
    }),
  )

  // Raw body, registered before express.json(), because the signature is over the exact bytes.
  app.post(
    '/payments/webhook',
    express.raw({ type: '*/*', limit: '16kb' }),
    asyncRoute(async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
      if (!verifySignature(raw, req.header('x-signature'), config.webhookSecret)) {
        throw new HttpError(401, 'Invalid signature')
      }
      res.json(await processWebhook(raw))
    }),
  )

  app.use(express.json({ limit: '16kb' }))

  app.get(
    '/products',
    asyncRoute(async (_req, res) => {
      res.json(await listProducts())
    }),
  )

  app.post(
    '/orders',
    asyncRoute(async (req, res) => {
      res.status(201).json(await createOrder(req.body))
    }),
  )

  app.get(
    '/orders',
    asyncRoute(async (_req, res) => {
      res.json(await listOrders())
    }),
  )

  app.get(
    '/orders/:id',
    asyncRoute(async (req, res) => {
      const order = await getOrder(routeParam(req.params.id))
      if (!order) throw new HttpError(404, 'Order not found')
      res.json(order)
    }),
  )

  app.post(
    '/orders/:id/pickup-claim',
    asyncRoute(async (req, res) => {
      res.json(await claimPickup(routeParam(req.params.id)))
    }),
  )

  // Stand-in for the customer's UPI app. It signs a capture for the exact order total
  // and sends that through the same webhook code as the payment provider.
  app.post(
    '/demo/pay/:id',
    asyncRoute(async (req, res) => {
      const order = await getOrder(routeParam(req.params.id))
      if (!order) throw new HttpError(404, 'Order not found')
      const raw = Buffer.from(
        JSON.stringify({
          eventId: `evt_demo_${order.id}_${Date.now()}`,
          orderId: order.id,
          amountPaise: order.totalPaise,
          status: 'captured',
        }),
      )
      const signature = signBody(raw, config.webhookSecret)
      if (!verifySignature(raw, signature, config.webhookSecret)) {
        throw new HttpError(500, 'Could not sign the demo payment')
      }
      res.json(await processWebhook(raw))
    }),
  )

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendError(error, res)
  })

  return app
}
