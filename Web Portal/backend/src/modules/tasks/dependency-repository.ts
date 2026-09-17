export interface DependencyEdge {
  id: string;
  /** the dependent (blocked) task */
  taskId: string;
  /** the task it depends on (the blocker) */
  dependsOnTaskId: string;
}

export interface DependencyRepository {
  add(taskId: string, dependsOnTaskId: string): Promise<DependencyEdge>;
  remove(taskId: string, dependsOnTaskId: string): Promise<void>;
  exists(taskId: string, dependsOnTaskId: string): Promise<boolean>;
  /** Task ids that `taskId` directly depends on (its blockers). */
  dependsOn(taskId: string): Promise<string[]>;
  /** Task ids that directly depend on `taskId` (the ones it blocks). */
  blocks(taskId: string): Promise<string[]>;
}
