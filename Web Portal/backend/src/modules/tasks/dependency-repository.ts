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
  /**
   * N12: every task `taskId` directly depends on, those in the Recycle Bin too — the loop check follows
   * them, since a restored task brings its links back. Absent (fakes): `dependsOn`.
   */
  dependsOnAny?(taskId: string): Promise<string[]>;
  /**
   * Review fix #12: run `work` one at a time across the whole site (a hold taken first), with reads and
   * writes that see every link added before it — so two links made at the same moment can't close a
   * loop together. Absent (fakes): `work` runs as is.
   */
  oneAtATime?<T>(work: (repo: DependencyRepository) => Promise<T>): Promise<T>;
}
