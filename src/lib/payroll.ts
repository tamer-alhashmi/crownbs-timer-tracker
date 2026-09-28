export const DEFAULT_HOURLY_RATE = 12;

export function resolveHourlyRate(rate: unknown): number {
  const parsedRate = Number(rate);
  return Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : DEFAULT_HOURLY_RATE;
}

export function calculateHourlyEarnings(hours: number, rate: unknown): number {
  return Math.max(0, hours) * resolveHourlyRate(rate);
}