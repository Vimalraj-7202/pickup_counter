export const ORDER_STATUSES = ['pending', 'paid', 'expired', 'needs_review', 'picked_up'] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type OrderItemView = {
  productId: number
  name: string
  quantity: number
  unitPricePaise: number
}

export type OrderView = {
  id: string
  status: OrderStatus
  totalPaise: number
  expiresInSeconds: number
  serverNow: string
  holdExpiresAt: string
  items: OrderItemView[]
}

export type ProductView = {
  id: number
  name: string
  pricePaise: number
  stock: number
  availableUnits: number
}

export function asOrderStatus(value: string): OrderStatus {
  if ((ORDER_STATUSES as readonly string[]).includes(value)) {
    return value as OrderStatus
  }
  throw new Error(`Unknown order status: ${value}`)
}
