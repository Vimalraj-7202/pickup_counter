import AddIcon from '@mui/icons-material/Add'
import CookieOutlinedIcon from '@mui/icons-material/CookieOutlined'
import FastfoodOutlinedIcon from '@mui/icons-material/FastfoodOutlined'
import GrainOutlinedIcon from '@mui/icons-material/GrainOutlined'
import LocalCafeOutlinedIcon from '@mui/icons-material/LocalCafeOutlined'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import RemoveIcon from '@mui/icons-material/Remove'
import RestaurantOutlinedIcon from '@mui/icons-material/RestaurantOutlined'
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { SvgIconComponent } from '@mui/icons-material'
import { Shell } from './Shell'
import { useEffect, useState } from 'react'
import { ApiError, listProducts, placeOrder, type Order, type Product } from './api'
import { formatRupees } from './money'

type ShopProps = {
  onOrdered: (order: Order) => void
  onShowOrders: () => void
}

const tones = ['#0f766e', '#b45309', '#1d4ed8', '#7c3aed', '#be123c']

function productMark(name: string): { Icon: SvgIconComponent; tone: string } {
  const label = name.toLowerCase()
  const tone = tones[Math.abs(name.length) % tones.length] ?? tones[0]
  if (label.includes('chip')) return { Icon: FastfoodOutlinedIcon, tone: tones[0] }
  if (label.includes('peanut')) return { Icon: GrainOutlinedIcon, tone: tones[1] }
  if (label.includes('soda') || label.includes('mango')) return { Icon: LocalCafeOutlinedIcon, tone: tones[2] }
  if (label.includes('chocolate')) return { Icon: CookieOutlinedIcon, tone: tones[3] }
  if (label.includes('water')) return { Icon: WaterDropOutlinedIcon, tone: tones[4] }
  return { Icon: RestaurantOutlinedIcon, tone }
}

function errorText(error: unknown): string {
  if (error instanceof ApiError && Array.isArray(error.details)) {
    const line = error.details[0] as { name?: string; available?: number } | undefined
    if (line?.name !== undefined && line.available !== undefined) {
      return `Only ${line.available} ${line.name} left.`
    }
  }
  return error instanceof Error ? error.message : 'Could not place the order.'
}

export function Shop({ onOrdered, onShowOrders }: ShopProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      listProducts()
        .then((next) => {
          if (cancelled) return
          setProducts(next)
          setCart((current) => {
            const clamped: Record<number, number> = {}
            for (const product of next) {
              const quantity = current[product.id] ?? 0
              if (quantity > 0) clamped[product.id] = Math.min(quantity, product.availableUnits)
            }
            return clamped
          })
        })
        .catch(() => {
          if (!cancelled) setError('Could not load the snacks.')
        })
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const lines = products
    .map((product) => ({ product, quantity: cart[product.id] ?? 0 }))
    .filter((line) => line.quantity > 0)
  const totalPaise = lines.reduce((sum, line) => sum + line.product.pricePaise * line.quantity, 0)
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)

  function changeQuantity(product: Product, nextQuantity: number) {
    setCart((current) => ({
      ...current,
      [product.id]: Math.max(0, Math.min(nextQuantity, product.availableUnits)),
    }))
  }

  async function submitOrder() {
    setBusy(true)
    setError(null)
    try {
      const order = await placeOrder(
        lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      )
      onOrdered(order)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      nav={
        <Button color="inherit" startIcon={<ReceiptLongOutlinedIcon />} onClick={onShowOrders}>
          Orders
        </Button>
      }
    >
      <Container maxWidth="md" sx={{ py: 4, pb: 14 }}>
        <Stack spacing={0.5} sx={{ mb: 3 }}>
          <Typography variant="h4" component="h1">
            Choose a snack
          </Typography>
          <Typography color="text.secondary">
            Add what you want. It stays reserved for 2 minutes after you order.
          </Typography>
        </Stack>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {products.length === 0 && !error ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading snacks…</Typography>
          </Stack>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 2,
          }}
        >
          {products.map((product) => {
            const quantity = cart[product.id] ?? 0
            const soldOut = product.availableUnits === 0
            const { Icon, tone } = productMark(product.name)
            return (
              <Card
                key={product.id}
                sx={{
                  outline: quantity > 0 ? '2px solid' : '1px solid transparent',
                  outlineColor: quantity > 0 ? 'primary.main' : 'transparent',
                }}
              >
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 2,
                        display: 'grid',
                        placeItems: 'center',
                        color: tone,
                        bgcolor: `${tone}18`,
                        flexShrink: 0,
                      }}
                    >
                      <Icon />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h6" noWrap>
                        {product.name}
                      </Typography>
                      <Typography sx={{ fontWeight: 700 }}>{formatRupees(product.pricePaise)}</Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 'auto' }}>
                    <Chip
                      size="small"
                      label={soldOut ? 'Sold out' : `${product.availableUnits} left`}
                      color={soldOut ? 'error' : 'default'}
                    />
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <IconButton
                        aria-label={`Remove one ${product.name}`}
                        onClick={() => changeQuantity(product, quantity - 1)}
                        disabled={quantity === 0}
                        sx={{ bgcolor: 'action.hover' }}
                      >
                        <RemoveIcon fontSize="small" />
                      </IconButton>
                      <Typography sx={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{quantity}</Typography>
                      <IconButton
                        aria-label={`Add one ${product.name}`}
                        onClick={() => changeQuantity(product, quantity + 1)}
                        disabled={quantity >= product.availableUnits}
                        sx={{
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                          '&:hover': { bgcolor: 'primary.dark' },
                          '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                        }}
                      >
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )
          })}
        </Box>
      </Container>

      <Paper
        elevation={8}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 0,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="md" sx={{ py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              {itemCount === 0 ? 'Nothing selected' : `${itemCount} selected`}
            </Typography>
            <Typography variant="h6">{formatRupees(totalPaise)}</Typography>
          </Box>
          <Button variant="contained" size="large" onClick={submitOrder} disabled={busy || lines.length === 0}>
            {busy ? 'Placing order…' : 'Place order'}
          </Button>
        </Container>
      </Paper>
    </Shell>
  )
}
