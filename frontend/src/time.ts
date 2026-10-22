// The counter PC clock can be minutes wrong. Count down from the server's
// expiresInSeconds using performance.now(), which is not the wall clock.

export function remainingSeconds(expiresInSeconds: number, receivedAt: number, now: number): number {
  return Math.max(0, expiresInSeconds - (now - receivedAt) / 1000)
}

export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
