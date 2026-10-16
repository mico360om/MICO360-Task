/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The web app's version (package.json) and build time (ISO), set by the build (vite.config.ts). */
declare const __APP_VERSION__: string;
declare const __APP_BUILT_AT__: string;
