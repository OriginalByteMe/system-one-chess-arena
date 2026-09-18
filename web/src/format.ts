/**
 * One place for the numbers, so the same value reads the same on every page.
 * A confidence that is 23% on the leaderboard must not be 0.23 on a profile.
 */

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function dollars(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** "king-hunt" reads as "King hunt". */
export function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
