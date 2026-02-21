import sanitizeHtml from 'sanitize-html';

/**
 * Strip **all** HTML tags / attributes from user-supplied text.
 *
 * Uses sanitize-html with an empty allow-list so every tag is removed,
 * then trims surrounding whitespace – same contract as the old regex
 * helper but resistant to bypass techniques.
 */
export const sanitizeText = (text: string): string =>
  sanitizeHtml(typeof text === 'string' ? text : '', {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim();
