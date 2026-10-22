import type { OrderStatus } from './api'

export const statusLabel: Record<OrderStatus, string> = {
  pending: 'Waiting for payment',
  paid: 'Paid',
  expired: 'Hold expired',
  needs_review: 'Needs review',
  picked_up: 'Collected',
}

export function statusColor(status: OrderStatus): 'default' | 'success' | 'warning' {
  if (status === 'paid' || status === 'picked_up') return 'success'
  if (status === 'expired' || status === 'needs_review') return 'warning'
  return 'default'
}
