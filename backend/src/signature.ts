// The payment provider sends X-Signature: hex HMAC-SHA256 of the raw request body.
// Change the algorithm or the header rules here.
import { createHmac, timingSafeEqual } from 'node:crypto'

export function signBody(raw: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex')
}

export function verifySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false

  const expected = Buffer.from(signBody(raw, secret), 'utf8')
  const provided = Buffer.from(header.trim().toLowerCase(), 'utf8')
  if (expected.length !== provided.length) return false

  return timingSafeEqual(expected, provided)
}
