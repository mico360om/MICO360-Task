/**
 * A browser's user agent as the Error log shows it: "Chrome 130" on "Windows". Only these two short
 * words are kept with a report, never the whole user-agent text.
 */
export function describeUserAgent(ua: string | null | undefined): { browser: string; system: string } {
  const s = String(ua ?? '').slice(0, 512);
  const version = (re: RegExp) => re.exec(s)?.[1];
  let browser = 'Unknown browser';
  const pick = (name: string, re: RegExp) => {
    const v = version(re);
    if (v && browser === 'Unknown browser') browser = `${name} ${v}`;
  };
  pick('Edge', /\bEdg(?:e|A|iOS)?\/(\d+)/);
  pick('Opera', /\bOPR\/(\d+)/);
  pick('Samsung Internet', /\bSamsungBrowser\/(\d+)/);
  pick('Firefox', /\b(?:Firefox|FxiOS)\/(\d+)/);
  // HeadlessChrome: an automated Chrome (a test, a monitoring tool).
  pick('Chrome', /\b(?:HeadlessChrome|Chrome|CriOS)\/(\d+)/);
  if (browser === 'Unknown browser' && /\bSafari\//.test(s)) pick('Safari', /\bVersion\/(\d+)/);

  let system = 'Unknown system';
  if (/\b(?:iPhone|iPad|iPod)\b/.test(s)) system = 'iOS';
  else if (/\bAndroid\b/.test(s)) system = 'Android';
  else if (/\bWindows\b/.test(s)) system = 'Windows';
  else if (/\bMac OS X\b|\bMacintosh\b/.test(s)) system = 'macOS';
  else if (/\bCrOS\b/.test(s)) system = 'ChromeOS';
  else if (/\bLinux\b|\bX11\b/.test(s)) system = 'Linux';
  return { browser, system };
}
