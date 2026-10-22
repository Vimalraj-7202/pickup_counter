import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { listOrders, type Order } from './api'
import { formatRupees } from './money'
import { Shell } from './Shell'
import { statusColor, statusLabel } from './status'

type OrdersProps = {
  onBack: () => void
  onOpen: (order: Order) => void
}

export function Orders({ onBack, onOpen }: OrdersProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listOrders()
      .then((next) => {
        if (!cancelled) setOrders(next)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the orders.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Shell
      nav={
        <Button color="inherit" startIcon={<ArrowBackIcon />} onClick={onBack}>
          Menu
        </Button>
      }
    >
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack spacing={0.5} sx={{ mb: 3 }}>
          <Typography variant="h4" component="h1">
            Orders
          </Typography>
          <Typography color="text.secondary">Open one to pay or collect it from the locker.</Typography>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {loading ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading orders…</Typography>
          </Stack>
        ) : null}
        {!loading && !error && orders.length === 0 ? (
          <Typography color="text.secondary">No orders yet. Place one from the menu.</Typography>
        ) : null}

        <Stack spacing={1.5}>
          {orders.map((order) => (
            <Card key={order.id}>
              <CardActionArea onClick={() => onOpen(order)} sx={{ px: 2.5, py: 2 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Chip size="small" label={statusLabel[order.status]} color={statusColor(order.status)} />
                      <Typography sx={{ fontWeight: 700 }}>{formatRupees(order.totalPaise)}</Typography>
                    </Stack>
                    <Typography color="text.secondary" noWrap>
                      {order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}
                    </Typography>
                  </Stack>
                  <ChevronRightIcon color="action" />
                </Stack>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      </Container>
    </Shell>
  )
}
