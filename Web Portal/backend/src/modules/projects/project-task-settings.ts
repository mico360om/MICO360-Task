/** A project's settings for its tasks (the "Tasks" section of the project form). */
export interface ProjectTaskSettings {
  /**
   * Each night, unfinished tasks on past board days move to today's board. The company-wide switch
   * (system setting `carryForward.enabled`) comes first: when that is off, nothing carries.
   */
  carryForward: boolean;
  /** A task added to the project without a due date gets today's date. Dates people choose are kept. */
  defaultDueToday: boolean;
}

/** What every project starts with — and what every project had before the settings existed. */
export const PROJECT_TASK_DEFAULTS: ProjectTaskSettings = { carryForward: true, defaultDueToday: false };
