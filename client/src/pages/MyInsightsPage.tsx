import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { myInsightsApi } from '../api';
import type { MyInsightsResponse } from '../types';

/* ─── helpers ─────────────────────────────────── */
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear = now.getFullYear();

const toMonthStr = (m: number, y: number) =>
  `${y}-${String(m).padStart(2, '0')}`;

/* ─── stat card ───────────────────────────────── */
const StatCard: React.FC<{
  emoji: string;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}> = ({ emoji, label, value, sub, accent }) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-5 flex flex-col gap-1 transition-colors">
    <div className="text-2xl">{emoji}</div>
    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
    <p className={`text-2xl sm:text-3xl font-bold ${accent || 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
    {sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
  </div>
);

/* ─── progress ring ───────────────────────────── */
const ProgressRing: React.FC<{ percent: number; size?: number }> = ({ percent, size = 120 }) => {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color =
    percent >= 60
      ? 'text-green-500 dark:text-green-400'
      : percent >= 30
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-red-500 dark:text-red-400';

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          className="text-gray-200 dark:text-gray-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${color} transition-all duration-700 ease-out`}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className={`text-2xl sm:text-3xl font-bold ${color}`}>{percent}%</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Office</span>
      </div>
    </div>
  );
};

/* ─── highlight card ──────────────────────────── */
const HighlightCard: React.FC<{
  emoji: string;
  title: string;
  description: string;
}> = ({ emoji, title, description }) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-5 transition-colors">
    <div className="flex items-start gap-3">
      <span className="text-2xl shrink-0">{emoji}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>
    </div>
  </div>
);

/* ─── section header ──────────────────────────── */
const SectionHeader: React.FC<{ emoji: string; title: string }> = ({ emoji, title }) => (
  <div className="flex items-center gap-2 mb-4">
    <span className="text-xl">{emoji}</span>
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
  </div>
);

/* ─── main component ──────────────────────────── */
const MyInsightsPage: React.FC = () => {
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<MyInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await myInsightsApi.getMonthly(toMonthStr(month, year));
      if (res.data.success && res.data.data) {
        setData(res.data.data);
      } else {
        toast.error(res.data.message || 'Failed to load insights');
      }
    } catch {
      toast.error('Failed to load insights');
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const yearOpts = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const goPrev = () => { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); };
  const goNext = () => { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); };

  /* ─── highlights builder ──────────────────── */
  const buildHighlights = () => {
    if (!data) return [];
    const h = data.highlights;
    const cards: { emoji: string; title: string; description: string }[] = [];

    if (h.longestStreak.days > 0) {
      const usersStr = h.longestStreak.users.join(', ');
      cards.push({
        emoji: '🔥',
        title: 'Longest Office Streak',
        description: `${h.longestStreak.days} consecutive days — ${usersStr}`,
      });
    }

    if (h.mostConsistentPlanner) {
      cards.push({
        emoji: '📅',
        title: 'Most Consistent Planner',
        description: `${h.mostConsistentPlanner} planned ahead like a pro!`,
      });
    }

    cards.push({
      emoji: '🏢',
      title: 'Most Popular Office Day',
      description: `${h.mostPopularOfficeDay} is the team's favorite office day.`,
    });

    if (h.collaborationMagnet) {
      cards.push({
        emoji: '🤝',
        title: 'Collaboration Magnet',
        description: `${h.collaborationMagnet} had the most teammate overlap in the office.`,
      });
    }

    return cards;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">✨ My Insights</h1>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={goPrev} className="px-2.5 py-2 sm:py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm transition-colors">◀</button>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            {yearOpts.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={goNext} className="px-2.5 py-2 sm:py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm transition-colors">▶</button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      )}

      {/* Error / empty */}
      {!loading && !data && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No data available for this month.</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Section 1: Your Month ────────────── */}
          <section>
            <SectionHeader emoji="📋" title="Your Month" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              <StatCard emoji="📆" label="Working Days" value={data.personal.totalWorkingDays} />
              <StatCard emoji="🏢" label="Office Days" value={data.personal.officeDays} accent="text-blue-600 dark:text-blue-400" />
              <StatCard emoji="🏠" label="WFH Days" value={data.personal.wfhDays} accent="text-emerald-600 dark:text-emerald-400" />
              <StatCard emoji="🏖️" label="Leave Days" value={data.personal.leaveDays} accent="text-orange-600 dark:text-orange-400" />
              <StatCard emoji="🔥" label="Office Streak" value={`${data.personal.longestOfficeStreak}d`} sub="Longest consecutive" />
            </div>

            {/* Office percentage ring */}
            <div className="mt-5 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-5 transition-colors">
              <div className="relative">
                <ProgressRing percent={data.personal.officePercent} />
              </div>
              <div className="text-center sm:text-left">
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">Office Attendance</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  You were in the office <span className="font-medium text-gray-900 dark:text-gray-100">{data.personal.officeDays}</span> out of <span className="font-medium text-gray-900 dark:text-gray-100">{data.personal.totalWorkingDays}</span> working days this month.
                </p>
                {/* progress bar fallback for mobile readability */}
                <div className="mt-3 w-full max-w-xs sm:hidden">
                  <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        data.personal.officePercent >= 60
                          ? 'bg-green-500'
                          : data.personal.officePercent >= 30
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${data.personal.officePercent}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{data.personal.officePercent}% office</p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Section 2: Team Snapshot ──────────── */}
          <section>
            <SectionHeader emoji="👥" title="Team Snapshot" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <StatCard
                emoji="📊"
                label="Team Avg Office"
                value={`${data.teamSnapshot.teamAvgOfficePercent}%`}
                accent="text-blue-600 dark:text-blue-400"
              />
              <StatCard
                emoji="🏢"
                label="Popular Day"
                value={data.teamSnapshot.mostPopularOfficeDay}
                accent="text-primary-600 dark:text-primary-400"
              />
              <StatCard
                emoji="🗓️"
                label="Team Office Days"
                value={data.teamSnapshot.totalTeamOfficeDays}
                sub="Aggregate total"
              />
              <StatCard
                emoji="👤"
                label="Team Size"
                value={data.teamSnapshot.teamSize}
                sub="Active members"
              />
            </div>
          </section>

          {/* ── Section 3: Monthly Highlights ────── */}
          {buildHighlights().length > 0 && (
            <section>
              <SectionHeader emoji="🎉" title="Monthly Highlights" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {buildHighlights().map((h, i) => (
                  <HighlightCard key={i} emoji={h.emoji} title={h.title} description={h.description} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default MyInsightsPage;
