import { useState } from 'react'
import type { Order } from './api'
import { Orders } from './Orders'
import { Payment } from './Payment'
import { Shop } from './Shop'

type Screen = { name: 'shop' } | { name: 'orders' } | { name: 'payment'; order: Order }

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'shop' })

  if (screen.name === 'payment') {
    return <Payment initialOrder={screen.order} onNewOrder={() => setScreen({ name: 'shop' })} />
  }
  if (screen.name === 'orders') {
    return (
      <Orders onBack={() => setScreen({ name: 'shop' })} onOpen={(order) => setScreen({ name: 'payment', order })} />
    )
  }
  return <Shop onOrdered={(order) => setScreen({ name: 'payment', order })} onShowOrders={() => setScreen({ name: 'orders' })} />
}
