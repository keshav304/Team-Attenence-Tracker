/**
 * Unit tests for server/src/utils/insightsHelpers.ts
 *
 * Run with:
 *   npx tsx --test src/utils/__tests__/insightsHelpers.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDateRange,
  computeWorkingDays,
  buildEntryMap,
} from '../insightsHelpers.js';
import type { EntryLike } from '../insightsHelpers.js';

/* ================================================================== */
/*  computeDateRange                                                  */
/* ================================================================== */

describe('computeDateRange', () => {
  it('returns correct values for a normal month (March 2025)', () => {
    const result = computeDateRange(3, 2025);
    assert.equal(result.mm, '03');
    assert.equal(result.daysInMonth, 31);
    assert.equal(result.startDate, '2025-03-01');
    assert.equal(result.endDate, '2025-03-31');
  });

  it('returns correct values for February in a leap year (2024)', () => {
    const result = computeDateRange(2, 2024);
    assert.equal(result.mm, '02');
    assert.equal(result.daysInMonth, 29);
    assert.equal(result.startDate, '2024-02-01');
    assert.equal(result.endDate, '2024-02-29');
  });

  it('returns correct values for February in a non-leap year (2025)', () => {
    const result = computeDateRange(2, 2025);
    assert.equal(result.daysInMonth, 28);
    assert.equal(result.endDate, '2025-02-28');
  });

  it('pads single-digit months', () => {
    const result = computeDateRange(1, 2025);
    assert.equal(result.mm, '01');
    assert.equal(result.startDate, '2025-01-01');
  });

  it('does not pad double-digit months', () => {
    const result = computeDateRange(12, 2025);
    assert.equal(result.mm, '12');
    assert.equal(result.startDate, '2025-12-01');
    assert.equal(result.endDate, '2025-12-31');
  });
});

/* ================================================================== */
/*  computeWorkingDays                                                */
/* ================================================================== */

describe('computeWorkingDays', () => {
  it('excludes weekends', () => {
    // February 2025: Sat=1,8,15,22  Sun=2,9,16,23
    const days = computeWorkingDays(2025, 2, '02', 28, new Set());
    // No holidays → should be 20 weekdays
    assert.equal(days.length, 20);
    // Verify no Saturdays/Sundays
    for (const d of days) {
      const dow = new Date(d + 'T00:00:00').getDay();
      assert.notEqual(dow, 0, `${d} is a Sunday`);
      assert.notEqual(dow, 6, `${d} is a Saturday`);
    }
  });

  it('excludes holidays that fall on weekdays', () => {
    // Feb 2025: 2025-02-03 is a Monday
    const holidays = new Set(['2025-02-03']);
    const days = computeWorkingDays(2025, 2, '02', 28, holidays);
    assert.equal(days.includes('2025-02-03'), false);
    assert.equal(days.length, 19); // 20 weekdays minus 1 holiday
  });

  it('does not double-count holidays that fall on weekends', () => {
    // Feb 1, 2025 is a Saturday
    const holidays = new Set(['2025-02-01']);
    const days = computeWorkingDays(2025, 2, '02', 28, holidays);
    assert.equal(days.length, 20); // still 20, weekend holiday doesn't change count
  });

  it('returns empty array for a month with only weekend days', () => {
    // Fabricated: a 2-day "month" where both days are weekend
    // Feb 1-2, 2025 = Sat, Sun
    const days = computeWorkingDays(2025, 2, '02', 2, new Set());
    assert.equal(days.length, 0);
  });

  it('returns dates in ascending order', () => {
    const days = computeWorkingDays(2025, 3, '03', 31, new Set());
    for (let i = 1; i < days.length; i++) {
      assert.ok(days[i] > days[i - 1], `${days[i]} should be after ${days[i - 1]}`);
    }
  });
});

/* ================================================================== */
/*  buildEntryMap                                                     */
/* ================================================================== */

describe('buildEntryMap', () => {
  const makeEntry = (uid: string, date: string, status: string, extra?: Partial<EntryLike>): EntryLike => ({
    userId: { toString: () => uid },
    date,
    status,
    ...extra,
  });

  it('groups entries by userId then date', () => {
    const entries: EntryLike[] = [
      makeEntry('u1', '2025-03-03', 'office'),
      makeEntry('u1', '2025-03-04', 'leave', { leaveDuration: 'full' }),
      makeEntry('u2', '2025-03-03', 'office'),
    ];
    const map = buildEntryMap(entries);

    assert.ok(map['u1']);
    assert.ok(map['u2']);
    assert.equal(Object.keys(map['u1']).length, 2);
    assert.equal(Object.keys(map['u2']).length, 1);
    assert.equal(map['u1']['2025-03-03'].status, 'office');
    assert.equal(map['u1']['2025-03-04'].status, 'leave');
    assert.equal(map['u1']['2025-03-04'].leaveDuration, 'full');
  });

  it('preserves all entry fields', () => {
    const entries: EntryLike[] = [
      makeEntry('u1', '2025-03-03', 'leave', {
        startTime: '09:00',
        endTime: '13:00',
        note: 'doctor appointment',
        leaveDuration: 'half',
        halfDayPortion: 'first-half',
        workingPortion: 'wfh',
      }),
    ];
    const map = buildEntryMap(entries);
    const entry = map['u1']['2025-03-03'];

    assert.equal(entry.status, 'leave');
    assert.equal(entry.startTime, '09:00');
    assert.equal(entry.endTime, '13:00');
    assert.equal(entry.note, 'doctor appointment');
    assert.equal(entry.leaveDuration, 'half');
    assert.equal(entry.halfDayPortion, 'first-half');
    assert.equal(entry.workingPortion, 'wfh');
  });

  it('returns empty object for no entries', () => {
    const map = buildEntryMap([]);
    assert.deepEqual(map, {});
  });

  it('last entry wins when duplicate userId+date', () => {
    const entries: EntryLike[] = [
      makeEntry('u1', '2025-03-03', 'office'),
      makeEntry('u1', '2025-03-03', 'leave'),
    ];
    const map = buildEntryMap(entries);
    assert.equal(map['u1']['2025-03-03'].status, 'leave');
  });

  it('leaves optional fields undefined when not provided', () => {
    const entries: EntryLike[] = [makeEntry('u1', '2025-03-03', 'office')];
    const map = buildEntryMap(entries);
    const entry = map['u1']['2025-03-03'];

    assert.equal(entry.startTime, undefined);
    assert.equal(entry.endTime, undefined);
    assert.equal(entry.note, undefined);
    assert.equal(entry.leaveDuration, undefined);
    assert.equal(entry.halfDayPortion, undefined);
    assert.equal(entry.workingPortion, undefined);
  });
});
