export function formatPositionsLabel(n: number | null | undefined, loading: boolean): string | null {
  if (loading || n == null) return null
  if (n < 0) n = 0
  return `Positions found: ${n}`
}