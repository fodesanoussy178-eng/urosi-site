export function formatHours(durationMinutes: number): string {
  return `${Math.round((durationMinutes / 60) * 10) / 10} h`;
}

export function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}
