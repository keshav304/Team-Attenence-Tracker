import React, { useCallback, useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { insightsApi } from '../api';
import type { InsightsResponse, EmployeeInsight } from '../types';

/* ─── helpers ─────────────────────────────────── */
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear = now.getFullYear();

type SortKey = keyof EmployeeInsight;
type SortDir = 'asc' | 'desc';

/* colour helpers */
const pctColor = (pct: number, good: boolean) => {
  if (good) return pct >= 60 ? 'text-green-600' : pct >= 30 ? 'text-amber-600' : 'text-red-500';
  return pct <= 10 ? 'text-green-600' : pct <= 30 ? 'text-amber-600' : 'text-red-500';
};

/* ─── component ───────────────────────────────── */
const InsightsPage: React.FC = () => {
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  /* fetch */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await insightsApi.getInsights(month, year);
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

  /* sorting */
  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.employees];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av;
      return 0;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDir === 'asc' ? '↑' : '↓';
  };

  /* year options */
  const yearOpts = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  /* navigation helpers */
  const goPrev = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const goNext = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  /* ─── mini bar chart (pure CSS) ─────────────── */
  const maxTrend = data ? Math.max(...data.dailyOfficeTrend.map((d) => d.count), 1) : 1;
  const maxDist = data ? Math.max(...data.team.officeDayDistribution.map((x) => x.count), 1) : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">📊 Insights &amp; Analytics</h1>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={goPrev} className="px-2.5 py-2 sm:py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm">◀</button>
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
          <button onClick={goNext} className="px-2.5 py-2 sm:py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm">▶</button>

          {/* Export CSV */}
          <button
            onClick={async () => {
              setExporting(true);
              try {
                const res = await insightsApi.exportCsv(month, year);
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const a = document.createElement('a');
                a.href = url;
                a.download = `attendance-${MONTH_NAMES[month - 1]}-${year}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                toast.success('CSV exported');
              } catch {
                toast.error('Failed to export CSV');
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? (
              <>
                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                Exporting…
              </>
            ) : (
              '📥 Export CSV'
            )}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* ─── Team Summary Cards ─────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <Card label="Employees" value={data.team.totalEmployees} icon="👥" />
            <Card label="Working Days" value={data.totalWorkingDays} icon="📅" />
            <Card label="Total Office Days" value={data.team.totalOfficeDays} icon="🏢" />
            <Card label="Total Leave Days" value={data.team.totalLeaveDays} icon="🏖️" />
            <Card label="Total WFH Days" value={data.team.totalWfhDays} icon="🏠" />
            <Card label="Avg Office / Day" value={data.team.avgOfficePerDay} icon="📈" />
            <Card label="Most Popular Day" value={data.team.mostPopularDay} icon="🔥" />
            <Card label="Least Popular Day" value={data.team.leastPopularDay} icon="💤" />
          </div>

          {/* ─── Day-of-Week Distribution ──────── */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-3 sm:p-4 transition-colors">
            <h2 className="text-base sm:text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Office Day Distribution (by weekday)</h2>
            <div className="flex items-end gap-2 sm:gap-3 h-32 sm:h-40">
              {data.team.officeDayDistribution.map((d) => {
                const pct = (d.count / maxDist) * 100;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{d.count}</span>
                    <div className="w-full bg-primary-100 rounded-t" style={{ height: `${pct}%`, minHeight: 4 }}>
                      <div className="w-full h-full bg-primary-500 rounded-t" />
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{d.day.slice(0, 3)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ─── Daily Office Trend ────────────── */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-3 sm:p-4 transition-colors">
            <h2 className="text-base sm:text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Daily Office Attendance Trend</h2>
            <div className="flex items-end gap-px h-24 sm:h-32 overflow-x-auto">
              {data.dailyOfficeTrend.map((d) => {
                const pct = (d.count / maxTrend) * 100;
                const dayNum = d.date.split('-')[2];
                return (
                  <div key={d.date} className="flex flex-col items-center flex-shrink-0" style={{ width: 18 }}>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{d.count}</span>
                    <div
                      className="w-3.5 bg-primary-400 rounded-t"
                      style={{ height: `${pct}%`, minHeight: 2 }}
                      title={`${d.date}: ${d.count} in office`}
                    />
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{dayNum}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ─── Holidays this month ───────────── */}
          {data.holidays.length > 0 && (
            <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-4 transition-colors">
              <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">Holidays This Month</h2>
              <div className="flex flex-wrap gap-2">
                {data.holidays.map((h) => (
                  <span
                    key={h.date}
                    className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm px-3 py-1 rounded-full"
                  >
                    📌 {h.name} <span className="text-red-400 dark:text-red-500 text-xs">({h.date})</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ─── Employee Metrics Table ─────────── */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 overflow-hidden transition-colors">
            <h2 className="text-base sm:text-lg font-semibold p-3 sm:p-4 border-b dark:border-gray-700 text-gray-900 dark:text-gray-100">Per-Employee Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-left">
                  <tr>
                    {([
                      ['name', 'Name'],
                      ['officeDays', 'Office'],
                      ['leaveDays', 'Leave'],
                      ['wfhDays', 'WFH'],
                      ['officePercent', 'Office %'],
                      ['leavePercent', 'Leave %'],
                      ['wfhPercent', 'WFH %'],
                      ['partialDays', 'Partial'],
                      ['notesCount', 'Notes'],
                      ['totalWorkingDays', 'Work Days'],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th
                        key={key}
                        className="px-2 sm:px-4 py-2 font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none whitespace-nowrap"
                        onClick={() => toggleSort(key)}
                      >
                        {label} <span className="text-xs text-gray-400 dark:text-gray-500">{sortIcon(key)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((emp) => (
                    <tr key={emp.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-2 sm:px-4 py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {emp.name}
                        {emp.role === 'admin' && (
                          <span className="ml-1 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1 py-0.5 rounded">A</span>
                        )}
                      </td>
                      <td className="px-2 sm:px-4 py-2 text-center">{emp.officeDays}</td>
                      <td className="px-2 sm:px-4 py-2 text-center">{emp.leaveDays}</td>
                      <td className="px-2 sm:px-4 py-2 text-center">{emp.wfhDays}</td>
                      <td className={`px-2 sm:px-4 py-2 text-center font-semibold ${pctColor(emp.officePercent, true)}`}>
                        {emp.officePercent}%
                      </td>
                      <td className={`px-2 sm:px-4 py-2 text-center font-semibold ${pctColor(emp.leavePercent, false)}`}>
                        {emp.leavePercent}%
                      </td>
                      <td className="px-2 sm:px-4 py-2 text-center">{emp.wfhPercent}%</td>
                      <td className="px-2 sm:px-4 py-2 text-center text-gray-500 dark:text-gray-400">{emp.partialDays}</td>
                      <td className="px-2 sm:px-4 py-2 text-center text-gray-500 dark:text-gray-400">{emp.notesCount}</td>
                      <td className="px-2 sm:px-4 py-2 text-center text-gray-500 dark:text-gray-400">{emp.totalWorkingDays}</td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-gray-400 dark:text-gray-500">No employee data for this month</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

/* ─── Card sub-component ────────────────────── */
const Card: React.FC<{ label: string; value: string | number; icon: string }> = ({ label, value, icon }) => (
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-3 sm:p-4 flex items-center gap-2 sm:gap-3 transition-colors">
    <span className="text-xl sm:text-2xl">{icon}</span>
    <div className="min-w-0">
      <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">{label}</p>
      <p className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{value}</p>
    </div>
  </div>
);

export default InsightsPage;
