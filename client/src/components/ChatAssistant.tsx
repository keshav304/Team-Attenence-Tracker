import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import { chatApi, type ChatResponse, type ChatHistoryMessage } from '../api';
import VoiceInput from './VoiceInput';
import Workbot from './Workbot';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatResponse['sources'];
  error?: boolean;
  timestamp: Date;
}

interface ChatAssistantProps {
  /** Optional: current page name to include as context */
  pageName?: string;
}

/** The three views the assistant can show */
type AssistantView = 'mode-select' | 'chatbot' | 'workbot';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const MAX_CHARS = 1000;

const SUGGESTED_QUESTIONS = [
  'What is my office percentage this month?',
  'Who is in office today?',
  'Which day next week has the highest attendance?',
  'Compare my and John\'s office days this month',
  'Suggest the best day to avoid overlap with John next month',
  'Am I below the team average for office attendance?',
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

let idCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++idCounter}`;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

/** Animated typing indicator (three bouncing dots) */
const TypingIndicator: React.FC = () => (
  <div className="chat-bubble chat-bubble--assistant" aria-label="Assistant is typing">
    <span className="typing-dots">
      <span />
      <span />
      <span />
    </span>
  </div>
);

/** Single message bubble */
const MessageBubble: React.FC<{ msg: Message; onCopy: (text: string) => void }> = ({
  msg,
  onCopy,
}) => {
  const isUser = msg.role === 'user';

  return (
    <div className={`chat-row ${isUser ? 'chat-row--user' : 'chat-row--assistant'}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="chat-avatar" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
          </svg>
        </div>
      )}

      <div className="chat-bubble-wrapper">
        <div
          className={`chat-bubble ${
            isUser ? 'chat-bubble--user' : 'chat-bubble--assistant'
          } ${msg.error ? 'chat-bubble--error' : ''}`}
        >
          {/* Render multi-paragraph text */}
          {(() => {
            const lines = msg.text.split('\n');
            return lines.map((line, i) => (
              <React.Fragment key={i}>
                {line}
                {i < lines.length - 1 && <br />}
              </React.Fragment>
            ));
          })()}
        </div>

        {/* Copy button for assistant messages */}
        {!isUser && !msg.error && (
          <button
            className="chat-copy-btn"
            onClick={() => onCopy(msg.text)}
            title="Copy to clipboard"
            aria-label="Copy response to clipboard"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          </button>
        )}

        {/* Sources */}
        {msg.sources && msg.sources.length > 0 && (
          <div className="chat-sources">
            <span className="chat-sources-label">Sources:</span>
            {msg.sources.map((s, i) => (
              <span key={i} className="chat-source-tag">
                {s.source} p.{s.page}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Mode selection panel */
const ModeSelector: React.FC<{
  onSelectChat: () => void;
  onSelectWorkbot: () => void;
}> = ({ onSelectChat, onSelectWorkbot }) => (
  <div className="mode-selector">
    <div className="mode-selector-icon" aria-hidden="true">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
      </svg>
    </div>
    <h3 className="mode-selector-title">How can I help?</h3>
    <div className="mode-selector-options">
      <button className="mode-option mode-option--chat" onClick={onSelectChat}>
        <span className="mode-option-emoji" aria-hidden="true">💬</span>
        <span className="mode-option-label">Ask a Question</span>
        <span className="mode-option-desc">Get help, check attendance, or ask about events</span>
      </button>
      <button className="mode-option mode-option--workbot" onClick={onSelectWorkbot}>
        <span className="mode-option-emoji" aria-hidden="true">⚙️</span>
        <span className="mode-option-label">Update My Schedule</span>
        <span className="mode-option-desc">Use natural language to change your calendar</span>
      </button>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

const ChatAssistant: React.FC<ChatAssistantProps> = ({ pageName }) => {
  const [isOpen, setIsOpen] = useState(() => {
    try {
      return sessionStorage.getItem('chat-open') === '1';
    } catch {
      return false;
    }
  });

  const [view, setView] = useState<AssistantView>('mode-select');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Persist open state
  useEffect(() => {
    try {
      sessionStorage.setItem('chat-open', isOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [isOpen]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus input when chatbot opened
  useEffect(() => {
    if (isOpen && view === 'chatbot') {
      const tid = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(tid);
    }
  }, [isOpen, view]);

  // ------ Actions ------

  const togglePanel = useCallback(() => {
    setIsOpen((o) => {
      if (o) {
        // Closing: reset to mode select for next open
        setView('mode-select');
      }
      return !o;
    });
  }, []);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: Message = {
        id: nextId(),
        role: 'user',
        text: trimmed,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      try {
        // Build conversation history from recent messages (last 3 pairs)
        const history: ChatHistoryMessage[] = messages
          .filter((m) => !m.error)
          .slice(-6)
          .map((m) => ({ role: m.role, text: m.text }));

        const res = await chatApi.ask(trimmed, history.length > 0 ? history : undefined);
        const data = res.data;

        const assistantMsg: Message = {
          id: nextId(),
          role: 'assistant',
          text: data.answer,
          sources: data.sources,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        const backendMessage =
          err &&
          typeof err === 'object' &&
          'response' in err &&
          err.response &&
          typeof err.response === 'object' &&
          'data' in err.response &&
          err.response.data &&
          typeof err.response.data === 'object' &&
          'message' in err.response.data &&
          typeof (err.response.data as { message: unknown }).message === 'string'
            ? (err.response.data as { message: string }).message
            : null;
        const text = backendMessage || 'Sorry, something went wrong. Please try again.';
        const errMsg: Message = {
          id: nextId(),
          role: 'assistant',
          text,
          error: true,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, messages]
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= MAX_CHARS) {
      setInput(val);
    }
    // Auto-grow
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  // Voice transcript handler
  const handleVoiceTranscript = useCallback((text: string) => {
    setInput((prev) => (prev ? prev + ' ' + text : text));
  }, []);

  // ------ Render ------

  return (
    <>
      {/* ── Floating launcher ── */}
      <button
        className={`chat-launcher ${isOpen ? 'chat-launcher--open' : ''}`}
        onClick={togglePanel}
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
        title={isOpen ? 'Close assistant' : 'Open assistant'}
      >
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
          </svg>
        )}
      </button>

      {/* ── Workbot fullscreen overlay ── */}
      {isOpen && view === 'workbot' && (
        <Workbot onBack={() => setView('mode-select')} />
      )}

      {/* ── Chat panel (mode-select or chatbot) ── */}
      {isOpen && view !== 'workbot' && (
        <div
          ref={panelRef}
          className="chat-panel"
          role="dialog"
          aria-label="Help Assistant"
        >
          {/* Header */}
          <div className="chat-header">
            <div className="chat-header-info">
              {view === 'chatbot' && (
                <button
                  className="chat-back-btn"
                  onClick={() => setView('mode-select')}
                  aria-label="Back to mode selection"
                  title="Back"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
              <div className="chat-header-avatar" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
                </svg>
              </div>
              <div>
                <h2 className="chat-header-title">
                  {view === 'mode-select' ? 'Assistant' : 'Help Assistant'}
                </h2>
                <p className="chat-header-subtitle">
                  {view === 'mode-select'
                    ? 'Choose what you need'
                    : 'Ask about the app, your schedule, or team attendance'}
                </p>
              </div>
            </div>
            <div className="chat-header-actions">
              {view === 'chatbot' && messages.length > 0 && (
                <button
                  className="chat-header-btn"
                  onClick={clearChat}
                  title="Clear conversation"
                  aria-label="Clear conversation"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              )}
              <button
                className="chat-header-btn"
                onClick={togglePanel}
                title="Close"
                aria-label="Close assistant"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── MODE SELECT VIEW ── */}
          {view === 'mode-select' && (
            <ModeSelector
              onSelectChat={() => setView('chatbot')}
              onSelectWorkbot={() => setView('workbot')}
            />
          )}

          {/* ── CHATBOT VIEW ── */}
          {view === 'chatbot' && (
            <>
              {/* Messages area */}
              <div className="chat-messages" role="log" aria-live="polite">
                {messages.length === 0 && !isLoading ? (
                  <div className="chat-suggestions">
                    <div className="chat-suggestions-icon" aria-hidden="true">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
                      </svg>
                    </div>
                    <p className="chat-suggestions-label">How can I help you?</p>
                    <div className="chat-suggestions-list">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          className="chat-suggestion-chip"
                          onClick={() => sendMessage(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                    {pageName && (
                      <p className="chat-context-hint">
                        Context: <span>{pageName}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <MessageBubble key={msg.id} msg={msg} onCopy={handleCopy} />
                    ))}
                    {isLoading && <TypingIndicator />}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Copied toast */}
              {copied && (
                <div className="chat-toast" role="status">
                  Copied!
                </div>
              )}

              {/* Input area with voice */}
              <form className="chat-input-area" onSubmit={handleSubmit}>
                <div className="chat-input-wrapper">
                  <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about the app, schedule, or team…"
                    rows={1}
                    maxLength={MAX_CHARS}
                    aria-label="Type your question"
                    disabled={isLoading}
                  />
                  <VoiceInput
                    onTranscript={handleVoiceTranscript}
                    disabled={isLoading}
                    className="chat-voice-btn"
                  />
                  <button
                    type="submit"
                    className="chat-send-btn"
                    disabled={!input.trim() || isLoading}
                    aria-label="Send message"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
                {input.length > MAX_CHARS * 0.9 && (
                  <span className="chat-char-count">
                    {input.length}/{MAX_CHARS}
                  </span>
                )}
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default ChatAssistant;
