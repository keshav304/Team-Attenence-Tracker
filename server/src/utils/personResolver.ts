/**
 * Stage 2 — Person Resolver
 *
 * Resolves person references from chat queries to User documents.
 * Handles: "me"/"my"/"I", fuzzy name matching, "my team", ambiguity.
 */

import User, { IUser } from '../models/User.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const TEAM_RESOLVE_LIMIT = 100;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ResolvedPerson {
  userId: string;
  name: string;
}

export interface PersonResolutionResult {
  resolved: ResolvedPerson[];
  /** Set when there's ambiguity requiring user clarification */
  clarification?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Escape regex-special characters in a string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/*  Core resolver                                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolve a single name reference to User doc(s).
 * Returns matches or a clarification message.
 */
async function resolveOneName(name: string): Promise<PersonResolutionResult> {
  const users = await User.find({
    isActive: true,
    name: { $regex: '\\b' + escapeRegExp(name), $options: 'i' },
  }).select('name');

  if (users.length === 0) {
    return {
      resolved: [],
      clarification: `I couldn't find anyone named "${name}" in the team. Please check the spelling.`,
    };
  }

  if (users.length > 1) {
    const names = users.map((u) => u.name).join(', ');
    return {
      resolved: [],
      clarification: `I found multiple people matching "${name}": ${names}. Which one did you mean?`,
    };
  }

  return {
    resolved: [{ userId: users[0]._id.toString(), name: users[0].name }],
  };
}

/**
 * Resolve a list of person references from an extracted query.
 *
 * @param people       Names / pronouns extracted from the question
 * @param currentUser  The authenticated user making the request
 */
export async function resolvePeople(
  people: string[],
  currentUser: { _id: any; name: string },
): Promise<PersonResolutionResult> {
  const allResolved: ResolvedPerson[] = [];
  const clarifications: string[] = [];

  for (const ref of people) {
    const lower = ref.toLowerCase().trim();

    // Self-references
    if (['me', 'my', 'i', 'myself', 'mine'].includes(lower)) {
      allResolved.push({
        userId: currentUser._id.toString(),
        name: currentUser.name,
      });
      continue;
    }

    // "my team" → favorites as proxy, or all active users
    if (lower === 'my team' || lower === 'team') {
      const userDoc = await User.findById(currentUser._id).select('favorites');
      if (userDoc?.favorites && userDoc.favorites.length > 0) {
        const favUsers = await User.find({
          _id: { $in: userDoc.favorites },
          isActive: true,
        }).select('name');
        for (const u of favUsers) {
          allResolved.push({ userId: u._id.toString(), name: u.name });
        }
      } else {
        // Fall back to all active users (bounded)
        const allUsers = await User.find({ isActive: true }).select('name').limit(TEAM_RESOLVE_LIMIT);
        for (const u of allUsers) {
          allResolved.push({ userId: u._id.toString(), name: u.name });
        }
      }
      continue;
    }

    // Named person
    const result = await resolveOneName(lower);
    allResolved.push(...result.resolved);
    if (result.clarification) {
      clarifications.push(result.clarification);
    }
  }

  // Deduplicate by userId
  const seen = new Set<string>();
  const deduped: ResolvedPerson[] = [];
  for (const p of allResolved) {
    if (!seen.has(p.userId)) {
      seen.add(p.userId);
      deduped.push(p);
    }
  }

  return {
    resolved: deduped,
    clarification: clarifications.length > 0 ? clarifications.join('\n') : undefined,
  };
}

/**
 * Extract person names from the question text using simple heuristics.
 * Used when the fast-path (Stage 0) detects a person reference.
 * Returns all matched names (multi-word supported), or [] when none found.
 */
export function extractPersonName(question: string): string[] {
  // MVP coverage limitations: these patterns handle common phrasing but
  // may miss complex multi-person queries, indirect references ("my manager"),
  // nicknames, or non-English names. Expand as real user queries surface.
  const patterns = [
    // Existing core patterns
    /\bis\s+([\w'-]+(?:\s+[\w'-]+)*)\s+(on|in|coming|going)/i,
    /\bwhen\s+is\s+([\w'-]+(?:\s+[\w'-]+)*)\s+(coming|going|in)/i,
    /\bwhen\s+will\s+([\w'-]+(?:\s+[\w'-]+)*)\s+(be|come)/i,
    /\bwhere\s+is\s+([\w'-]+(?:\s+[\w'-]+)*)/i,
    /\b([\w'-]+(?:\s+[\w'-]+)*)\s+coming\s+to\s+office/i,
    /\bis\s+([\w'-]+(?:\s+[\w'-]+)*)\s+on\s+leave/i,
    // Possessive form: "What is John's schedule?"
    /\bwhat(?:'s|\s+is)\s+([\w'-]+(?:\s+[\w'-]+)*)'s\s+(?:schedule|status|leave|attendance)/i,
    // Polite request: "Can you check on Alice?"
    /\bcan\s+you\s+(?:check\s+on|look\s+up)\s+([\w'-]+(?:\s+[\w'-]+)*)/i,
    // Tell me about: "Tell me about Bob's leave"
    /\btell\s+me\s+about\s+([\w'-]+(?:\s+[\w'-]+)*)(?:'s\s+(?:leave|schedule|status|attendance))?/i,
    // Wellbeing: "How is Sarah doing?"
    /\bhow\s+is\s+([\w'-]+(?:\s+[\w'-]+)*)\s+(?:doing|feeling)/i,
    // Show/get patterns: "Show me John's attendance"
    /\b(?:show|get)\s+(?:me\s+)?([\w'-]+(?:\s+[\w'-]+)*)'s\s+(?:schedule|status|leave|attendance)/i,
  ];

  const stopWords = new Set([
    'there', 'anyone', 'everyone', 'the', 'any', 'most', 'many',
    'that', 'this', 'next', 'all', 'some', 'each', 'every',
  ]);

  const results: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match) {
      const name = match[1].trim().toLowerCase();
      const firstToken = name.split(/\s+/)[0];
      if (!stopWords.has(firstToken) && !stopWords.has(name) && !seen.has(name)) {
        seen.add(name);
        results.push(name);
      }
    }
  }

  return results;
}
