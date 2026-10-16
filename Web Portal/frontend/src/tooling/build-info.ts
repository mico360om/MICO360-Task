import type { Plugin } from 'vite';

/**
 * Publishes build-info.json beside the built web app: this build's version and the time it was made.
 * A page that is open compares it (fetched fresh) with the build it is running, so after a
 * deployment it can say a new version is available instead of showing old information.
 */
export function buildInfo(info: { version: string; builtAt: string }): Plugin {
  return {
    name: 'mico360-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: `${JSON.stringify({ version: info.version, builtAt: info.builtAt })}\n` });
    },
  };
}
