/**
 * Date formatters, made once per locale, zone and options. Making an Intl.DateTimeFormat is slow
 * on the phone (Hermes), and a list of meetings formats each card's day and times several times
 * over, again on each keystroke of a search.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The formatter for these settings, made the first time. The locale is always named (a fixed
 * 'en-CA' / 'en-GB' / 'en-US'): the phone's own language never decides how a date reads.
 */
export function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(Object.keys(options).sort().map((k) => [k, options[k as keyof Intl.DateTimeFormatOptions]]))}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}
