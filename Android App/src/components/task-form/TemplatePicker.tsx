import React from 'react';
import { InlinePicker } from '../meeting/sheet-kit';
import { TEMPLATE_TEXT, templateHint } from '../../lib/task-form';
import type { TaskTemplate } from '../../lib/types';

/**
 * "Start from a template" (New task, the website's): the person's task templates by name, each with
 * how many checklist items it brings. Picking one fills in the form (lib/task-form applyTemplate).
 * Making and editing templates stays on the website.
 */
export function TemplatePicker({
  templates,
  value = '',
  onPick,
  disabled,
}: {
  templates: TaskTemplate[];
  /** The template used last ('' none). */
  value?: string;
  onPick(t: TaskTemplate): void;
  disabled?: boolean;
}) {
  return (
    <InlinePicker
      label={TEMPLATE_TEXT.label}
      placeholder={TEMPLATE_TEXT.placeholder}
      options={templates.map((t) => ({ value: t.id, label: t.name, hint: templateHint(t) }))}
      value={value}
      onChange={(id) => {
        const t = templates.find((x) => x.id === id);
        if (t) onPick(t);
      }}
      disabled={disabled}
    />
  );
}
