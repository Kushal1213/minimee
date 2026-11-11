/**
 * Temporal parsing for exact and relative dates in a configurable timezone.
 * Internally everything is ISO 8601 UTC; local calendar dates use the user timezone.
 */

export interface DateRange {
  from: string; // inclusive ISO UTC
  to: string; // exclusive ISO UTC
  label: string;
  localDate?: string; // YYYY-MM-DD in timezone
}

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

export function nowIso(): string {
  return new Date().toISOString();
}

/** Parts of an instant in a specific IANA timezone. */
export function zonedParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function localDateString(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Convert a local calendar date (YYYY-MM-DD) in `timeZone` to a UTC Date at local midnight.
 * Uses iterative offset estimation (works for Asia/Kolkata and DST zones).
 */
export function localMidnightToUtc(localDate: string, timeZone: string): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  // First guess: treat as UTC midnight, then correct by timezone offset
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(guess, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const desired = Date.UTC(y, m - 1, d, 0, 0, 0);
    const delta = desired - asUtc;
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

export function dayRange(localDate: string, timeZone: string): DateRange {
  const start = localMidnightToUtc(localDate, timeZone);
  const [y, m, d] = localDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextLocal = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const end = localMidnightToUtc(nextLocal, timeZone);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label: localDate,
    localDate,
  };
}

function previousWeekday(now: Date, timeZone: string, targetWeekday: number): string {
  const parts = zonedParts(now, timeZone);
  let delta = (parts.weekday - targetWeekday + 7) % 7;
  if (delta === 0) delta = 7; // "last Monday" means previous occurrence
  const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - delta));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
}

function shiftLocalDate(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Parse temporal expressions from natural language.
 * Returns null when no date intent is detected.
 */
export function parseTemporalQuery(
  text: string,
  timeZone: string,
  now: Date = new Date(),
): DateRange | null {
  const q = text.toLowerCase().trim();
  const today = localDateString(now, timeZone);

  if (/\btoday\b/.test(q)) {
    return dayRange(today, timeZone);
  }
  if (/\byesterday\b/.test(q)) {
    return dayRange(shiftLocalDate(today, -1), timeZone);
  }

  // "last Tuesday", "on Monday", "this Wednesday"
  const weekdayMatch = q.match(
    /\b(?:last|this|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/,
  );
  if (weekdayMatch) {
    const wd = WEEKDAYS[weekdayMatch[1]];
    if (wd !== undefined) {
      // Prefer previous occurrence for recall-style queries
      const local = previousWeekday(now, timeZone, wd);
      return dayRange(local, timeZone);
    }
  }

  // "two weeks ago", "3 days ago"
  const relativeAgo = q.match(/\b(\d+|one|two|three|four|five|six|seven|a)\s+(day|days|week|weeks|month|months)\s+ago\b/);
  if (relativeAgo) {
    const nMap: Record<string, number> = {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
    };
    const n = nMap[relativeAgo[1]] ?? Number(relativeAgo[1]);
    const unit = relativeAgo[2];
    let days = n;
    if (unit.startsWith('week')) days = n * 7;
    if (unit.startsWith('month')) days = n * 30;
    return dayRange(shiftLocalDate(today, -days), timeZone);
  }

  // "last week"
  if (/\blast week\b/.test(q)) {
    const end = shiftLocalDate(today, -((zonedParts(now, timeZone).weekday + 6) % 7) - 1); // last Sunday-ish end
    const start = shiftLocalDate(end, -6);
    const from = dayRange(start, timeZone).from;
    const to = dayRange(end, timeZone).to;
    return { from, to, label: `${start} to ${end}` };
  }

  // "last year" / "last month" — broad ranges
  if (/\blast year\b/.test(q)) {
    const parts = zonedParts(now, timeZone);
    const start = `${parts.year - 1}-01-01`;
    const end = `${parts.year - 1}-12-31`;
    return {
      from: dayRange(start, timeZone).from,
      to: dayRange(end, timeZone).to,
      label: String(parts.year - 1),
    };
  }

  if (/\blast month\b/.test(q)) {
    const parts = zonedParts(now, timeZone);
    let y = parts.year;
    let m = parts.month - 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return {
      from: dayRange(start, timeZone).from,
      to: dayRange(end, timeZone).to,
      label: start.slice(0, 7),
    };
  }

  // Exact dates: "3 November", "November 3", "3 Nov 2025", "2025-11-03"
  const iso = q.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return dayRange(`${iso[1]}-${iso[2]}-${iso[3]}`, timeZone);
  }

  const dmy = q.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(20\d{2}))?\b/,
  );
  if (dmy) {
    const day = Number(dmy[1]);
    const month = MONTHS[dmy[2]] + 1;
    const year = dmy[3] ? Number(dmy[3]) : zonedParts(now, timeZone).year;
    const local = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return dayRange(local, timeZone);
  }

  const mdy = q.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/,
  );
  if (mdy) {
    const month = MONTHS[mdy[1]] + 1;
    const day = Number(mdy[2]);
    const year = mdy[3] ? Number(mdy[3]) : zonedParts(now, timeZone).year;
    const local = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return dayRange(local, timeZone);
  }

  return null;
}

/** Detect if the query is asking about past conversation history. */
export function isMemoryRecallQuery(text: string): boolean {
  const q = text.toLowerCase();
  return (
    /\b(what did i (ask|say|tell|discuss)|do you remember|remind me|we (talked|discussed|shortlisted|compared)|previously|earlier|last time|on \d|yesterday|last (monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year))\b/.test(
      q,
    ) ||
    /\b(has any|have any|changed since|still (correct|true|accurate|valid)|since then|since we)\b/.test(q)
  );
}
