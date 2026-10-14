/**
 * Helpers for `<input type="date">` boxes whose value drives a request.
 *
 * While a date is typed by hand the browser reports an empty value (a part is unfinished) and then
 * real-but-unintended dates (typing the year 2026 passes through 0002, 0020 and 0202). The box must
 * be allowed to hold those — forcing the old date back scrambles the digits typed next — but the
 * request should wait for a whole, plausible date.
 */

/** A complete calendar date (YYYY-MM-DD) with a plausible year. */
export function isWholeDate(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value >= '2000-01-01';
}

/** Both ends are whole dates and the range ends before it starts. */
export function isBackwards(from: string, to: string): boolean {
  return isWholeDate(from) && isWholeDate(to) && from > to;
}
