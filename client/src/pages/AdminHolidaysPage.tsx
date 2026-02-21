import React, { useEffect, useState } from 'react';
import { holidayApi } from '../api';
import type { Holiday } from '../types';
import toast from 'react-hot-toast';

const AdminHolidaysPage: React.FC = () => {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);

  const [formDate, setFormDate] = useState('');
  const [formName, setFormName] = useState('');

  const fetchHolidays = async () => {
    setLoading(true);
    try {
      const res = await holidayApi.getHolidays();
      setHolidays(res.data.data || []);
    } catch {
      toast.error('Failed to load holidays');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, []);

  const openCreate = () => {
    setEditingHoliday(null);
    setFormDate('');
    setFormName('');
    setShowForm(true);
  };

  const openEdit = (h: Holiday) => {
    setEditingHoliday(h);
    setFormDate(h.date);
    setFormName(h.name);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingHoliday) {
        await holidayApi.updateHoliday(editingHoliday._id, formDate, formName);
        toast.success('Holiday updated');
      } else {
        await holidayApi.createHoliday(formDate, formName);
        toast.success('Holiday created');
      }
      setShowForm(false);
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save holiday');
    }
  };

  const handleDelete = async (h: Holiday) => {
    if (!window.confirm(`Delete holiday "${h.name}" on ${h.date}?`)) return;
    try {
      await holidayApi.deleteHoliday(h._id);
      toast.success('Holiday deleted');
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete holiday');
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

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Manage Holidays</h1>
        <button
          onClick={openCreate}
          className="self-start px-4 py-2.5 sm:py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Add Holiday
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : holidays.length === 0 ? (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">
          No holidays configured. Click "Add Holiday" to get started.
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors">
          <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-left">
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Date</th>
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Name</th>
                <th className="px-2 sm:px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h._id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-2 sm:px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDisplayDate(h.date)}</td>
                  <td className="px-2 sm:px-4 py-3 font-medium text-gray-900 dark:text-gray-100">🎉 {h.name}</td>
                  <td className="px-2 sm:px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(h)}
                      className="text-xs px-2 py-1.5 sm:py-1 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded mr-1 sm:mr-2"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(h)}
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
        <div className="responsive-modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="responsive-modal p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  maxLength={100}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Holiday name"
                />
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
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium"
                >
                  {editingHoliday ? 'Save Changes' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminHolidaysPage;
