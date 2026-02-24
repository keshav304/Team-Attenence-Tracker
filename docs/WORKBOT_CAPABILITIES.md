# Workbot — Capabilities & Improvement Roadmap

## Overview

The **Schedule Workbot** is a natural-language scheduling assistant embedded in the A-Team-Tracker client. It lets authenticated users describe schedule changes in plain English (or via voice), previews the resulting changes in an editable table, and batch-applies them to the database — all through a three-step pipeline: **Parse → Resolve → Apply**.

---

## Current Capabilities

### 1. Natural-Language Command Parsing (LLM-Powered)

| Feature | Details |
|---|---|
| **LLM backend** | OpenRouter API with automatic model fallback across 4 free-tier models: `nemotron-nano-9b-v2`, `llama-3.3-70b-instruct`, `gemma-3-12b-it`, `deepseek-r1-0528` |
| **Prompt injection protection** | System prompt and user command are sent as separate messages; user instructions that attempt to override the system role are explicitly blocked in the prompt |
| **Structured output** | LLM returns a JSON `StructuredPlan` with `actions[]` (type, status, dateExpressions, note, leave fields, filterByCurrentStatus) and a human-readable `summary` |
| **Third-party schedule blocking** | If the command references another person's schedule (e.g. "set Bala's days as office"), the backend detects `targetUser`, compares it to the authenticated user, and rejects the request with a 403 |

### 2. Status Types Supported

| Status | Behaviour |
|---|---|
| `office` | Marks the day as in-office |
| `leave` | Marks the day as on leave (full or half-day) |
| `clear` | Deletes the entry, reverting to the WFH default |
| `wfh` / `work from home` | Interpreted as `clear` (WFH is the implicit default) |

### 3. Half-Day Leave Support

- **Half-day detection**: Recognises "half day leave", "half-day off", "morning leave", "afternoon leave", etc.
- **Fields**: `leaveDuration` (`full` | `half`), `halfDayPortion` (`first-half` | `second-half`), `workingPortion` (`wfh` | `office`)
- **Defaults**: If the user doesn't specify which half → `first-half`; if working portion isn't stated → `wfh`
- Fields are carried through the entire Parse → Resolve → Apply pipeline and stored on the Entry document

### 4. Date Expression Resolution (Server-Side, Deterministic)

The backend resolves LLM-generated date expressions into concrete `YYYY-MM-DD` dates. Supported expressions:

| Expression Pattern | Example |
|---|---|
| Exact date | `2026-03-02` |
| Relative day | `today`, `tomorrow` |
| Named day (next occurrence) | `Friday`, `next Monday`, `this Wednesday` |
| Weekly range | `this week`, `next week` (Mon–Fri) |
| Monthly range | `next month`, `rest of this month` (weekdays only) |
| Recurring day in month | `every Monday next month`, `every Friday this month` |
| Multiple days in month | `Monday Wednesday Friday of next month` |
| Days in specific month/year | `Monday Wednesday of March 2026` |

**Automatic exclusions**: Weekends and holidays are resolved but flagged as `valid: false` with a reason.

### 5. Status-Aware Filtering

Commands can reference existing schedule state:

- "Clear every office day" → `filterByCurrentStatus: 'office'` — only dates currently marked `office` are included
- "Change all leave days to office" → `filterByCurrentStatus: 'leave'`
- "Clear my WFH days" → `filterByCurrentStatus: 'wfh'` (no entry exists)

Entries are batch-fetched and filtered before the preview is generated.

### 6. Editable Preview Table (Client-Side)

Before changes are applied, users see a full preview table with:

- **Select/deselect** individual rows or toggle all
- **Change status** per row via dropdown (`office` / `leave` / `clear`)
- **Edit notes** per row via inline text input
- **Remove rows** entirely from the batch
- **Invalid-row indication** — weekend/holiday/out-of-window dates shown greyed out with a reason badge
- **Template application** — pre-saved templates (fetched from `templateApi`) can be applied to all selected rows at once, setting status and note
- **Selection count** displayed in the footer

### 7. Voice Input

- Integrated `VoiceInput` component using the Web Speech API (`SpeechRecognition`)
- Transcribed text is appended to the command textarea
- Works alongside typed input

### 8. Example Command Chips

Four pre-built example commands are shown in the input phase for quick one-click use:

1. *Mark Monday Wednesday Friday of next month as office.*
2. *Set next week as leave.*
3. *Half day leave tomorrow morning, WFH other half.*
4. *Clear Friday.*

### 9. Validation & Safety

