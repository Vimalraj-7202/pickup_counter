// Prices are whole paise. This only formats them for the screen.

export function formatRupees(paise: number): string {
  const rupees = Math.trunc(paise / 100)
  const rest = Math.abs(paise % 100)
  return `₹${rupees}.${String(rest).padStart(2, '0')}`
}
