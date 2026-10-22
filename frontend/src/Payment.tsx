import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { claimPickup, getOrder, simulatePayment, type Order } from './api'
import { formatRupees } from './money'
import { Shell } from './Shell'
import { statusColor, statusLabel } from './status'
import { formatCountdown, remainingSeconds } from './time'

type PaymentProps = {
  initialOrder: Order
  onNewOrder: () => void
}

function statusCopy(order: Order, secondsLeft: number): string {
  if (order.status === 'pending' && secondsLeft <= 0) return 'Checking the payment…'
  if (order.status === 'pending') return 'Pay with UPI before the hold ends.'
  if (order.status === 'paid') return 'Payment received. Collect the snacks from the locker.'
  if (order.status === 'expired') return 'The hold ended before payment. Those snacks can be sold again.'
  if (order.status === 'needs_review') return 'The payment needs a person to check it.'
  return 'Collected. Enjoy your snack.'
}

export function Payment({ initialOrder, onNewOrder }: PaymentProps) {
  const [order, setOrder] = useState(initialOrder)
  const [anchor, setAnchor] = useState(() => ({
    expiresInSeconds: initialOrder.expiresInSeconds,
    receivedAt: performance.now(),
  }))
  const [tick, setTick] = useState(() => performance.now())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (order.status !== 'pending') return
    const timer = window.setInterval(() => setTick(performance.now()), 200)
    return () => window.clearInterval(timer)
  }, [order.status])

  useEffect(() => {
    // Poll only while the customer is still paying. Paid, expired, needs_review, and picked_up stop it.
    if (order.status !== 'pending') return
    let stopped = false
    const timer = window.setInterval(() => {
      getOrder(order.id)
        .then((next) => {
          if (stopped) return
          setOrder(next)
          setAnchor({ expiresInSeconds: next.expiresInSeconds, receivedAt: performance.now() })
        })
        .catch(() => {
          if (!stopped) setError('Could not reach the counter.')
        })
    }, 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [order.id, order.status])

  const secondsLeft =
    order.status === 'pending'
      ? remainingSeconds(anchor.expiresInSeconds, anchor.receivedAt, tick)
      : 0

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      await simulatePayment(order.id)
      const next = await getOrder(order.id)
      setOrder(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payment failed.')
    } finally {
      setBusy(false)
    }
  }

  async function collect() {
    setBusy(true)
    setError(null)
    try {
      setOrder(await claimPickup(order.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pickup failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      nav={
        <Button color="inherit" startIcon={<ArrowBackIcon />} onClick={onNewOrder}>
          Menu
        </Button>
      }
    >
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Paper sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          <Stack spacing={2.5}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="overline" color="text.secondary">
                Order
              </Typography>
              <Chip label={statusLabel[order.status]} color={statusColor(order.status)} />
            </Stack>
            <Box>
              <Typography variant="h4" component="h1">
                {order.status === 'picked_up' ? 'Collected' : 'Your order'}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {statusCopy(order, secondsLeft)}
              </Typography>
            </Box>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {order.status === 'pending' ? (
              <Box
                sx={{
                  borderRadius: 3,
                  px: 2,
                  py: 3,
                  textAlign: 'center',
                  color: '#f5f5f4',
                  bgcolor: '#12312e',
                }}
              >
                <Typography variant="overline" sx={{ color: '#a8a29e' }}>
                  Time left to pay
                </Typography>
                <Typography variant="h2" aria-live="polite" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {formatCountdown(secondsLeft)}
                </Typography>
              </Box>
            ) : null}
            <Stack spacing={1.25}>
              {order.items.map((item) => (
                <Stack key={item.productId} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography>
                    {item.quantity} × {item.name}
                  </Typography>
                  <Typography sx={{ fontWeight: 650 }}>{formatRupees(item.unitPricePaise * item.quantity)}</Typography>
                </Stack>
              ))}
            </Stack>
            <Divider />
            <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Typography color="text.secondary">Total</Typography>
              <Typography variant="h5">{formatRupees(order.totalPaise)}</Typography>
            </Stack>
            {order.status === 'pending' ? (
              <Button variant="contained" size="large" fullWidth onClick={pay} disabled={busy}>
                {busy ? 'Waiting…' : 'Simulate UPI payment'}
              </Button>
            ) : null}
            {order.status === 'paid' ? (
              <Button variant="contained" size="large" fullWidth onClick={collect} disabled={busy}>
                {busy ? 'Opening locker…' : 'Collect from locker'}
              </Button>
            ) : null}
            {order.status !== 'pending' && order.status !== 'paid' ? (
              <Button variant="contained" size="large" fullWidth onClick={onNewOrder}>
                Start a new order
              </Button>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              The countdown follows the server, so a wrong PC clock does not change it.
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </Shell>
  )
}
