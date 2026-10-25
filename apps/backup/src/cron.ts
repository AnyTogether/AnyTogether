/** Five-field cron expressions (minute hour day-of-month month day-of-week), in the container's
 *  time zone (TZ, UTC by default): numbers, `*`, ranges `1-5`, steps `*\/15` and `0-30/10`, lists
 *  `1,15`, Sunday as 0 or 7, and @hourly, @daily (@midnight), @weekly, @monthly. As in cron, a
 *  restricted day of the month and day of the week match when either does. */

export interface Cron {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Both day fields restricted: either may match. */
  eitherDay: boolean;
}

const macros: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

function field(text: string, min: number, max: number, name: string): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`cron: cannot read "${part}" in the ${name} field`);
    const step = match[4] ? Number(match[4]) : 1;
    let from = min;
    let to = max;
    if (match[1] !== "*") {
      from = Number(match[2]);
      to = match[3] !== undefined ? Number(match[3]) : match[4] ? max : from;
    }
    if (step < 1 || from < min || to > max || from > to)
      throw new Error(`cron: "${part}" is outside ${min}-${max} in the ${name} field`);
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

export function parseCron(expression: string): Cron {
  const source = expression.trim();
  const fields = (macros[source.toLowerCase()] ?? source).split(/\s+/);
  if (fields.length !== 5)
    throw new Error(`cron: "${source}" needs five fields (minute hour day month weekday)`);
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const weekdays = field(weekday, 0, 7, "day-of-week");
  if (weekdays.delete(7)) weekdays.add(0);
  return {
    source,
    minutes: field(minute, 0, 59, "minute"),
    hours: field(hour, 0, 23, "hour"),
    days: field(day, 1, 31, "day-of-month"),
    months: field(month, 1, 12, "month"),
    weekdays,
    eitherDay: day !== "*" && weekday !== "*",
  };
}

function dayMatches(cron: Cron, date: Date) {
  const dom = cron.days.has(date.getDate());
  const dow = cron.weekdays.has(date.getDay());
  return cron.eitherDay ? dom || dow : dom && dow;
}

/** The first time after `after` (to the minute, never `after` itself) the expression fires. */
export function nextRun(cron: Cron, after: Date): Date {
  const date = new Date(after.getTime());
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  // Five years covers every expression that can fire at all (29 February on a Monday, say).
  const limit = after.getTime() + 5 * 366 * 86_400_000;
  while (date.getTime() <= limit) {
    if (!cron.months.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
    } else if (!dayMatches(cron, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
    } else if (!cron.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
    } else if (!cron.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
    } else return date;
  }
  throw new Error(`cron: "${cron.source}" never fires`);
}

/** The longest gap between consecutive runs over the next `runs` runs, in seconds: a backup is
 *  late once twice this has passed without one. */
export function longestGap(cron: Cron, from = new Date(), runs = 60): number {
  let previous = nextRun(cron, from);
  let longest = 0;
  for (let i = 0; i < runs; i++) {
    const next = nextRun(cron, previous);
    longest = Math.max(longest, next.getTime() - previous.getTime());
    previous = next;
  }
  return Math.round(longest / 1000);
}
