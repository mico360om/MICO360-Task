import { z } from 'zod';
import { requiredText } from './validation';
import { checklistTreeOf, treeLimits, MAX_DEPTH, MAX_ITEMS, MAX_LISTS, TEXT_MAX, type ChecklistNode, type ChecklistTree } from './checklist-tree';

/** How deep a sent tree goes, counted without recursion (a hostile, very deep body can't overflow the stack). */
function depthOf(raw: unknown): number {
  let deepest = 0;
  const stack: { nodes: unknown; level: number }[] = [];
  if (Array.isArray(raw)) for (const l of raw) stack.push({ nodes: (l as { items?: unknown } | null)?.items, level: 1 });
  while (stack.length) {
    const { nodes, level } = stack.pop()!;
    if (!Array.isArray(nodes) || nodes.length === 0) continue;
    deepest = Math.max(deepest, level);
    if (deepest > MAX_DEPTH) return deepest;
    for (const n of nodes) stack.push({ nodes: (n as { children?: unknown } | null)?.children, level: level + 1 });
  }
  return deepest;
}

const nodeSchema: z.ZodType<ChecklistNode> = z.lazy(() =>
  z.object({ text: requiredText, children: z.array(nodeSchema).max(MAX_ITEMS).optional() }),
);

/**
 * 1.23.3: a checklist tree as the New task form and the template editors send it — checklists with
 * titles, items with sub-items (no people or dates). Trimmed; a blank title becomes "Checklist"; at most
 * 50 checklists, 500 items and 20 levels, each text at most 191 characters.
 */
export const checklistTreeSchema: z.ZodType<ChecklistTree, z.ZodTypeDef, unknown> = z
  .unknown()
  .refine((raw) => depthOf(raw) <= MAX_DEPTH, { message: `A checklist can have at most ${MAX_DEPTH} levels.` })
  .pipe(z.array(z.object({ title: z.string().trim().max(TEXT_MAX), items: z.array(nodeSchema).max(MAX_ITEMS) })).max(MAX_LISTS))
  .transform((tree) => checklistTreeOf(tree))
  .superRefine((tree, ctx) => {
    const why = treeLimits(tree);
    if (why) ctx.addIssue({ code: z.ZodIssueCode.custom, message: why });
  });