| Layer | Protection |
|---|---|
| **Zod schemas** (middleware) | Validates `parse`, `resolve`, and `apply` request bodies; enforces field constraints, date format, leave-field consistency |
| **Rate limiter** | `/apply` endpoint: 10 requests per minute per user (keyed by `user._id`) |
| **Date window enforcement** | Non-admin users can only modify dates within the allowed editing window (`isMemberAllowedDate`) |
| **Holiday checking** | Holidays fetched from DB; holiday dates flagged invalid |
| **Transactional writes** | All apply operations run inside a Mongoose session/transaction for atomicity |
| **Max batch size** | 100 changes per apply request; 50 actions per resolve request |
| **Input sanitisation** | Control characters stripped from commands; max 1000 chars |
| **Admin bypass** | Admin users skip the date-window restriction |

### 10. Multi-Model Fallback

The LLM caller cycles through 4 models sequentially. Each model gets a 60-second timeout. On rate-limit (429) or error, it falls through to the next model. Parsing fails only when all models fail.

### 11. UX Phases

The UI is structured as a state machine with 7 phases:

`input` → `parsing` → `resolving` → `preview` → `applying` → `done` → (reset to `input`)

Error state (`error`) can be entered from any processing phase, with "Try Again" returning to `input`.

---

## Areas for Improvement

### A. Functional Enhancements

#### A1. WFH Status as First-Class Entry
Currently WFH is the implicit default (absence of entry). Adding an explicit `wfh` status would allow:
- Distinction between "hasn't filled in yet" vs "deliberately WFH"
- Better analytics (WFH days counted explicitly)
- Status-aware filtering for WFH days without relying on "no entry" heuristic

#### A2. Recurring / Pattern Schedules
- **"Set every Monday and Wednesday as office for the next 3 months"** — requires the date resolver to handle multi-month spans
- **Weekly templates**: "Apply my default week every week until end of quarter"
- Save recurring patterns as named schedules users can re-apply

#### A3. Undo / Rollback Support
- After applying, offer a one-click "Undo last batch" that restores previous entry states
- Store a snapshot of overwritten entries before applying so rollback is lossless

#### A4. Multi-User / Manager Commands (Admin)
- Currently blocked: admins could benefit from setting schedules on behalf of team members
- E.g. "Set the whole team as office on March 15" or "Mark Rahul as leave next Friday"
- Requires permission model and audit logging

#### A5. Conflict Detection & Warnings
- Warn if the user is overwriting an existing entry (e.g. overwriting `leave` with `office`)
- Show the **current status** alongside the proposed change in the preview table
- Detect conflicts with team events (e.g. "You have a team meeting on this leave day")

#### A6. Smarter Date Expressions
Currently unresolved expressions are silently dropped. Add support for:
- **Relative ranges**: "next 2 weeks", "the first 10 working days of April"
- **Exclusion syntax**: "next month except March 17"
- **Ordinal dates**: "the 3rd Monday of next month"
- **Date ranges**: "March 3 to March 14"

#### A7. Batch Note Editing
- Apply the same note to all selected rows at once from the preview footer
- Currently each row must be edited individually

#### A8. Copy Previous Week/Month
- "Copy last week's schedule to next week" — clone entries from one date range to another

### B. Technical / Architecture Improvements

#### B1. Streaming LLM Response
- Currently the full LLM response is awaited, causing UI to sit on "Understanding your command…" for up to 60 seconds per model
- Stream tokens via SSE or WebSocket so the user sees partial output in real time

#### B2. Caching / Deduplication
- Cache recent parse results (command → plan) to avoid redundant LLM calls for identical or near-identical commands
- Deduplicate resolve calls for the same plan within a session

#### B3. Offline / PWA Support for Workbot
- Queue commands when offline and sync when back online
- The app already has a service worker — extend it to cache Workbot interactions

#### B4. Client-Side Date Pre-Validation
- Before hitting the server, validate obvious issues on the client (weekends, past dates for non-admins) to reduce round-trips
- Show inline warnings in the textarea as the user types

#### B5. Telemetry & Analytics
- Track command success/failure rates, most common expressions, LLM model hit rates
- Feed failure patterns back to improve the system prompt or add regex fallbacks
- Dashboard for admins to see Workbot usage stats

#### B6. Prompt Versioning & A/B Testing
- Version the system prompt; allow rolling back if a new prompt degrades quality
- A/B test prompt variations to measure parse accuracy

