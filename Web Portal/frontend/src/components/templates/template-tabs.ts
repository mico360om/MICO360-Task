import { createElement, type ReactElement } from 'react';
import { ProjectTemplatesTab } from './ProjectTemplatesTab';
import { TaskTemplatesTab } from './TaskTemplatesTab';

/** One tab of the Templates page: its key (the address's ?tab=), its name, and what it shows. */
export interface TemplateTab {
  key: string;
  label: string;
  element: ReactElement;
}

/**
 * The Templates page's tabs, in order (the first opens by default). Each tab brings its own list and
 * buttons, so another kind of template is one more entry here.
 */
export const TEMPLATE_TABS: TemplateTab[] = [
  { key: 'projects', label: 'Projects', element: createElement(ProjectTemplatesTab) },
  { key: 'tasks', label: 'Tasks', element: createElement(TaskTemplatesTab) },
];
