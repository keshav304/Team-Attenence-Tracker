import React, { useEffect, useState, useCallback } from 'react';
import { eventApi } from '../api';
import { useAuth } from '../context/AuthContext';
import type { CalendarEvent, RsvpStatus, EventRsvp } from '../types';
import toast from 'react-hot-toast';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */
const EVENT_TYPE_EMOJI: Record<string, string> = {
  'team-party': '🎉',
  'mandatory-office': '🏢',
  offsite: '✈️',
  'town-hall': '🎤',
  deadline: '⏰',
  'office-closed': '🚫',
  other: '📌',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  'team-party': 'Team Party',
  'mandatory-office': 'Mandatory Office',
  offsite: 'Offsite',
  'town-hall': 'Town Hall',
  deadline: 'Deadline',
  'office-closed': 'Office Closed',
  other: 'Other',
};

const RSVP_OPTIONS: { status: RsvpStatus; label: string; emoji: string; color: string; activeColor: string }[] = [
  { status: 'going', label: 'Going', emoji: '✅', color: 'border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20', activeColor: 'bg-green-100 dark:bg-green-900/40 border-green-500 dark:border-green-500 text-green-700 dark:text-green-300 ring-2 ring-green-300 dark:ring-green-700' },
  { status: 'maybe', label: 'Maybe', emoji: '⏳', color: 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20', activeColor: 'bg-amber-100 dark:bg-amber-900/40 border-amber-500 dark:border-amber-500 text-amber-700 dark:text-amber-300 ring-2 ring-amber-300 dark:ring-amber-700' },
  { status: 'not_going', label: 'Not Going', emoji: '❌', color: 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20', activeColor: 'bg-red-100 dark:bg-red-900/40 border-red-500 dark:border-red-500 text-red-700 dark:text-red-300 ring-2 ring-red-300 dark:ring-red-700' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getToday(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  RSVP Breakdown (Admin only)                                       */
/* ------------------------------------------------------------------ */
const RsvpBreakdown: React.FC<{ rsvps: EventRsvp[] }> = ({ rsvps }) => {
  const [expanded, setExpanded] = useState(false);
  const [showAllGoing, setShowAllGoing] = useState(false);
  const [showAllMaybe, setShowAllMaybe] = useState(false);
  const [showAllNotGoing, setShowAllNotGoing] = useState(false);

  const going = rsvps.filter((r) => r.status === 'going');
  const maybe = rsvps.filter((r) => r.status === 'maybe');
  const notGoing = rsvps.filter((r) => r.status === 'not_going');

  const COLLAPSE_LIMIT = 10;

  const renderList = (
    items: EventRsvp[],
    showAll: boolean,
    setShowAll: (v: boolean) => void
  ) => {
    const display = showAll ? items : items.slice(0, COLLAPSE_LIMIT);
    return (
      <div>
        {display.map((r, i) => (
          <p key={i} className="text-sm text-gray-700 dark:text-gray-300 ml-4">
            {typeof r.userId === 'object' ? r.userId.name : 'Unknown'}
          </p>
        ))}
        {items.length > COLLAPSE_LIMIT && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="text-xs text-primary-600 dark:text-primary-400 ml-4 mt-1 hover:underline"
          >
            View {items.length - COLLAPSE_LIMIT} more…
          </button>
        )}
        {items.length > COLLAPSE_LIMIT && showAll && (
          <button
            onClick={() => setShowAll(false)}
            className="text-xs text-primary-600 dark:text-primary-400 ml-4 mt-1 hover:underline"
          >
            Show less
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
      >
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        View RSVPs
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {going.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                ✅ Going ({going.length})
              </p>
              {renderList(going, showAllGoing, setShowAllGoing)}
            </div>
          )}
          {maybe.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                ⏳ Maybe ({maybe.length})
              </p>
              {renderList(maybe, showAllMaybe, setShowAllMaybe)}
            </div>
          )}
          {notGoing.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                ❌ Not Going ({notGoing.length})
              </p>
              {renderList(notGoing, showAllNotGoing, setShowAllNotGoing)}
            </div>
          )}
          {going.length === 0 && maybe.length === 0 && notGoing.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 ml-5">No RSVPs yet.</p>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Event Card                                                        */
/* ------------------------------------------------------------------ */
const EventCard: React.FC<{
  event: CalendarEvent;
  isPast: boolean;
  isAdmin: boolean;
  onRsvp: (eventId: string, status: RsvpStatus) => Promise<void>;
  rsvpLoading: string | null;
}> = ({ event, isPast, isAdmin, onRsvp, rsvpLoading }) => {
  const rsvpCounts = event.rsvpCounts || { going: 0, maybe: 0, not_going: 0 };
  const totalRsvps = rsvpCounts.going + rsvpCounts.maybe + rsvpCounts.not_going;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-5 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg">
              {EVENT_TYPE_EMOJI[event.eventType || ''] || '📌'}
            </span>
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
              {event.title}
            </h3>
            {event.eventType && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 whitespace-nowrap">
                {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
              </span>
            )}
          </div>
        </div>
        {isPast && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">
            Past
          </span>
        )}
      </div>

      {/* Details */}
      <div className="mt-2 space-y-1">
        <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
          <span>📅</span> {formatDisplayDate(event.date)}
        </p>
        {event.description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {event.description}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Created by {typeof event.createdBy === 'object' ? event.createdBy.name : 'Admin'}
        </p>
      </div>

      {/* RSVP counts summary */}
      {totalRsvps > 0 && (
        <div className="flex items-center gap-3 mt-3 text-xs text-gray-500 dark:text-gray-400">
          {rsvpCounts.going > 0 && (
            <span className="flex items-center gap-1">✅ {rsvpCounts.going}</span>
          )}
          {rsvpCounts.maybe > 0 && (
            <span className="flex items-center gap-1">⏳ {rsvpCounts.maybe}</span>
          )}
          {rsvpCounts.not_going > 0 && (
            <span className="flex items-center gap-1">❌ {rsvpCounts.not_going}</span>
          )}
        </div>
      )}

      {/* RSVP buttons */}
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        {RSVP_OPTIONS.map((opt) => {
          const isActive = event.myRsvpStatus === opt.status;
          const isLoading = rsvpLoading === `${event._id}-${opt.status}`;
          return (
            <button
              key={opt.status}
              disabled={isPast || !!rsvpLoading}
              onClick={() => onRsvp(event._id, opt.status)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-lg border text-sm font-medium transition-all
                ${isPast ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500' : isActive ? opt.activeColor : opt.color}
              `}
            >
              {isLoading ? (
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
              ) : (
                <>
                  <span>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Admin RSVP breakdown */}
      {isAdmin && event.rsvps && event.rsvps.length > 0 && (
        <RsvpBreakdown rsvps={event.rsvps} />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Events Page                                                       */
/* ------------------------------------------------------------------ */
const EventsPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const today = getToday();

  const fetchEvents = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await eventApi.getEvents(undefined, undefined, signal);
      if (!signal?.aborted) {
        setEvents(res.data.data || []);
      }
    } catch (err: any) {
      if (signal?.aborted) return;
      toast.error('Failed to load events');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchEvents(controller.signal);
    return () => controller.abort();
  }, [fetchEvents]);

  const handleRsvp = async (eventId: string, status: RsvpStatus) => {
    setRsvpLoading(`${eventId}-${status}`);
    try {
      const res = await eventApi.rsvp(eventId, status);
      // Update event in place
      setEvents((prev) =>
        prev.map((ev) =>
          ev._id === eventId && res.data.data
            ? { ...ev, ...res.data.data }
            : ev
        )
      );
      toast.success(`RSVP: ${status === 'not_going' ? 'Not Going' : status.charAt(0).toUpperCase() + status.slice(1)}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to RSVP');
    } finally {
      setRsvpLoading(null);
    }
  };

  const upcomingEvents = events.filter((ev) => ev.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const pastEvents = events.filter((ev) => ev.date < today).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div className="flex flex-col gap-1 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          🎯 Events
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Browse upcoming events and RSVP to let the team know your plans.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-20">
          <span className="text-4xl">🎯</span>
          <p className="mt-3 text-gray-500 dark:text-gray-400">No events yet.</p>
        </div>
      ) : (
        <>
          {/* Upcoming Events */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
              <span>📅</span> Upcoming Events
              <span className="text-xs bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full">
                {upcomingEvents.length}
              </span>
            </h2>
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No upcoming events.</p>
            ) : (
              <div className="grid gap-4">
                {upcomingEvents.map((ev) => (
                  <EventCard
                    key={ev._id}
                    event={ev}
                    isPast={false}
                    isAdmin={isAdmin}
                    onRsvp={handleRsvp}
                    rsvpLoading={rsvpLoading}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Past Events */}
          {pastEvents.length > 0 && (
            <section>
              <button
                onClick={() => setShowPast(!showPast)}
                className="flex items-center gap-2 text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                <svg
                  className={`w-5 h-5 transition-transform ${showPast ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Past Events
                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                  {pastEvents.length}
                </span>
              </button>
              {showPast && (
                <div className="grid gap-4">
                  {pastEvents.map((ev) => (
                    <EventCard
                      key={ev._id}
                      event={ev}
                      isPast={true}
                      isAdmin={isAdmin}
                      onRsvp={handleRsvp}
                      rsvpLoading={rsvpLoading}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default EventsPage;
