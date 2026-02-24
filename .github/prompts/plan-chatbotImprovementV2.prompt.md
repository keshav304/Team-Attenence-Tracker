# Revised Chatbot Improvement Plan — v2

## Addressing All Feedback Gaps

---

## Stage 0 — Lightweight Heuristic Router (NEW — Gap #1)

**Why:** Most queries are simple. Hitting the LLM for "How many office days this month?" is wasteful — the current regex + deterministic handlers already answer these correctly in ~50ms.

**How it works:**

The existing `classifyIntent()` at `analyticsController.ts line 191` becomes **Stage 0**. It stays as the fast path. But we add a **complexity detector** that decides whether to escalate to the LLM:

**Escalation triggers** (any one = go to LLM Stage 1):

| Signal | Detection | Example |
|---|---|---|
| Multi-person reference | 2+ name-like tokens or "and"/"vs"/"compare" + a name | "compare me and Bala" |
| Optimization keyword | `avoid\|minimize\|maximize\|overlap\|best day\|optimal\|suggest\|recommend\|cluster` | "which days to avoid Bala" |
| Simulation keyword | `if I\|what if\|suppose\|assuming\|hypothetically` | "if I go every Tuesday" |
| Comparative keyword | `more than\|less than\|better\|worse\|beat\|higher\|lower\|trend\|increasing\|decreasing` | "am I going more than last month?" |
| Constraint keyword | `but avoid\|except\|not on\|only on\|without` | "suggest days but avoid Mondays" |
| Regex returns `unknown` | Current classification fails | Any unseen phrasing |
| Ambiguous goal | `good day\|good time\|should I` without clear metric | "is next week a good time?" |

**Decision logic:**

```
classify(question):
  intent = regexClassifyIntent(question)      // existing, ~0ms
  isComplex = checkComplexitySignals(question) // new heuristic, ~0ms

  if intent != 'unknown' AND !isComplex:
    → FAST PATH: use existing deterministic handlers (Stage 3-4 directly)
  else:
    → SLOW PATH: LLM extraction (Stage 1 → 2 → 3 → 4 → 5 → 6 → 7)
```

**Performance:** Simple queries stay at ~100-200ms (DB only). Complex queries add ~3-8s (LLM call). No regression for existing functionality.

---

## Stage 1 — LLM Structured Extraction (Complex queries only)

Single LLM call returns structured JSON with intent, people, timeRange, constraints, optimizationGoal, simulationParams.

