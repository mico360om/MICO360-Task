import { inspectionStoreContract } from './inspection-store.contract';
import { createMemoryInspectionStore } from './inspection-store';

let n = 0;
inspectionStoreContract('in memory', async () => {
  const store = createMemoryInspectionStore();
  return {
    store,
    projectA: 'p-a',
    projectB: 'p-b',
    makeTask: async () => `task-${++n}`,
    deleteTask: async (taskId) => store.deleteTask(taskId),
    moveInspection: async (id, projectId) => store.setProject(id, projectId),
  };
});
