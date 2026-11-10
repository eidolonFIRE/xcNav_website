/**
 * MapTiler key for map tiles. It is sent to the browser by design, because every tile request
 * carries it. Restrict it to this site's domains in the MapTiler dashboard (Allowed HTTP origins).
 */
export const MAPTILER_KEY = 'r47XpD5x25FQLCO8tH2l';

/**
 * Polling. The server refreshes a group every 15 s and sends `next`, the seconds until its next
 * refresh, so clients poll just after it. Random jitter keeps many viewers from polling in step.
 */
/** Poll interval when the server sends no hint. Matches the server refresh. */
export const POLL_MS = 15_000;
/** Never poll more often than this. */
export const MIN_POLL_MS = 5_000;
/** Longest wait after repeated errors, unless the server asks for longer with Retry-After. */
export const MAX_BACKOFF_MS = 60_000;
/** Longest Retry-After the page honors. */
export const MAX_RETRY_AFTER_MS = 300_000;
/** Random delay added to every poll, from 0 to this. */
export const JITTER_MS = 2_000;
