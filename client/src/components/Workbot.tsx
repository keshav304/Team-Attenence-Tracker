import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import VoiceInput from './VoiceInput';
import axios from 'axios';
import { workbotApi, templateApi } from '../api';
import type {
  WorkbotAction,
  WorkbotResolvedChange,
  WorkbotApplyItem,
  WorkbotApplyResult,
  Template,
} from '../types';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type WorkbotPhase =
  | 'input'        // User entering command
  | 'parsing'      // LLM extracting intent
  | 'resolving'    // Backend resolving dates
  | 'preview'      // Showing editable preview table
  | 'applying'     // Sending changes to backend
  | 'done'         // Success feedback
  | 'error';       // Error state

interface WorkbotProps {
  onBack: () => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const EXAMPLE_COMMANDS = [
  'Mark Monday Wednesday Friday of next month as office.',
  'Set next week as leave.',
  'Half day leave tomorrow morning, WFH other half.',
  'Clear Friday.',
];

const STATUS_OPTIONS: ('office' | 'leave' | 'clear')[] = ['office', 'leave', 'clear'];

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const Workbot: React.FC<WorkbotProps> = ({ onBack }) => {
  const [phase, setPhase] = useState<WorkbotPhase>('input');
  const [command, setCommand] = useState('');
  const [parseSummary, setParseSummary] = useState('');
  const [changes, setChanges] = useState<WorkbotResolvedChange[]>([]);
  const [applyResult, setApplyResult] = useState<WorkbotApplyResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ── Fetch templates ── */
  useEffect(() => {
    templateApi.getTemplates()
      .then((res) => setTemplates(res.data.data || []))
      .catch((err) => console.warn('Failed to load templates:', err));
  }, []);

  /* ── Apply template to all selected rows ── */
  const applyTemplateToRows = useCallback((tpl: Template) => {
    const statusVal = tpl.status as 'office' | 'leave';
    setChanges((prev) =>
      prev.map((c) => (c.valid && c.selected ? { ...c, status: statusVal, note: tpl.note || c.note } : c))
    );
  }, []);

  /* ── Submit command ── */
  const handleSubmit = useCallback(
    async (text?: string) => {
      const cmd = (text || command).trim();
      if (!cmd) return;
      setCommand(cmd);
      setErrorMessage('');

      try {
        // Phase 1: Parse
        setPhase('parsing');
        const parseRes = await workbotApi.parse(cmd);
        const plan = parseRes.data.data;
        if (!plan || !plan.actions?.length) {
          setErrorMessage('Could not understand the command. Please try rephrasing.');
          setPhase('error');
          return;
        }
        setParseSummary(plan.summary || '');

        // Phase 2: Resolve
        setPhase('resolving');
        const resolveRes = await workbotApi.resolve(plan.actions as WorkbotAction[]);
        const resolved = resolveRes.data.data;
        if (!resolved || !resolved.changes?.length) {
          setErrorMessage('No dates could be resolved from the command.');
          setPhase('error');
          return;
        }

        // Mark valid items as selected by default
        const withSelection = resolved.changes.map((c) => ({
          ...c,
          selected: c.valid,
        }));
        setChanges(withSelection);
        setPhase('preview');
      } catch (err: unknown) {
        const backendMsg = extractErrorMsg(err);
        setErrorMessage(backendMsg || 'Something went wrong. Please try again.');
        setPhase('error');
      }
    },
    [command]
  );

  /* ── Confirm & apply ── */
  const handleApply = useCallback(async () => {
    const selected = changes.filter((c) => c.selected && c.valid);
    if (selected.length === 0) {
      setErrorMessage('No changes selected to apply.');
      return;
    }

    setPhase('applying');
    setErrorMessage('');

    try {
      const items: WorkbotApplyItem[] = selected.map((c) => ({
        date: c.date,
        status: c.status,
        note: c.note,
        ...(c.status === 'leave' && c.leaveDuration === 'half' ? {
          leaveDuration: c.leaveDuration,
          ...(c.halfDayPortion ? { halfDayPortion: c.halfDayPortion } : {}),
          ...(c.workingPortion ? { workingPortion: c.workingPortion } : { workingPortion: 'wfh' as const }),
        } : {}),
      }));
      const res = await workbotApi.apply(items);
      const result = res.data?.data;
      if (result) {
        setApplyResult(result);
        setPhase('done');
      } else {
        console.error('Workbot apply: unexpected response shape', res.data);
        setErrorMessage('Unexpected server response. Please try again.');
        setPhase('error');
      }
    } catch (err: unknown) {
      const backendMsg = extractErrorMsg(err);
      setErrorMessage(backendMsg || 'Failed to apply changes.');
      setPhase('error');
    }
  }, [changes]);

  /* ── Row toggling ── */
  const toggleRow = useCallback((date: string) => {
    setChanges((prev) =>
      prev.map((c) => (c.date === date && c.valid ? { ...c, selected: !c.selected } : c))
    );
  }, []);

  const toggleAll = useCallback(() => {
    const allSelected = changes.filter((c) => c.valid).every((c) => c.selected);
    setChanges((prev) =>
      prev.map((c) => (c.valid ? { ...c, selected: !allSelected } : c))
    );
  }, [changes]);

  /* ── Status change per row ── */
  const changeRowStatus = useCallback((date: string, status: 'office' | 'leave' | 'clear') => {
    setChanges((prev) =>
      prev.map((c) => (c.date === date ? { ...c, status } : c))
    );
  }, []);

  /* ── Remove row ── */
  const removeRow = useCallback((date: string) => {
    setChanges((prev) => prev.filter((c) => c.date !== date));
  }, []);

  /* ── Note change per row ── */
  const changeRowNote = useCallback((date: string, note: string) => {
    setChanges((prev) =>
      prev.map((item) => (item.date === date ? { ...item, note } : item))
    );
  }, []);

  /* ── Reset ── */
  const resetAll = useCallback(() => {
    setPhase('input');
    setCommand('');
    setParseSummary('');
    setChanges([]);
    setApplyResult(null);
    setErrorMessage('');
  }, []);

  /* ── Voice handler ── */
  const handleVoiceTranscript = useCallback((text: string) => {
    setCommand((prev) => (prev ? prev + ' ' + text : text));
  }, []);

  /* ── Form events ── */
  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /* ── Escape key to go back ── */
  useEffect(() => {
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onBack]);

  const selectedCount = changes.filter((c) => c.selected && c.valid).length;
  const isProcessing = phase === 'parsing' || phase === 'resolving' || phase === 'applying';

  /* ── Render ── */
  return (
    <div className="workbot-overlay" role="dialog" aria-label="Schedule Workbot">
      {/* Header */}
      <div className="workbot-header">
        <button
          className="workbot-back-btn"
          onClick={onBack}
          aria-label="Back to mode selection"
          title="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="workbot-header-info">
          <div className="workbot-header-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <h2 className="workbot-header-title">Schedule Workbot</h2>
            <p className="workbot-header-subtitle">Update your schedule with natural language</p>
          </div>
        </div>
        {phase !== 'input' && (
          <button
            className="workbot-reset-btn"
            onClick={resetAll}
            aria-label="New command"
            title="New command"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="workbot-content">
        {/* ── INPUT PHASE ── */}
        {phase === 'input' && (
          <div className="workbot-input-phase">
            <div className="workbot-examples">
              <p className="workbot-examples-label">Try saying something like:</p>
              <div className="workbot-examples-list">
                {EXAMPLE_COMMANDS.map((ex) => (
                  <button
                    key={ex}
                    className="workbot-example-chip"
                    onClick={() => { setCommand(ex); handleSubmit(ex); }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <form className="workbot-input-form" onSubmit={onFormSubmit}>
              <div className="workbot-input-wrapper">
                <textarea
                  ref={inputRef}
                  className="workbot-textarea"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={'Describe your schedule changes, e.g.\n"Mark Monday Wednesday Friday next month as office."'}
                  rows={3}
                  maxLength={1000}
                  aria-label="Schedule command"
                />
                <div className="workbot-input-actions">
                  <VoiceInput onTranscript={handleVoiceTranscript} />
                  <button
                    type="submit"
                    className="workbot-submit-btn"
                    disabled={!command.trim()}
                    aria-label="Process command"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* ── PROCESSING PHASES ── */}
        {isProcessing && (
          <div className="workbot-processing">
            <div className="workbot-spinner" aria-hidden="true" />
            <p className="workbot-processing-text">
              {phase === 'parsing' && 'Understanding your command…'}
              {phase === 'resolving' && 'Resolving dates…'}
              {phase === 'applying' && 'Applying changes…'}
            </p>
            {parseSummary && phase !== 'parsing' && (
              <p className="workbot-processing-summary">{parseSummary}</p>
            )}
          </div>
        )}

        {/* ── PREVIEW PHASE ── */}
        {phase === 'preview' && (
          <div className="workbot-preview">
            {parseSummary && (
              <div className="workbot-summary-bar">
                <span className="workbot-summary-icon" aria-hidden="true">💡</span>
                <span>{parseSummary}</span>
              </div>
            )}

            {/* Template picker for the preview table */}
            {templates.length > 0 && (
              <div className="workbot-summary-bar" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className="workbot-summary-icon" aria-hidden="true">⚡</span>
                <span style={{ fontSize: '0.8125rem' }}>Apply template to selected rows:</span>
                {templates.map((tpl) => {
                  const statusEmoji: Record<string, string> = {
                    office: '🏢',
                    leave: '🌴',
                    clear: '🧹',
                  };
                  const emoji = statusEmoji[tpl.status] ?? '📋';
                  return (
                    <button
                      key={tpl._id}
                      className="workbot-example-chip"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                      onClick={() => applyTemplateToRows(tpl)}
                    >
                      {emoji} {tpl.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="workbot-table-wrapper">
              <table className="workbot-table" role="grid">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={changes.some(c => c.valid) && changes.filter(c => c.valid).every(c => c.selected)}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Status</th>
                    <th>Note</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (
                    <tr
                      key={c.date}
                      className={`workbot-row ${!c.valid ? 'workbot-row--invalid' : ''} ${c.selected ? 'workbot-row--selected' : ''}`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={!!c.selected}
                          onChange={() => toggleRow(c.date)}
                          disabled={!c.valid}
                          aria-label={`Select ${c.date}`}
                        />
                      </td>
                      <td className="workbot-cell-date">{c.date}</td>
                      <td>{c.day}</td>
                      <td>
                        {c.valid ? (
                          <div className="flex flex-col gap-0.5">
                            <select
                              className="workbot-status-select"
                              value={c.status}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'office' || val === 'leave' || val === 'clear') {
                                  changeRowStatus(c.date, val);
                                }
                              }}
                              aria-label={`Status for ${c.date}`}
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            {c.status === 'leave' && c.leaveDuration === 'half' && (
                              <span className="text-[10px] text-orange-600 dark:text-orange-400">
                                ½ {c.halfDayPortion === 'first-half' ? 'AM' : 'PM'} leave, {c.workingPortion === 'office' ? '🏢' : '🏠'} other half
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="workbot-invalid-badge" title={c.validationMessage}>
                            {c.validationMessage}
                          </span>
                        )}
                      </td>
                      <td>
                        {c.valid ? (
                          <input
                            type="text"
                            className="workbot-note-input"
                            value={c.note || ''}
                            onChange={(e) => changeRowNote(c.date, e.target.value)}
                            placeholder="Optional"
                            maxLength={500}
                            aria-label={`Note for ${c.date}`}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <button
                          className="workbot-remove-btn"
                          onClick={() => removeRow(c.date)}
                          aria-label={`Remove ${c.date}`}
                          title="Remove"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="workbot-preview-footer">
              <span className="workbot-selection-count">
                {selectedCount} day{selectedCount !== 1 ? 's' : ''} selected
              </span>
              <div className="workbot-preview-actions">
                <button
                  className="workbot-btn workbot-btn--secondary"
                  onClick={resetAll}
                >
                  Edit Command
                </button>
                <button
                  className="workbot-btn workbot-btn--secondary"
                  onClick={onBack}
                >
                  Cancel
                </button>
                <button
                  className="workbot-btn workbot-btn--primary"
                  onClick={handleApply}
                  disabled={selectedCount === 0}
                >
                  Confirm {selectedCount} Change{selectedCount !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── DONE PHASE ── */}
        {phase === 'done' && applyResult && (
          <div className="workbot-done">
            <div className="workbot-done-icon" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h3 className="workbot-done-title">Changes Applied!</h3>
            <p className="workbot-done-summary">
              {applyResult.processed} update{applyResult.processed !== 1 ? 's' : ''} applied
              {applyResult.failed > 0 && `, ${applyResult.failed} failed`}.
            </p>
            {applyResult.failed > 0 && (
              <div className="workbot-done-errors">
                {applyResult.results
                  .filter((r) => !r.success)
                  .map((r) => (
                    <p key={r.date} className="workbot-done-error-line">
                      {r.date}: {r.message}
                    </p>
                  ))}
              </div>
            )}
            <div className="workbot-done-actions">
              <button className="workbot-btn workbot-btn--primary" onClick={resetAll}>
                New Command
              </button>
              <button className="workbot-btn workbot-btn--secondary" onClick={onBack}>
                Back to Assistant
              </button>
            </div>
          </div>
        )}

        {/* ── ERROR PHASE ── */}
        {phase === 'error' && (
          <div className="workbot-error-phase">
            <div className="workbot-error-icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="workbot-error-text">{errorMessage}</p>
            <div className="workbot-error-actions">
              <button className="workbot-btn workbot-btn--primary" onClick={resetAll}>
                Try Again
              </button>
              <button className="workbot-btn workbot-btn--secondary" onClick={onBack}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Helpers ── */

function extractErrorMsg(err: unknown): string | null {
  if (axios.isAxiosError(err)) {
    const msg = err.response?.data?.message;
    return typeof msg === 'string' ? msg : null;
  }
  return null;
}

export default Workbot;
