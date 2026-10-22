-- Physical snacks still in the machine. Creating an order does not change this.
-- A successful pickup reduces it. The check stops the column going below zero.
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0)
);

-- stock_held means these units must not be sold to anyone else.
-- pending + stock_held: the 120 second hold
-- paid + stock_held: paid, waiting for the locker
-- needs_review + stock_held: the amount was wrong but the hold is still active
-- expired, or needs_review after a late payment we cannot fill: stock_held is false
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'paid', 'expired', 'needs_review', 'picked_up')
  ),
  total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
  hold_expires_at TIMESTAMPTZ NOT NULL,
  stock_held BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0)
);

-- The provider's event id. Inserting the same id again conflicts, so a replay does nothing.
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders (id),
  amount_paise INTEGER NOT NULL,
  provider_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON order_items (product_id);
CREATE INDEX IF NOT EXISTS orders_status_hold_idx ON orders (status, hold_expires_at);
