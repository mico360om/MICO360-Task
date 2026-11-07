import { treeOf, type ChecklistTree } from '../lib/checklist-tree';

/**
 * 1.23.3: task templates and a project template's tasks also carry `checklists` — the checklists'
 * titles and nesting — beside the older flat `checklist` (every item's text). The server reads an old
 * flat list as one "Checklist". Kept apart from api/templates.ts, whose types the Android app mirrors
 * letter for letter until its own nested view.
 */
export interface WithChecklists {
  checklists?: ChecklistTree;
}

/** A template's (or a template task's) checklists: its tree, else its old flat list as one "Checklist". */
export function templateTree(t: { checklist?: string[] | null } & WithChecklists): ChecklistTree {
  return treeOf(t.checklists, t.checklist);
}

/** A template answer with something to fill a checklist from (the tree or the flat list). */
export const hasChecklistData = (t: { checklist?: unknown } & { checklists?: unknown }): boolean => Array.isArray(t.checklists) || Array.isArray(t.checklist);
