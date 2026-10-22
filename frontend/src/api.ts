// Every call the screen makes. The base URL is http://localhost:3001 unless VITE_API_URL is set.

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export type Product = {
  id: number
  name: string
  pricePaise: number
  stock: number
  availableUnits: number
}

export type OrderItem = {
  productId: number
  name: string
  quantity: number
  unitPricePaise: number
}

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'needs_review' | 'picked_up'

export type Order = {
  id: string
  status: OrderStatus
  totalPaise: number
  expiresInSeconds: number
  serverNow: string
  holdExpiresAt: string
  items: OrderItem[]
}

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; details?: unknown }
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? 'Request failed', body.details)
  }
  return body as T
}

function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, { cache: 'no-store', ...init })
}

export function listProducts(): Promise<Product[]> {
  return request('/products').then((response) => readJson<Product[]>(response))
}

export function placeOrder(items: Array<{ productId: number; quantity: number }>): Promise<Order> {
  return request('/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  }).then((response) => readJson<Order>(response))
}

export function listOrders(): Promise<Order[]> {
  return request('/orders').then((response) => readJson<Order[]>(response))
}

export function getOrder(orderId: string): Promise<Order> {
  return request(`/orders/${orderId}`).then((response) => readJson<Order>(response))
}

export function simulatePayment(orderId: string): Promise<{ orderStatus: string }> {
  return request(`/demo/pay/${orderId}`, { method: 'POST' }).then((response) =>
    readJson<{ orderStatus: string }>(response),
  )
}

export function claimPickup(orderId: string): Promise<Order> {
  return request(`/orders/${orderId}/pickup-claim`, { method: 'POST' }).then((response) =>
    readJson<Order>(response),
  )
}
