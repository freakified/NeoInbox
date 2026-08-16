/**
 * Stamps recording how much of a message NeoInbox has fetched beyond its
 * header. Kept here rather than next to the code that fetches them so the
 * Dexie schema can reference them without depending on the background.
 */

export const MESSAGE_DETAILS_VERSION = 2;

/**
 * detailsVersion for a row whose details are fetched on demand rather than in
 * the background — sent and draft mail.
 *
 * Their References/In-Reply-To headers only sharpen threading, and getting
 * them costs a body fetch each, so a year of Sent used to be downloaded a
 * message at a time by the details sweep. Threading still works without them
 * (see the subject+participant fallback in shared/threading.ts); these rows
 * are hydrated when you actually open the conversation.
 *
 * Sorting below every real version keeps them out of the sweep's index range
 * without the sweep having to read and discard them.
 */
export const DETAILS_LAZY = -1;
