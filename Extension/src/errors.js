/** HTTP error from the API (4xx/5xx). Network failures reject as a plain Error (→ offline path). */
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
 * Whether a failed request means "can't reach the server right now" (use cached data / queue the
 * change) rather than an answer the user must see. HTTP 4xx answers such as 401/403/404 are real
 * answers; 408/429 and 5xx are transient.
 */
export function isTransientFailure(error) {
  const status = error && error.status;
  if (typeof status !== 'number') return true; // network error, timeout, session renewal unavailable
  return status === 408 || status === 429 || status >= 500;
}
