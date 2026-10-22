// Hold length, database URL, and webhook secret.
// Change the hold here (the default) or with the HOLD_SECONDS environment variable.

function integerFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`)
  }
  return value
}

export const config = {
  get port(): number {
    return integerFromEnv('PORT', 3001, 1, 65535)
  },
  get holdSeconds(): number {
    return integerFromEnv('HOLD_SECONDS', 120, 1, 3600)
  },
  get databaseUrl(): string {
    return process.env.DATABASE_URL ?? 'postgres://pickup:pickup@localhost:5432/pickup'
  },
  get webhookSecret(): string {
    return process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret'
  },
}
