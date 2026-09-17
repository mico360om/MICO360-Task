import { emptyConfig, type AiConfig } from './ai-config';

/** Persistence port for the AI configuration document. */
export interface AiConfigRepository {
  load(): Promise<AiConfig>;
  save(config: AiConfig): Promise<void>;
}

/** In-memory implementation for tests. */
export function createMemoryAiConfigRepository(initial: AiConfig = emptyConfig()): AiConfigRepository {
  let config = initial;
  return {
    async load() {
      return config;
    },
    async save(next) {
      config = next;
    },
  };
}
