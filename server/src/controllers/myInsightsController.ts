import { Response, NextFunction } from 'express';
import User from '../models/User.js';
import Entry from '../models/Entry.js';
import Holiday from '../models/Holiday.js';
import { AuthRequest } from '../types/index.js';
import { toISTDateString } from '../utils/date.js';

/**
 * GET /api/insights/monthly?month=YYYY-MM
 * Authenticated members — personal + team monthly insights.
 */
export const getMonthlyInsights = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const monthParam = res.locals.validatedQuery as { month: string };
    const [yearStr, mmStr] = monthParam.month.split('-');
    const year = Number(yearStr);
    const month = Number(mmStr);
    const mm = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${mm}-01`;
    const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

    const currentUserId = req.user!._id.toString();

    // ─── Fetch data in parallel ─────────────────
    const [users, holidays, entries] = await Promise.all([
      User.find({ isActive: true }).select('name email role createdAt').sort({ name: 1 }),
      Holiday.find({ date: { $gte: startDate, $lte: endDate } }),
      Entry.find({ date: { $gte: startDate, $lte: endDate } }),
    ]);

    // ─── Build holiday set ──────────────────────
    const holidaySet = new Set(holidays.map((h) => h.date));

    // ─── Compute working days ───────────────────
    const workingDays: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(dateStr)) {
        workingDays.push(dateStr);
      }
    }
    const totalWorkingDays = workingDays.length;

    // ─── Build entry lookup: userId → date → entry
    const entryMap: Record<
      string,
      Record<string, { status: string; leaveDuration?: string; workingPortion?: string }>
    > = {};
    entries.forEach((e) => {
      const uid = e.userId.toString();
      if (!entryMap[uid]) entryMap[uid] = {};
      entryMap[uid][e.date] = {
        status: e.status,
        leaveDuration: e.leaveDuration,
        workingPortion: e.workingPortion,
      };
    });

    // ─── Day-of-week counters ───────────────────
    const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const officeDayOfWeekCount: Record<string, number> = {};
    dayOfWeekNames.forEach((n) => { officeDayOfWeekCount[n] = 0; });

    // ─── Per-user metrics ───────────────────────
    interface UserMetric {
      userId: string;
      name: string;
      officeDays: number;
      leaveDays: number;
      wfhDays: number;
      totalWorkingDays: number;
      officePercent: number;
      officeDates: string[]; // for streak + overlap computation
    }

    const userMetrics: UserMetric[] = [];
    let teamOfficeDaysTotal = 0;
    let teamOfficePercentSum = 0;

    for (const user of users) {
      const uid = user._id.toString();
      const userEntries = entryMap[uid] || {};

      const userCreated = user.createdAt ? toISTDateString(new Date(user.createdAt)) : '2000-01-01';
      const effectiveWorkingDays = workingDays.filter((d) => d >= userCreated);
      const effectiveTotal = effectiveWorkingDays.length;

      let officeDays = 0;
      let leaveDays = 0;
      const officeDates: string[] = [];

      for (const date of effectiveWorkingDays) {
        const entry = userEntries[date];
        if (entry) {
          if (entry.status === 'office') {
            officeDays++;
            officeDates.push(date);
            const dow = new Date(date + 'T00:00:00').getDay();
            officeDayOfWeekCount[dayOfWeekNames[dow]]++;
          } else if (entry.status === 'leave') {
            if (entry.leaveDuration === 'half') {
              leaveDays += 0.5;
              if (entry.workingPortion === 'office') {
                officeDays += 0.5;
                officeDates.push(date);
                const dow = new Date(date + 'T00:00:00').getDay();
                officeDayOfWeekCount[dayOfWeekNames[dow]] += 0.5;
              }
            } else {
              leaveDays++;
            }
          }
        }
      }

      const wfhDays = Math.max(0, effectiveTotal - officeDays - leaveDays);
      const officePercent = effectiveTotal > 0 ? Math.round((officeDays / effectiveTotal) * 100) : 0;

      teamOfficeDaysTotal += officeDays;
      teamOfficePercentSum += officePercent;

      userMetrics.push({
        userId: uid,
        name: user.name,
        officeDays,
        leaveDays,
        wfhDays,
        totalWorkingDays: effectiveTotal,
        officePercent,
        officeDates,
      });
    }

    // ─── Personal stats ─────────────────────────
    const me = userMetrics.find((u) => u.userId === currentUserId);
    const personal = me
      ? {
          totalWorkingDays: me.totalWorkingDays,
          officeDays: me.officeDays,
          wfhDays: me.wfhDays,
          leaveDays: me.leaveDays,
          officePercent: me.officePercent,
          longestOfficeStreak: computeLongestStreak(me.officeDates, workingDays),
        }
      : {
          totalWorkingDays,
          officeDays: 0,
          wfhDays: totalWorkingDays,
          leaveDays: 0,
          officePercent: 0,
          longestOfficeStreak: 0,
        };

    // ─── Team Snapshot ──────────────────────────
    const teamSize = userMetrics.length;
    const teamAvgOfficePercent = teamSize > 0
      ? Math.round(teamOfficePercentSum / teamSize)
      : 0;

    const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekdayOffice = weekdayNames.map((name) => ({
      day: name,
      count: officeDayOfWeekCount[name] || 0,
    }));
    weekdayOffice.sort((a, b) => b.count - a.count);
    const mostPopularOfficeDay = weekdayOffice[0]?.day || 'N/A';

    const teamSnapshot = {
      teamAvgOfficePercent,
      mostPopularOfficeDay,
      totalTeamOfficeDays: teamOfficeDaysTotal,
      teamSize,
    };

    // ─── Highlights ─────────────────────────────

    // 1. Longest Office Streak (Team)
    let longestStreakValue = 0;
    let longestStreakUsers: string[] = [];
    for (const um of userMetrics) {
      const streak = computeLongestStreak(um.officeDates, workingDays);
      if (streak > longestStreakValue) {
        longestStreakValue = streak;
        longestStreakUsers = [um.name];
      } else if (streak === longestStreakValue && streak > 0) {
        longestStreakUsers.push(um.name);
      }
    }

    // 2. Most Consistent Planner
    // Fallback: user who planned the most future days before the 5th of the month
    const fifthOfMonth = `${year}-${mm}-05`;
    let bestPlannerCount = 0;
    let bestPlannerName = '';
    for (const user of users) {
      const uid = user._id.toString();
      // Count entries created before the 5th that are for dates >= 5th
      const userDbEntries = entries.filter(
        (e) =>
          e.userId.toString() === uid &&
          e.date >= fifthOfMonth &&
          e.date <= endDate &&
          e.createdAt &&
          toISTDateString(new Date(e.createdAt)) < fifthOfMonth
      );
      if (userDbEntries.length > bestPlannerCount) {
        bestPlannerCount = userDbEntries.length;
        bestPlannerName = user.name;
      }
    }

    // 3. Most Popular Office Day — already computed
    // mostPopularOfficeDay

    // 4. Collaboration Magnet
    // For each user ─ count overlapping office days with teammates
    let bestOverlapScore = 0;
    let bestOverlapUser = '';
    // Build a date → set of userIds who were in office
    const dateOfficeUsers: Record<string, Set<string>> = {};
    for (const um of userMetrics) {
      for (const d of um.officeDates) {
        if (!dateOfficeUsers[d]) dateOfficeUsers[d] = new Set();
        dateOfficeUsers[d].add(um.userId);
      }
    }
    for (const um of userMetrics) {
      let overlapScore = 0;
      for (const d of um.officeDates) {
        const othersCount = (dateOfficeUsers[d]?.size || 1) - 1;
        overlapScore += othersCount;
      }
      if (overlapScore > bestOverlapScore) {
        bestOverlapScore = overlapScore;
        bestOverlapUser = um.name;
      }
    }

    const highlights = {
      longestStreak: {
        days: longestStreakValue,
        users: longestStreakUsers,
      },
      mostConsistentPlanner: bestPlannerName || null,
      mostPopularOfficeDay,
      collaborationMagnet: bestOverlapUser || null,
    };

    res.json({
      success: true,
      data: {
        personal,
        teamSnapshot,
        highlights,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ─── Helper: compute longest consecutive office streak ─── */
function computeLongestStreak(officeDates: string[], workingDays: string[]): number {
  if (officeDates.length === 0) return 0;
  const officeSet = new Set(officeDates);
  let longest = 0;
  let current = 0;
  for (const day of workingDays) {
    if (officeSet.has(day)) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}
