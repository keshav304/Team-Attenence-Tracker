import React, { useEffect, useState } from 'react';
import { eventApi } from '../api';
import type { CalendarEvent } from '../types';
import toast from 'react-hot-toast';

/** Canonical map: event-type slug → emoji (single source of truth). */
const EVENT_TYPE_EMOJI: Record<string, string> = {
  'team-party': '🎉',
  'mandatory-office': '🏢',
  offsite: '✈️',
  'town-hall': '🎤',
  deadline: '⏰',
  'office-closed': '🚫',
  other: '📌',
};

/** Human-readable names keyed by slug. */
const EVENT_TYPE_LABELS: Record<string, string> = {
  'team-party': 'Team Party',
  'mandatory-office': 'Mandatory Office',
  offsite: 'Offsite',
  'town-hall': 'Town Hall',
  deadline: 'Deadline',
  'office-closed': 'Office Closed',
  other: 'Other',
};

/** Derived select-options — emojis come from EVENT_TYPE_EMOJI. */
const EVENT_TYPE_OPTIONS = [
  { value: '', label: 'None' },
  ...Object.entries(EVENT_TYPE_EMOJI).map(([key, emoji]) => ({
    value: key,
    label: `${emoji} ${EVENT_TYPE_LABELS[key] ?? key}`,
  })),
];

const AdminEventsPage: React.FC = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const [formDate, setFormDate] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEventType, setFormEventType] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Filter
  const [filterMonth, setFilterMonth] = useState('');

  const fetchEvents = async (signal?: AbortSignal) => {
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
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchEvents(controller.signal);
    return () => controller.abort();
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    if (!showForm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowForm(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showForm]);

  const openCreate = () => {
    setEditingEvent(null);
    setFormDate('');
    setFormTitle('');
    setFormDescription('');
    setFormEventType('');
    setShowForm(true);
  };

  const openEdit = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setFormDate(ev.date);
    setFormTitle(ev.title);
    setFormDescription(ev.description || '');
    setFormEventType(ev.eventType || '');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        date: formDate,
        title: formTitle,
        description: formDescription || undefined,
        eventType: formEventType || undefined,
      };

      if (editingEvent) {
        await eventApi.updateEvent(editingEvent._id, payload);
        toast.success('Event updated');
      } else {
        await eventApi.createEvent(payload);
        toast.success('Event created');
      }
      setShowForm(false);
      fetchEvents();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save event');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (ev: CalendarEvent) => {
    if (!window.confirm(`Delete event "${ev.title}" on ${ev.date}?`)) return;
    try {
      await eventApi.deleteEvent(ev._id);
      toast.success('Event deleted');
      fetchEvents();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete event');
    }
  };

  const formatDisplayDate = (dateStr: string): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Filtered events
  const filteredEvents = filterMonth
    ? events.filter((ev) => ev.date.startsWith(filterMonth))
    : events;

  // Unique months for filter
  const months = Array.from(new Set(events.map((ev) => ev.date.slice(0, 7)))).sort();

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Manage Events</h1>
        <button
          onClick={openCreate}
          className="self-start px-4 py-2.5 sm:py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Add Event
        </button>
      </div>

      {/* Filter */}
      {months.length > 1 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">Filter by month:</label>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="">All</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {new Date(Number(m.split('-')[0]), Number(m.split('-')[1]) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">
          {events.length === 0
            ? 'No events yet. Click "Add Event" to create one.'
            : 'No events match the selected filter.'}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors">
          <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-left">
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Date</th>
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Event</th>
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 hidden sm:table-cell">Type</th>
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 hidden md:table-cell">Description</th>
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((ev) => (
                <tr key={ev._id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-2 sm:px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {formatDisplayDate(ev.date)}
                  </td>
                  <td className="px-2 sm:px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                    {EVENT_TYPE_EMOJI[ev.eventType || ''] || '📌'} {ev.title}
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-gray-600 dark:text-gray-400 hidden sm:table-cell">
                    {ev.eventType ? (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                        {ev.eventType}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate hidden md:table-cell">
                    {ev.description || <span className="text-gray-400 dark:text-gray-500">—</span>}
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(ev)}
                      className="text-xs px-2 py-1.5 sm:py-1 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded mr-1 sm:mr-2"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(ev)}
                      className="text-xs px-2 py-1.5 sm:py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div
          className="responsive-modal-backdrop"
          onClick={() => setShowForm(false)}
        >
          <div
            className="responsive-modal p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingEvent ? 'Edit Event' : 'Add Event'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date *</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title *</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  required
                  maxLength={150}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g. Team Party, Town Hall"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Event Type</label>
                <select
                  value={formEventType}
                  onChange={(e) => setFormEventType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {EVENT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description <span className="text-gray-400 dark:text-gray-500 font-normal">(optional, max 500 chars)</span>
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value.slice(0, 500))}
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  placeholder="Optional details about the event..."
                />
                <div className="text-right text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {formDescription.length}/500
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : editingEvent ? 'Save Changes' : 'Add Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminEventsPage;
