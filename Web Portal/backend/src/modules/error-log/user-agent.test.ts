import { describe, it, expect } from 'vitest';
import { describeUserAgent } from './user-agent';

describe('describeUserAgent: the browser and system, in a few words', () => {
  it('names common browsers with their major version, and the system', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.92 Safari/537.36')).toEqual({ browser: 'Chrome 130', system: 'Windows' });
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68')).toEqual({ browser: 'Edge 130', system: 'Windows' });
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0')).toEqual({ browser: 'Firefox 132', system: 'macOS' });
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari 17', system: 'iOS' });
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')).toEqual({ browser: 'Chrome 130', system: 'Android' });
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36')).toEqual({ browser: 'Samsung Internet 26', system: 'Android' });
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0')).toEqual({ browser: 'Opera 115', system: 'Linux' });
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36')).toEqual({ browser: 'Chrome 153', system: 'Windows' });
    expect(describeUserAgent('Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Chrome 130', system: 'iOS' });
  });

  it('unknown or missing: says so, and never keeps more than a short text', () => {
    expect(describeUserAgent('')).toEqual({ browser: 'Unknown browser', system: 'Unknown system' });
    expect(describeUserAgent(undefined)).toEqual({ browser: 'Unknown browser', system: 'Unknown system' });
    expect(describeUserAgent('curl/8.4.0')).toEqual({ browser: 'Unknown browser', system: 'Unknown system' });
  });
});
