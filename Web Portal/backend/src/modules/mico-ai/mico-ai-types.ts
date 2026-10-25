import type { ProposalDraft } from './mico-ai-actions-types';

/**
 * MICO AI's shapes: the records a read-only tool returns (each row carries the source it came
 * from), the tables and sources of an answer (built by the server from those rows, never from the
 * model's own text), and what a chat message holds.
 */

export type SourceType = 'task' | 'project' | 'meeting' | 'chat' | 'person';

/** Where a fact came from: a record the person can open (url) or name (a person has no page). */
export interface SourceRef {
  type: SourceType;
  id: string;
  /** What the chip says: a task key, a project or meeting name, "Omar · 21 Oct". */
  label: string;
  /** The website path that opens it (`?task=<id>` opens the task panel on the current page). */
  url: string | null;
}

/** The handle the model uses for a source: "task:<id>". */
export const refKey = (r: Pick<SourceRef, 'type' | 'id'>): string => `${r.type}:${r.id}`;

/** How a column's values are shown (and stored in a download). */
export type CellKind = 'text' | 'key' | 'date' | 'datetime' | 'number' | 'percent' | 'days';

export interface ResultColumn {
  key: string;
  label: string;
  /** Default 'text'. 'date' is 'YYYY-MM-DD'; 'datetime' is 'YYYY-MM-DD HH:mm' (company time); 'days' a whole number of days. */
  kind?: CellKind;
}

export type CellValue = string | number | null;

export interface ResultRow {
  ref: SourceRef | null;
  values: Record<string, CellValue>;
}

/** What one read-only tool found. */
export interface ToolResult {
  /** r1, r2 … unique within the chat. */
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** e.g. "Overdue tasks in Rig Inspection Portal". */
  title: string;
  columns: ResultColumn[];
  /** The rows found (at most MAX_RESULT_ROWS are kept). */
  rows: ResultRow[];
  /** How many matched in all (may be more than the rows kept). */
  total: number;
  /** Fewer rows were kept than matched (`total` says how many matched). */
  truncated?: boolean;
  /** Extra detail for the model (a task's comments, a meeting's notes); not stored for tables. */
  details?: unknown;
  /** Further records the details name (blockers, a meeting's tasks): citable as sources. */
  detailRefs?: SourceRef[];
  /** Why the tool could not answer (bad arguments, nothing the person can see by that name). */
  error?: string;
}

/** A result as kept on the answer, so later questions in the chat can cite and tabulate it. */
export type StoredResult = Omit<ToolResult, 'details'>;

/** A table in an answer: columns and rows copied from a tool result by the server. */
export interface AnswerTable {
  title: string;
  /** The result it was built from. */
  fromResult: string;
  columns: ResultColumn[];
  rows: Array<{ ref: SourceRef | null; cells: CellValue[] }>;
  /** How many matched in all: more than the rows when the list was capped ("Showing 200 of 250"). */
  total?: number;
}

/**
 * What MICO AI said: an answer (text, tables, sources), a clarifying question with quick replies,
 * or a card of proposed changes (they happen only once the person confirms them).
 */
export interface AssistantContent {
  kind: 'answer' | 'clarify' | 'proposal';
  /** A small Markdown subset: paragraphs, "- " bullets, **bold**. */
  text: string;
  /** "That isn't in MICO360": shown as the amber note. */
  unavailable: boolean;
  tables: AnswerTable[];
  sources: SourceRef[];
  followUps: string[];
  /** A clarifying question's quick replies. */
  options: string[];
  /** The tool results found for this question (kept for later questions; not sent to the page). */
  results: StoredResult[];
  /** A proposal's card as the server checked it (stored on its own; the message keeps its id). */
  proposal?: ProposalDraft;
  /** The stored card of a proposal. */
  proposalId?: string;
}

/** At most this many rows of a result are kept (tables and downloads use them all). */
export const MAX_RESULT_ROWS = 200;
