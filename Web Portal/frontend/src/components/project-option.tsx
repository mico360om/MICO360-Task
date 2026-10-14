import type { SelectOption } from './ui/SearchableSelect';
import { ProjectAvatar, type ProjectLook } from './ProjectAvatar';

/** A project as a choice in a picker: its name, its code as a hint, and its picture. */
export function projectOption(p: ProjectLook & { id: string; code?: string | null }): SelectOption {
  return { value: p.id, label: p.name, hint: p.code ?? undefined, icon: <ProjectAvatar project={p} size="xs" /> };
}

/** A project known only by id and name (a report row), with its picture when the project list has it. */
export function namedProjectOption(id: string, name: string, projects?: readonly (Partial<ProjectLook> & { id: string })[] | null): SelectOption {
  const p = projects?.find((x) => x.id === id);
  return { value: id, label: name, icon: <ProjectAvatar project={{ name, color: p?.color, icon: p?.icon, imageUrl: p?.imageUrl }} size="xs" /> };
}
