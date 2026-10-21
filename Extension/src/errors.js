/** HTTP error from the API (4xx/5xx). Network failures reject as a plain Error (→ offline path). */
export class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    /** The server's own plain-language message (H2), or '' when it sent none. */
    this.serverMessage = message || '';
    this.details = details;
  }
}

/** A change could not be sent AND could not be saved for later (e.g. storage full). Never silent. */
export class QueueError extends Error {
  constructor(message = 'Your change could not be saved on this device. Please try again.') {
    super(message);
    this.name = 'QueueError';
    this.userMessage = message;
  }
}

/**
 * The server could not be asked right now (the session could not be renewed because of a network
 * or server hiccup). Treated like being offline: cached reads are shown and writes are queued.
 */
export class AuthUnavailableError extends Error {
  constructor(message = 'Could not reach the server to renew your session.') {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}

/**
 * A 2xx reply that isn't the API's JSON (M6): a Wi-Fi sign-in page or a proxy answered instead of the
 * server. Treated like being offline — it carries no status — so it is never cached or taken as saved.
 */
export class UnexpectedReplyError extends Error {
  constructor(message = 'The server’s reply could not be read. You may need to sign in to the Wi-Fi network.') {
    super(message);
    this.name = 'UnexpectedReplyError';
  }
}

/**
 * Whether a failed request means "can't reach the server right now" (use cached data / queue the
 * change) rather than an answer the user must see. HTTP 4xx answers such as 401/403/404 are real
 * answers; 408/429 and 5xx are transient.
 */
export function isTransientFailure(error) {
  const status = error && error.status;
  if (typeof status !== 'number') return true; // network error, timeout, session renewal unavailable
  return status === 408 || status === 429 || status >= 500;
}

/**
 * What to tell the person about a failed call (H2): a change that couldn't even be saved on this
 * device explains itself, a 4xx answer shows the server's own plain-language message ("This task was
 * changed by someone else…", a date-order rule, no permission), anything else the screen's `fallback`.
 */
export function messageFor(error, fallback) {
  if (error && error.userMessage) return error.userMessage;
  const status = error && error.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && error.serverMessage) return error.serverMessage;
  return fallback;
}

/**
 * The sign-in screen's message for a refused sign-in (L20). `error` is the server's `{ code, message,
 * details }`. A switched-off account says so in the server's words; a locked one says for how long,
 * and that an emailed code or a password reset (on the website) also gets the person in.
 */
export function signInErrorMessage(status, error = {}) {
  const e = error || {};
  if (status === 423) {
    const seconds = Number(e.details && e.details.retryAfterSeconds);
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : null;
    const wait = minutes ? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` : 'Too many failed attempts.';
    return `Account locked. ${wait} You can also sign in with an emailed code or reset your password on the MICO360 Tasks website.`;
  }
  if (status === 429) return 'Too many attempts — wait a minute and try again.';
  if (status >= 500) return 'The server had a problem. Please try again.';
  if (status === 400 || status === 401) return 'Invalid email or password.';
  if (e.message) return e.message; // e.g. 403 ACCOUNT_INACTIVE: "This account is not active. Contact an administrator."
  return 'Invalid email or password.';
}
