# Pickup Counter

A self-service snack counter. A customer places an order, a payment webhook confirms it, and one locker claim hands the snack over. Stock is held while the customer pays, and two things happening at once cannot sell the same unit twice.

The customer screen lets someone pick snacks, place an order, and watch the payment hold count down.

Money is stored as whole paise. A price of `4500` is ₹45. There are no rupee floats in the API or the database.

## Run

You do not install PostgreSQL. Docker starts it for you. Install Docker Desktop, then from this folder:

```bash
docker compose up --build
```

The screen is at [http://localhost:5173](http://localhost:5173). The API listens on [http://localhost:3001](http://localhost:3001). Postgres is published on port 5432 (`pickup` / `pickup`, database `pickup`).

On the first start the API creates the tables and seeds five snacks. Data stays in the `pickup-db` volume. To wipe it:

```bash
docker compose down -v
```

On this PC, without Docker, start the API and the screen from the project folder. The first time only, install packages: `npm install --prefix backend` and `npm install --prefix frontend`.

```bash
npm start
```

```bash
npm run dev
```

`npm start` is the database and the API. `npm run dev` is the screen at [http://localhost:5173](http://localhost:5173). The defaults match `backend/.env`: database `postgres://pickup:pickup@localhost:5432/pickup`, webhook secret `dev-webhook-secret`, hold `120` seconds. The API reads environment variables; it does not load that file on its own.

### Seeded snacks

| id | name | price (paise) |
| --- | --- | --- |
| 1 | Potato Chips | 2000 |
| 2 | Salted Peanuts | 1500 |
| 3 | Mango Soda | 4500 |
| 4 | Dark Chocolate | 3000 |
| 5 | Water Bottle | 1000 |

One Mango Soda is the sample webhook amount, `4500`.

### Send a payment

Place an order (`POST /orders`), then:

```bash
cd backend
npm install
npm run send-webhook -- --orderId <order-uuid> --amountPaise 4500 --eventId evt_123
```

The script signs the raw JSON with `WEBHOOK_SECRET` and POSTs it to `http://localhost:3001/payments/webhook`. Override the target with `--api http://localhost:3001`.

## Tests

The tests use a real PostgreSQL database named `pickup_test`. They refuse to run against any other database name. They do not mock the database.

Start Postgres, then:

```bash
docker compose up -d db
cd backend
npm install
npm test
```

Or, with the database already up:

```bash
docker compose --profile test run --rm test
```

What they check:

- Ten orders for the last two units at the same time: two holds succeed, eight fail, stock does not go negative.
- The same webhook event sent twice at the same time: one payment row, the order is paid once.
- Two pickup claims at the same time: one succeeds, the other is `409`, stock drops once.
- A short line rolls the whole order back.
- A bad signature does not change the order.
- A wrong amount becomes `needs_review` and keeps the hold.
- A late payment is accepted only when the units are still free.

## Where to change things

Use this when you have to change the code live.

| If the change is about... | Open | Function or spot |
| --- | --- | --- |
| How long a hold lasts | `backend/src/config.ts` | `holdSeconds`, or `HOLD_SECONDS` in `docker-compose.yml` |
| Which units count as available | `backend/src/stock.ts` | `HELD_ORDER_SQL` |
| Locking products so two checkouts cannot deadlock | `backend/src/stock.ts` | `lockProducts` |
| Placing an order, the total, and "not enough stock" | `backend/src/orders.ts` | `createOrder` |
| What the order JSON looks like, including `expiresInSeconds` | `backend/src/orders.ts` | `loadOrder` |
| The list of saved orders | `backend/src/orders.ts` | `listOrders` |
| Expiring a hold | `backend/src/orders.ts` | `expireHolds` |
| Pickup, and why only one locker wins | `backend/src/orders.ts` | `claimPickup` |
| Webhook signature | `backend/src/signature.ts` | `signBody`, `verifySignature` |
| Wrong amount, repeated events, late payment | `backend/src/payments.ts` | `processWebhook` |
| URLs and HTTP status codes | `backend/src/app.ts` | the route handlers |
| Tables | `backend/src/sql/schema.sql` | |
| The five snacks | `backend/src/sql/seed.sql` | |
| The signed webhook script | `backend/src/scripts/send-webhook.ts` | |
| The concurrency proofs | `backend/test/concurrency.test.ts` | |
| Product list, cart, and place order | `frontend/src/Shop.tsx` | |
| Saved orders on the screen | `frontend/src/Orders.tsx` | |
| Countdown | `frontend/src/time.ts` | `remainingSeconds` |
| Paid, expired, and needs-review messages | `frontend/src/Payment.tsx` | `statusCopy` |
| Rupee display | `frontend/src/money.ts` | `formatRupees` |
| Screen API calls and the API base URL | `frontend/src/api.ts` | `API_URL` |
| Screen colors and MUI theme | `frontend/src/theme.ts` | `createTheme` |

`expiresInSeconds` is calculated in SQL from `hold_expires_at - now()` inside `loadOrder`, at the moment the order is read. `frontend/src/time.ts` counts down from that number with `performance.now()`. It does not use the PC's wall clock. Each poll replaces the countdown with a fresh `expiresInSeconds` from the server.

## How a sale stays single-threaded per snack

Physical stock lives on `products.stock`. An order does not reduce it. Pickup does.

While an order should block other buyers, `orders.stock_held` is true. `GET /products` returns `stock` minus the sum of those quantities. Pending orders whose `hold_expires_at` is already past are left out even if a sweeper has not marked them `expired` yet.

`createOrder` does this in one database transaction:

1. Lock the product rows, lowest id first.
2. Count available units.
3. If any line is short, return 409 and insert nothing.
4. Otherwise insert the order and its lines with the price copied onto the line.

The row lock is why ten parallel buyers of the last two units produce two holds and eight clean failures. The second transaction waits, then sees the first commit. Locking in id order is why two multi-item orders do not deadlock.

Pickup is one conditional update: `SET status = 'picked_up' WHERE status = 'paid'`. Postgres lets one of those updates match. The other matches zero rows and gets 409. The winner then reduces `products.stock` in the same transaction. The column also has `CHECK (stock >= 0)`.

The webhook inserts `payment_events.event_id` with `ON CONFLICT DO NOTHING`. The order row is locked first, so two deliveries of the same event cannot both apply it.

## Late payment

A correct `captured` webhook after the hold has expired does not always fail, and it does not always succeed.

- If those units are still available, the order becomes `paid` and the units are held again. A slow webhook should not punish the customer when the snack is still there.
- If another order already holds them, this order becomes `needs_review` and `stock_held` stays false. We do not pull the snack back from the other customer. Someone would refund or replace it later. That admin step is not built.

A webhook whose `amountPaise` is not the order total never marks the order paid.

- If the hold is still active, status becomes `needs_review` and the units stay held, so the counter can still hand them over after a person checks the payment.
- If the hold is already over, `needs_review` does not hold stock.

A second webhook with the same `eventId` returns `{ "duplicate": true }` and does not change the order. A different `eventId` for an order that is already `paid`, `picked_up`, or `needs_review` is stored and does not move the status. Fixing a `needs_review` order automatically would need a person, not another webhook guess.

## API

`GET /health`  
`{ "ok": true }` when the database answers.

`GET /products`

```json
[{ "id": 3, "name": "Mango Soda", "pricePaise": 4500, "stock": 8, "availableUnits": 8 }]
```

`stock` is what is physically in the machine. `availableUnits` is what a new order can take.

`POST /orders`

```json
{ "items": [{ "productId": 3, "quantity": 1 }] }
```

`201` with `id`, `status`, `totalPaise`, `expiresInSeconds`, `serverNow`, `holdExpiresAt`, and `items`.  
`409` `{ "error": "Not enough stock", "details": [...] }` holds nothing.  
`400` for a bad body or an unknown product.

`GET /orders`  
A list of saved orders, newest first, each in the same shape as one order. The screen's Orders button uses this.

`GET /orders/:id`  
Same shape. This is how the screen will poll. A pending order past its hold is returned as `expired`.

`POST /payments/webhook`  
Header `X-Signature`: hex HMAC-SHA256 of the raw body, secret `WEBHOOK_SECRET`.

```json
{ "eventId": "evt_123", "orderId": "<uuid>", "amountPaise": 4500, "status": "captured" }
```

`401` if the signature does not match. `200` `{ "ok": true, "duplicate": false, "orderId": "...", "orderStatus": "paid" }` when it is applied.

`POST /orders/:id/pickup-claim`  
`200` and status `picked_up` for the winner. `409` for the other locker, and for an order that is not paid.

`POST /demo/pay/:id`  
The screen's "Simulate UPI payment" button. It signs a capture for the order total and runs the real webhook code. The script above is the same path a reviewer can call by hand.

## Assumptions

- One counter, one Postgres database. The database clock decides when a hold ends, so the API process clock is not used for that.
- `GET /orders/:id` is not named in the brief. The screen has to poll something, so it is part of the API.
- There is no customer login. The webhook secret is the check on payments. The locker route is open; a shared locker key would be a later addition.
- `eventId` is unique across the provider. Replaying it is a no-op even if the JSON body differs the second time.
- Duplicate product lines in one order are added together. Each line quantity, including after merging, is a whole number from 1 to 100.
- The price is copied onto the order line so a later catalog change does not change the total.
- Only `status: "captured"` is accepted. Anything else is `422` and is not stored, so a later `captured` event with the same id can still be applied.
- `needs_review` is not auto-resolved.

## Not done yet

- An admin action to accept or reject `needs_review` (and to release the hold when the payment is rejected).
- Refunds for a late payment we cannot fill.
- A locker credential on `pickup-claim`.

## Status flow

```text
pending -- captured, amount matches, hold active --> paid -- pickup --> picked_up
pending -- amount does not match, hold active --> needs_review (units stay held)
pending -- hold expires --> expired (units released)
expired -- captured, amount matches, units still free --> paid
expired -- captured, amount matches, units already sold --> needs_review (units not held)
expired or pending-after-expiry -- amount does not match --> needs_review (units not held)
```
