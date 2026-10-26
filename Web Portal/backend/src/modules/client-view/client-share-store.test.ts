import { clientShareStoreContract } from './client-share-store.contract';
import { createMemoryClientShareStore } from './client-share-store';

clientShareStoreContract('in memory', async () => ({ store: createMemoryClientShareStore(), projectA: 'p-a', projectB: 'p-b' }));