**Addition: Capability boundary awareness (Gap #10)**

The extraction prompt includes a capability manifest:

```
You are an attendance data assistant. You can ONLY:
- Report historical and planned attendance data
- Compare attendance between employees
- Compute overlap / avoid days
- Suggest optimal office days based on constraints
- Simulate hypothetical scenarios against existing data
- Report team-level aggregates
- Answer questions about holidays and events

You CANNOT:
- Predict future attendance patterns that aren't in the schedule
- Access HR records, salaries, performance reviews, or private data
- Modify anyone's schedule (that's handled by the Workbot feature)
- Answer questions unrelated to workplace attendance

If the query is outside your capability, set intent to "out_of_scope"
with a brief explanation of what you can't do and what you CAN do instead.
```

**Addition: Ambiguity detection (Gap #6)**

The extraction schema includes:

```json
{
  "needsClarification": true,
  "ambiguities": [
    {
      "type": "goal",
      "question": "What do you mean by 'good day'?",
      "options": ["High team presence", "Low crowd", "Maximum overlap with someone", "Meeting a requirement"]
    }
  ]
}
```

Ambiguity types: `goal`, `time` ("February" — which year?), `group` ("my team" — who counts?), `person` (multiple matches).

---

## Stage 2 — Entity + Time Resolution

### Time Resolver Module (Gap #2)

**Existing foundation:** `resolveTimePeriod()` at `analyticsController.ts line 245` already handles 8 expressions. This gets extracted into a standalone `server/src/utils/timeResolver.ts` and extended.

**New expressions to add on top of existing ones:**

| Expression | Resolution |
|---|---|
| `yesterday` | IST today - 1 |
| `last week` | Previous Mon–Fri |
| `last month` | Previous month 1st–last |
| `past N days` / `last N days` | IST today - N → today |
| `YYYY-MM-DD` literal | Direct parse |
| `March 10` / `10th March` | Current year, or next occurrence if past |
| `from X to Y` | Parse both endpoints |
| `this quarter` / `last quarter` | Q1=Jan-Mar, Q2=Apr-Jun, etc. |
| `this year` / `last year` | Jan 1 – Dec 31 |
| `February` (month name alone) | Current year; if ambiguous, clarify |

**IST awareness:** All resolution uses `getTodayString()` from `date.ts line 16` which is already IST-aware. The resolver chains from this anchor.

### Working Day Generator (Gap #3)

**Already exists:** `getWorkingDays()` at `analyticsController.ts line 22` — excludes weekends + holidays. This gets extracted to a shared utility.

**No changes needed for company shutdowns** — the current `Holiday` model at `Holiday.ts` doesn't distinguish types, but all holidays (including shutdowns) are already in the holiday set. If a `type` field is added later to the Holiday model, the generator can filter by type.

### Person Resolver

Uses existing fuzzy name lookup from `analyticsController.ts line 450` (`User.find({ name: { $regex } })`). Extended with:

- `"me"` / `"my"` / `"I"` → `req.user`
- `"my team"` → all active users (no team field exists in `User.ts`; uses `favorites` array as a proxy for "my circle", or all active users if no favorites set)
- Multiple matches → return clarification: "I found Ankit Shah and Ankit Patel. Which one?"
- Zero matches → "I couldn't find anyone named X. Check the spelling?"

---

## Stage 3 — Data Retrieval

### Core retrieval functions (existing + new)

| Function | Status | Location |
|---|---|---|
| `computeAttendanceStats(userId, start, end)` | **Exists** | `analyticsController.ts line 86` |
| `getWorkingDays(start, end, holidaySet)` | **Exists** | `analyticsController.ts line 22` |
| `getUserScheduleMap(userId, range)` | **New** — returns `Map<date, {status, leaveDuration, workingPortion}>` | Extract from existing `entryMap` logic in `computeAttendanceStats` |
| `getTeamPresenceByDay(range)` | **New** — returns `Map<date, {officeUsers: string[], count: number}>` | Adapted from existing code in `handleTeamPresence` line 530 |

### Data Completeness Check (Gap #5)

**New module** added to Stage 3 output:

```
For each resolved person + date range:
  totalWorkingDays = getWorkingDays(range).length
  daysWithEntries = Entry.countDocuments({ userId, date: { $in: workingDays } })
  coverage = daysWithEntries / totalWorkingDays

  attach to response context:
    { userId, name, coverage, daysWithEntries, totalWorkingDays }
```

Used downstream in Stage 7 (confidence layer) to append warnings like:
> "Note: Bala has only set their schedule for 6 of 20 working days next month. Recommendations may change as more data becomes available."

**Threshold rules:**
- coverage >= 80% → high confidence, no warning
- 40-79% → medium confidence, append "partial data" note
- < 40% → low confidence, append strong caveat
- 0% → "No schedule data exists for [person] in [period]. They may not have set it yet."

---

## Stage 4 — Deterministic Reasoning & Computation

### Overlap Calculator (extended, Gap #3 from my insights)

**Existing partial:** `myInsightsController.ts line 222` computes aggregate overlap scores but not pairwise.

**New standalone pairwise function:**

```
computeOverlap(scheduleA, scheduleB, workingDays):
  For each working day:
    scoreA = getPresenceScore(scheduleA.get(day))
    scoreB = getPresenceScore(scheduleB.get(day))
    overlapScore = min(scoreA, scoreB)

  Where getPresenceScore:
    status === 'office'                          → 1.0
    status === 'leave', leaveDuration === 'half',
      workingPortion === 'office'                → 0.5
    everything else (WFH, full leave, no entry)  → 0.0

  Return:
    { totalOverlap, fullOverlapDays[], partialOverlapDays[], zeroOverlapDays[] }
```

This handles TEST 10 (half-day logic) correctly.

### Comparison Engine

```
computeComparison(statsA, statsB):
  diff = statsA.officeDays - statsB.officeDays
  Return: { userA stats, userB stats, diff, who has more, percentageDiff }
```

Handles TEST 1, 5, 13.

### Optimization Solver (with scoring transparency — Gap #4)

```
findOptimalDays(params):
  Input:
    userId, targetUserIds[], dateRange, goal, constraints[],
    requiredDays (optional)

  For each working day in range:
    Compute score based on goal:
      minimize_overlap:  score += (1 - overlapWith(target))  for each target
      maximize_overlap:  score += overlapWith(target)         for each target
      minimize_commute:  score += consecutiveDayBonus
      least_crowded:     score += (1 - teamPresenceRatio)

    Apply constraints:
      "avoid Mondays" → skip if Monday
      "only Tuesdays and Thursdays" → skip if not Tue/Thu

    Attach reasons[]:
      e.g., ["Bala is WFH", "Low team attendance (3/15)", "Mid-week"]

  Sort by score descending
  Pick top N (or requiredDays)

  Return:
    [{
      date: "2026-03-12",
      day: "Thursday",
      score: 0.92,
      reasons: ["Bala is WFH", "Only 3 people in office", "Mid-week collaboration slot"]
    }, ...]
```

**Each recommendation is explainable** — reasons array flows all the way to the final response.

Handles TEST 2, 3, 4, 8, 11, 12.

### Simulation Engine

```
simulateSchedule(proposedDays[], targetUserId, dateRange):
  Get target's schedule map
  For each proposed day:
    Check target's status → compute overlap

  Return:
    {
      proposedDays: ["Tue Mar 3", "Tue Mar 10", ...],
      overlapDays: ["Tue Mar 3", "Tue Mar 17"],
      overlapCount: 2,
      totalProposed: 4,
      overlapPercent: 50
    }
```

Handles TEST 14.

### Trend Analyzer

```
computeTrend(userId, currentRange, previousRange):
  statsA = computeAttendanceStats(userId, currentRange)
  statsB = computeAttendanceStats(userId, previousRange)
  diff = statsA.officeDays - statsB.officeDays
  direction = diff > 0 ? "more" : diff < 0 ? "fewer" : "same"

  Return: { current: statsA, previous: statsB, diff, direction }
```

Handles TEST 6.

---

## Stage 5 — Relevance Guard (NEW — Gap #7)

**This is the "assertion" that prevents the current failure mode of returning unrelated summaries.**

After Stage 4 produces a computed result, before formatting:

```
validateRelevance(extractedIntent, computedResult):

  Rules:
  1. If intent === 'comparison' but result contains only 1 person's data
     → REJECT: "I couldn't retrieve data for both people"

  2. If intent === 'overlap' but result has no overlap computation
     → REJECT: fall to clarification

  3. If intent === 'optimize' but result has no scored recommendations
     → REJECT: "Not enough schedule data to make recommendations"

  4. If intent === any specific type but handler returned generic summary
     → REJECT: never substitute a generic summary for a specific query

  5. If computed answer is empty/null
     → Don't fabricate — say "I don't have enough data"
```

**Implementation:** Each handler returns a typed result object with an `answersIntent` field. The guard checks `result.answersIntent === extractedIntent`. Mismatch = reject.

---

## Stage 6 — Natural Language Post-Processor (NEW — Gap #8)

**Current approach:** Handlers return hardcoded template strings (e.g., `"Your in-office percentage is ${officePercent}%"`).

**New approach:** Deterministic computation produces **structured data**. An LLM call (or template engine for simple cases) converts it to natural language.

**Two tiers:**

| Complexity | Method | Example |
|---|---|---|
| Simple (single stat, yes/no) | Template string, no LLM | "You have 8 office days this month (40%)." |
| Complex (comparison, optimization, multi-entity) | LLM paraphrase with structured data injected | "Bala attended 4 more days than you. She was in office 60% of working days compared to your 40%." |

**For LLM paraphrase, the prompt is:**

```
You are formatting a workplace attendance answer. Convert the structured
data below into a natural, concise response. Do NOT add information
beyond what's provided. Keep the tone professional and helpful.

Computed data:
{...JSON with stats, diffs, recommendations, reasons...}

User's original question: "..."

Write a direct answer.
```

This ensures:
- Natural phrasing, pluralization, varied sentence structure
- Consistent professional tone
- Zero hallucination (data is pre-computed, LLM only formats)

---

## Stage 7 — Confidence & Explanation Layer (NEW — Gaps #4, #5)

**Appended to every response before sending:**

### Data freshness annotation (Gap #5)

```
For each person involved:
  If coverage < 80%:
    append: "⚠️ {name}'s schedule is only {coverage}% set for {period}.
             Results may change."
  If coverage === 0%:
    append: "⚠️ {name} hasn't set their schedule for {period} yet."
```

### Explain mode (bonus)

When the response contains optimization recommendations, the `reasons[]` from the solver are included:

```
Recommended days: Tuesday March 10, Thursday March 19

Why Tuesday March 10?
• Bala is WFH that day
• Low office attendance (4/15 people)
• Mid-week — good for focused work

Why Thursday March 19?
• Bala is on leave
• Team standup moved to Friday that week
```

If a user later asks *"Why did you recommend Tuesday?"* — the conversation context (Stage memory, below) holds the solver output, and the response simply surfaces the `reasons[]` for that date.

### Capability boundary response (Gap #10)

```
If intent === 'out_of_scope':
  Return: "I can only analyze recorded and planned attendance data.
           I can't {specific thing they asked}.
           Here's what I can help with: [comparisons, scheduling suggestions,
           team presence, overlap analysis, ...]"
```

---

## Memory Strategy (revised)

**Client-side:** Send the last 3 message pairs (user + assistant) alongside the current question. Update the API schema:

```
POST /chat {
  question: string,
  history?: { role: 'user'|'assistant', text: string }[]
}
```

**Server-side:** Pass history into the LLM extraction prompt (Stage 1) for reference resolution. **Do not persist** history server-side — client is the source of truth.

**Used for:**
- "What about Bala?" → previous question was about attendance → comparison
- "And last month?" → previous answer was about March → February
- "Why did you recommend Tuesday?" → previous response had solver reasons → surface them

---

## Updated Intent Taxonomy

| Intent | Fast Path (Stage 0) | LLM Path (Stage 1) |
|---|---|---|
| `personal_attendance` | Yes (existing regex) | Fallback |
| `team_presence` | Yes (existing regex) | Fallback |
| `team_analytics` | Yes (existing regex) | Fallback |
| `event_query` | Yes (existing regex) | Fallback |
| `comparison` | No | Yes |
| `overlap` | No | Yes |
| `avoid` | No | Yes |
| `optimize` | No | Yes |
| `simulate` | No | Yes |
| `meeting_plan` | No | Yes |
| `trend` | No | Yes |
| `multi_person_coordination` | No | Yes |
| `clarify_needed` | No | Yes |
| `out_of_scope` | No | Yes |
| `explain_previous` | No | Yes (needs history) |
| `unknown` → RAG fallback | — | After both paths fail |

---

## Revised Full Pipeline

```
User Question + History (optional)
         │
         ▼
┌─ Stage 0: FAST HEURISTIC ROUTER ────────────┐
│  regexClassify() + complexitySignals()       │
│  Simple + known? → FAST PATH ──────────────────→ Stage 3
│  Complex / unknown? ↓                        │
└──────────────────────────────────────────────┘
         │
         ▼
┌─ Stage 1: LLM STRUCTURED EXTRACTION ────────┐
│  Intent, people[], timeRange, constraints,   │
│  goal, simulation, ambiguities,              │
│  capability check                            │
└──────────────────────┬───────────────────────┘
                       │
         ▼                        ▼
  clarify_needed?           out_of_scope?
  → Return question          → Return boundary msg
  with options
         │
         ▼
┌─ Stage 2: ENTITY + TIME RESOLUTION ─────────┐
│  People → User docs (fuzzy match)            │
│  Time expression → {startDate, endDate}      │
│  Ambiguity? → Clarification                  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌─ Stage 3: DATA RETRIEVAL ────────────────────┐
│  Entries, Holidays, Events, User docs        │
│  computeAttendanceStats() for each person    │
│  Coverage check per person                   │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌─ Stage 4: DETERMINISTIC REASONING ───────────┐
│  Comparison / Overlap / Optimization /       │
│  Simulation / Trend / Team aggregates        │
│  All deterministic — no LLM                  │
│  Solver returns scored results + reasons[]   │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌─ Stage 5: RELEVANCE GUARD ──────────────────┐
│  Does result match intent?                   │
│  Is it empty? Generic? Mismatched?           │
│  REJECT if assertion fails → fallback msg    │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌─ Stage 6: RESPONSE GENERATION ──────────────┐
│  Simple → template string (no LLM)          │
│  Complex → LLM paraphrase (data injected)   │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌─ Stage 7: CONFIDENCE + EXPLANATION ─────────┐
│  Append coverage warnings if < 80%          │
│  Attach solver reasons for "explain mode"   │
│  Capability boundary if out_of_scope        │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
                  Final Response
```

---

## Priority Implementation Order

| Priority | Module | Impact | Effort |
|---|---|---|---|
| **P0** | Stage 0 — complexity detector + router | Prevents regression, keeps simple queries fast | Low |
| **P1** | Stage 1 — LLM extraction with full intent taxonomy | Unlocks all complex intents | Medium |
| **P2** | Time resolver module (extracted + extended) | Correct time ranges for everything downstream | Medium |
| **P3** | Pairwise overlap calculator | Core for comparison/avoid/optimize/simulate | Low |
| **P4** | Comparison engine | Handles the most-reported failure case | Low |
| **P5** | Optimization solver with reasons[] | Handles avoid/suggest/meeting-plan queries | Medium |
| **P6** | Stage 5 — relevance guard | Prevents "always return summary" failure | Low |
| **P7** | Data completeness check | Trust and accuracy for future schedule queries | Low |
| **P8** | Conversation history support | Reference resolution, explain mode | Medium |
| **P9** | Stage 6 — LLM paraphrase for complex answers | Natural language quality | Low |
| **P10** | Capability boundary layer | Graceful out-of-scope handling | Low |
| **P11** | Simulation engine | "If I go every Tuesday" scenarios | Medium |
| **P12** | Test suite (15+ cases) | Regression safety | Medium |

---

## Risks Updated

| Risk | Mitigation |
|---|---|
| Stage 0 router mis-classifies complex as simple | Lean toward escalation — false positive (LLM for simple query) costs 3s; false negative (deterministic for complex query) gives wrong answer |
| LLM extraction latency on free tier | Stage 0 fast path handles 60-70% of queries with zero LLM cost |
| Relevance guard too aggressive | Log rejected answers for review; tune thresholds based on real usage |
| History increases prompt size → may hit token limits | Cap at 3 turns; summarize older messages |
| Coverage warning spam | Only show once per person per response; suppress if all people have high coverage |

---

## Test Cases (must all pass)

| # | Query | Expected Intent | Key Validation |
|---|---|---|---|
| 1 | "Compare my and Bala's average office days in Feb" | comparison | Both users' stats shown, diff computed |
| 2 | "On which day should I go to office next month to avoid Bala" | avoid | Bala's schedule analyzed, non-overlap days suggested |
| 3 | "On which days should I go to office next month to have minimum overlap with Bala" | optimize (minimize_overlap) | Scored recommendations with reasons |
| 4 | "Which days should I go next month to maximize overlap with Bala?" | optimize (maximize_overlap) | Top overlap days suggested |
| 5 | "Suggest a good day for a long in-person meeting with Bala" | meeting_plan | Day where both are in office suggested |
| 6 | "Which day is least crowded next month?" | team_analytics | Day with lowest attendance identified |
| 7 | "How can I meet the minimum office requirement with the fewest trips?" | optimize (minimize_commute) | Clustered days suggested |
| 8 | "Who came to office more in Feb — me or Bala?" | comparison | Direct comparison with count and diff |
| 9 | "Am I going to office more or less than last month?" | trend | Two months compared, direction stated |
| 10 | "How many days did Bala and I work together in office this month?" | overlap | Pairwise overlap count |
| 11 | "Suggest days when most of my team will be in office" | team_analytics | High-presence days listed |
| 12 | "If I go on March 10, will Bala be there?" | team_presence | Bala's status on that date |
| 13 | "If Bala has a half-day leave, does that still count as overlap?" | clarify_needed / overlap | Half-day logic explained |
| 14 | "Suggest office days next month where Bala is also in office but avoid Mondays" | optimize with constraints | Constrained recommendations |
| 15 | "When will Bala and Priya both be in office?" | multi_person_coordination | Dates where both are office |
| 16 | "Am I below the team average for office attendance?" | comparison (vs team avg) | User vs average, gap stated |
| 17 | "If I go every Tuesday next month, how much overlap will I have with Bala?" | simulate | Projected overlap count |
| 18 | "Is next week a good time to go to office?" | clarify_needed | Clarification question with options |
| 19 | "Predict Bala's attendance next year" | out_of_scope | Capability boundary response |
| 20 | "Why did you recommend Tuesday?" | explain_previous | Solver reasons surfaced from history |
