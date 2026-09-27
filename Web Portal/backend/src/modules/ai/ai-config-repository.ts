import { emptyConfig, type AiConfig } from './ai-config';

/** Persistence port for the AI configuration document. */
export interface AiConfigRepository {
  load(): Promise<AiConfig>;
  save(config: AiConfig): Promise<void>;
  /**
   * Read-modify-write the document atomically, so two admins editing at once can't overwrite
   * each other. `change` gets the latest config and may run again if a concurrent write won.
   */
  update(change: (config: AiConfig) => AiConfig | Promise<AiConfig>): Promise<AiConfig>;
}

/** In-memory implementation for tests. */
export function createMemoryAiConfigRepository(initial: AiConfig = emptyConfig()): AiConfigRepository {
  let config = initial;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async load() {
      return config;
    },
    async save(next) {
      config = next;
    },
    update(change) {
      // Serialise updates like the database version does.
      const run = queue.then(async () => {
        config = await change(config);
        return config;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
