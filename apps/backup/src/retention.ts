/** Which backups to keep: the newest of each of the last N days, ISO weeks and months (UTC), and
 *  always the newest one. Everything else is deleted after a successful run. */

export interface Retention {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface Dated {
  name: string;
  at: Date;
}

/** ISO 8601 week of a date, as 2026-W43. */
export function isoWeek(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // The Thursday of this week decides the year.
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const buckets: [keyof Retention, (date: Date) => string][] = [
  ["daily", (date) => date.toISOString().slice(0, 10)],
  ["weekly", isoWeek],
  ["monthly", (date) => date.toISOString().slice(0, 7)],
];

/** The names to keep out of `backups`. */
export function toKeep(backups: Dated[], policy: Retention): Set<string> {
  const newestFirst = [...backups].sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set<string>();
  if (newestFirst[0]) keep.add(newestFirst[0].name);
  for (const [kind, key] of buckets) {
    const seen = new Set<string>();
    for (const backup of newestFirst) {
      if (seen.size >= policy[kind]) break;
      const bucket = key(backup.at);
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      keep.add(backup.name);
    }
  }
  return keep;
}

/** A backup's time from its name: <prefix>-20261025T030000Z. */
export function timeFromName(name: string): Date | null {
  const match = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  const date = new Date(Date.UTC(y as number, (mo as number) - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The name for a backup made at `date`. */
export function nameFor(prefix: string, date: Date): string {
  return `${prefix}-${date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")}`;
}