#### B7. Accessibility Improvements
- Add `aria-live` regions for phase transitions so screen readers announce state changes
- Ensure the preview table is fully navigable with keyboard-only interaction
- Announce selected count changes to assistive technology

#### B8. Better Error Recovery
- On LLM parse failure, show the raw interpretation attempt and let the user manually adjust
- Offer intelligent rephrasing suggestions based on the original failed command
- Retry with a different system prompt variant before giving up

#### B9. Unit & Integration Tests
- The date resolution logic (`resolveDateExpressions`) is highly testable — add comprehensive unit tests for every expression pattern
- Integration tests for the full Parse → Resolve → Apply pipeline
- Mock LLM responses for deterministic test runs

#### B10. Move LLM Configuration to Admin Settings
- Allow admins to configure preferred LLM models, API keys, and timeout from the UI instead of `.env` file changes
- Runtime model priority ordering without redeployment

### C. UX / Design Improvements

#### C1. Command History
- Show recently used commands for quick re-use
- Persist across sessions (localStorage or server-side)

#### C2. Auto-Complete / Suggestions
- As the user types, suggest completions based on common patterns
- Show date previews inline (e.g. "next Monday" → "March 2, 2026")

#### C3. Calendar Visual Preview
- Instead of (or in addition to) a table, show a mini calendar view with affected dates highlighted in colour
- Tap/click on calendar dates to toggle selection

#### C4. Animated Phase Transitions
- Smooth transitions between phases instead of hard state swaps
- Progress indicator showing Parse → Resolve → Preview → Apply steps

#### C5. Dark Mode Polish
- Ensure all Workbot-specific styles have appropriate dark mode variants
- Half-day leave indicator colours should adapt to dark theme (currently uses hardcoded `text-orange-600`)

#### C6. Multi-Language Support
- The LLM can already understand commands in many languages, but the UI chrome (labels, examples, error messages) is English-only
- Internationalise the component for broader team adoption

---

## Architecture Summary

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT (React)                            │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │  INPUT    │───▶│ PARSING  │───▶│ PREVIEW  │───▶│  DONE    │   │
│  │ (voice + │    │(spinner) │    │(editable │    │(success  │   │
│  │  text)   │    │          │    │  table)  │    │ summary) │   │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘   │
│       │               │               │               │          │
│       ▼               ▼               ▼               ▼          │
│  VoiceInput     workbotApi       workbotApi       workbotApi     │
│  component       .parse()        .resolve()       .apply()       │
└──────────────────────────────────────────────────────────────────┘
        │               │               │               │
        ▼               ▼               ▼               ▼
┌──────────────────────────────────────────────────────────────────┐
│                       SERVER (Express)                            │
│                                                                  │
│  Middleware:  auth → Zod validation → rate limiter (apply only)   │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │ parseCommand   │  │ resolvePlan   │  │ applyChanges  │        │
│  │               │  │               │  │               │        │
│  │ • sanitise    │  │ • resolve     │  │ • upsert or   │        │
│  │ • callLLM()   │  │   dateExprs   │  │   delete      │        │
│  │ • extract JSON│  │ • validate    │  │   entries     │        │
│  │ • block 3rd   │  │   (weekends,  │  │ • transaction │        │
│  │   party cmds  │  │   holidays,   │  │ • atomic      │        │
│  │               │  │   window)     │  │   batch       │        │
│  └───────┬───────┘  │ • status      │  └───────────────┘        │
│          │          │   filtering   │                            │
│          ▼          └───────────────┘                            │
│   OpenRouter API                                                 │
│   (4 model fallback)                                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

| Method | Path | Middleware | Purpose |
|---|---|---|---|
| POST | `/workbot/parse` | `authenticate`, `validateParse` | Send NL command → receive structured plan |
| POST | `/workbot/resolve` | `authenticate`, `validateResolve` | Send plan actions → receive resolved dated changes |
| POST | `/workbot/apply` | `authenticate`, `applyRateLimiter`, `validateApply` | Send confirmed changes → write to database |

---

## Data Flow (Per Request)

1. **User types or speaks** a command (max 1000 chars)
2. **`/parse`** — Server sanitises input, sends to LLM with structured system prompt, extracts JSON plan, blocks third-party targeting
3. **`/resolve`** — Server resolves date expressions deterministically, validates each date (weekends, holidays, editing window), applies status filters, deduplicates, returns preview
4. **User reviews** preview table — selects/deselects rows, changes statuses, edits notes, applies templates
5. **`/apply`** — Server re-validates, runs upserts/deletes in a Mongoose transaction (max 100 per batch), returns result counts
