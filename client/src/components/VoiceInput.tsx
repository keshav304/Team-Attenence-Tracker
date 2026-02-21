import React, { useState, useCallback, useRef, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type VoiceState = 'idle' | 'starting' | 'listening' | 'processing' | 'error';

interface VoiceInputProps {
  /** Called with transcribed text */
  onTranscript: (text: string) => void;
  /** Disable the button */
  disabled?: boolean;
  /** Optional className override */
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Browser speech recognition types                                  */
/* ------------------------------------------------------------------ */

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function friendlyError(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
      return 'Microphone access was denied. Please enable it in browser settings.';
    case 'no-speech':
      return 'No speech detected. Please try again.';
    case 'network':
      return 'Network error during speech recognition. Check your connection.';
    case 'aborted':
      return 'Speech recognition was interrupted.';
    case 'audio-capture':
      return 'No microphone found. Please connect one and try again.';
    case 'service-not-allowed':
      return 'Speech recognition service is not available.';
    default:
      return 'Speech recognition failed. Please type your input instead.';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const VoiceInput: React.FC<VoiceInputProps> = ({ onTranscript, disabled = false, className }) => {
  const [state, setState] = useState<VoiceState>('idle');
  const stateRef = useRef<VoiceState>(state);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const errorTimeoutRef = useRef<number | null>(null);

  /** Set both React state and stateRef synchronously to avoid stale reads in event handlers. */
  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Cache browser support check — safe for SSR (window may not exist during render)
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    const supported = !!getSpeechRecognition();
    setIsSupported(supported);
  }, []);

  /** Schedule a timeout and track it for cleanup. Returns the timeout id. */
  const safeTimeout = useCallback((fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timeoutsRef.current = timeoutsRef.current.filter((t) => t !== id);
      if (errorTimeoutRef.current === id) errorTimeoutRef.current = null;
      fn();
    }, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
      }
      timeoutsRef.current.forEach((id) => clearTimeout(id));
      timeoutsRef.current = [];
    };
  }, []);

  const startListening = useCallback(() => {
    if (stateRef.current !== 'idle' && stateRef.current !== 'error') return;
    setVoiceState('starting');

    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) {
      setErrorMsg('Speech recognition is not supported in this browser.');
      setVoiceState('error');
      if (errorTimeoutRef.current !== null) { clearTimeout(errorTimeoutRef.current); }
      errorTimeoutRef.current = safeTimeout(() => { setVoiceState('idle'); setErrorMsg(null); }, 3000);
      return;
    }

    setErrorMsg(null);
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setVoiceState('listening');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      setVoiceState('processing');
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
      if (transcript.trim()) {
        onTranscript(transcript.trim());
      }
      setVoiceState('idle');
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const msg = friendlyError(event.error);
      setErrorMsg(msg);
      setVoiceState('error');
      if (errorTimeoutRef.current !== null) { clearTimeout(errorTimeoutRef.current); }
      errorTimeoutRef.current = safeTimeout(() => { setVoiceState('idle'); setErrorMsg(null); }, 4000);
    };

    recognition.onend = () => {
      if (stateRef.current === 'listening') {
        setVoiceState('idle');
      }
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setErrorMsg('Failed to start speech recognition.');
      setVoiceState('error');
      if (errorTimeoutRef.current !== null) { clearTimeout(errorTimeoutRef.current); }
      errorTimeoutRef.current = safeTimeout(() => { setVoiceState('idle'); setErrorMsg(null); }, 3000);
    }
  }, [onTranscript, safeTimeout, setVoiceState, stateRef]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    setVoiceState('idle');
  }, [setVoiceState]);

  const handleClick = useCallback(() => {
    if (state === 'listening') {
      stopListening();
    } else if (state === 'idle' || state === 'error') {
      startListening();
    }
  }, [state, startListening, stopListening]);

  if (!isSupported) return null; // Gracefully degrade — no mic button

  return (
    <div className={`voice-input-container ${className || ''}`}>
      <button
        type="button"
        className={`voice-btn voice-btn--${state}`}
        onClick={handleClick}
        disabled={disabled || state === 'processing' || state === 'starting'}
        aria-label={
          state === 'listening'
            ? 'Stop listening'
            : state === 'processing'
            ? 'Transcribing speech'
            : 'Start voice input'
        }
        title={
          state === 'listening'
            ? 'Click to stop'
            : state === 'processing'
            ? 'Transcribing…'
            : 'Voice input'
        }
      >
        {state === 'processing' ? (
          /* Spinner */
          <svg className="voice-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        ) : (
          /* Microphone icon */
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>

      {state === 'listening' && (
        <span className="voice-label" role="status" aria-live="polite">Listening…</span>
      )}
      {state === 'processing' && (
        <span className="voice-label" role="status" aria-live="polite">Transcribing…</span>
      )}
      {errorMsg && (
        <span className="voice-error" role="alert">{errorMsg}</span>
      )}
    </div>
  );
};

export default VoiceInput;
