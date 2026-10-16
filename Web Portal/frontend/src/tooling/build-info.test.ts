import { describe, it, expect } from 'vitest';
import { buildInfo } from './build-info';

describe('buildInfo (Vite plugin)', () => {
  it('publishes build-info.json beside the app, with the version and the build time', () => {
    const plugin = buildInfo({ version: '1.0.0', builtAt: '2026-10-16T15:30:00.000Z' });
    const emitted: unknown[] = [];
    (plugin.generateBundle as (this: unknown) => void).call({ emitFile: (f: unknown) => emitted.push(f) });
    expect(emitted).toEqual([
      { type: 'asset', fileName: 'build-info.json', source: '{"version":"1.0.0","builtAt":"2026-10-16T15:30:00.000Z"}\n' },
    ]);
    expect(plugin.apply).toBe('build');
  });
});
