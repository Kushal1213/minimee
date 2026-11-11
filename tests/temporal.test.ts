import { describe, expect, it } from 'vitest';
import {
  dayRange,
  localDateString,
  localMidnightToUtc,
  parseTemporalQuery,
  zonedParts,
} from '../server/memory/temporal.js';

describe('temporal reasoning (Asia/Kolkata)', () => {
  const tz = 'Asia/Kolkata';
  // 2025-11-10 12:00 UTC = 17:30 IST
  const now = new Date('2025-11-10T12:00:00.000Z');

  it('computes local calendar date in timezone', () => {
    expect(localDateString(now, tz)).toBe('2025-11-10');
  });

  it('maps local midnight to correct UTC instant for IST', () => {
    const midnight = localMidnightToUtc('2025-11-03', tz);
    // IST is UTC+5:30, so local midnight = 2025-11-02T18:30:00.000Z
    expect(midnight.toISOString()).toBe('2025-11-02T18:30:00.000Z');
    const parts = zonedParts(midnight, tz);
    expect(parts.year).toBe(2025);
    expect(parts.month).toBe(11);
    expect(parts.day).toBe(3);
    expect(parts.hour).toBe(0);
  });

  it('builds inclusive local day ranges', () => {
    const range = dayRange('2025-11-03', tz);
    expect(range.from).toBe('2025-11-02T18:30:00.000Z');
    expect(range.to).toBe('2025-11-03T18:30:00.000Z');
    expect(range.localDate).toBe('2025-11-03');
  });

  it('parses exact dates like 3 November', () => {
    const range = parseTemporalQuery('What did I ask you on 3 November?', tz, now);
    expect(range?.localDate).toBe('2025-11-03');
  });

  it('parses yesterday', () => {
    const range = parseTemporalQuery('what did I say yesterday', tz, now);
    expect(range?.localDate).toBe('2025-11-09');
  });

  it('parses last Tuesday relative to now', () => {
    // 2025-11-10 is Monday; last Tuesday = 2025-11-04
    const range = parseTemporalQuery('Last Tuesday I asked about Postgres', tz, now);
    expect(range?.localDate).toBe('2025-11-04');
  });

  it('parses two weeks ago', () => {
    const range = parseTemporalQuery('two weeks ago', tz, now);
    expect(range?.localDate).toBe('2025-10-27');
  });

  it('parses last year as a broad range', () => {
    const range = parseTemporalQuery('What did I ask you last year?', tz, now);
    expect(range?.label).toBe('2024');
    expect(range?.from).toContain('2023-12-31'); // 2024-01-01 IST midnight
  });

  it('returns null when no temporal intent', () => {
    expect(parseTemporalQuery('What is SQL?', tz, now)).toBeNull();
  });
});
