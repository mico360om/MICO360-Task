import { useEffect, useState } from 'react';
import { assetUrl } from '../api/client';
import { ProjectIconGlyph, isProjectIcon, projectInitials, readableOn } from '../lib/project-icons';

export interface ProjectLook {
  name: string;
  color?: string | null;
  icon?: string | null;
  imageUrl?: string | null;
}

export type ProjectAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZE: Record<ProjectAvatarSize, { box: string; text: string; icon: number }> = {
  xs: { box: 'h-5 w-5 rounded-md', text: 'text-[9px]', icon: 12 },
  sm: { box: 'h-6 w-6 rounded-md', text: 'text-[10px]', icon: 14 },
  md: { box: 'h-8 w-8 rounded-lg', text: 'text-xs', icon: 18 },
  lg: { box: 'h-11 w-11 rounded-xl', text: 'text-sm', icon: 22 },
  xl: { box: 'h-16 w-16 rounded-2xl', text: 'text-xl', icon: 32 },
  '2xl': { box: 'h-24 w-24 rounded-3xl', text: 'text-3xl', icon: 46 },
};

/** A server path ('/uploads/…') gets the API's origin; a local preview (blob:, data:, http) is used as is. */
const srcOf = (url: string) => (url.startsWith('/') ? assetUrl(url) : url);

/**
 * A project's picture, the same everywhere: its uploaded image, else its icon on its colour, else
 * its initials. An image that fails to load falls back to the icon or initials. Decorative by
 * default (the project's name is written next to it); pass `label` when it stands alone.
 */
export function ProjectAvatar({ project, size = 'md', label = false, className = '' }: { project: ProjectLook; size?: ProjectAvatarSize; label?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [project.imageUrl]);
  const s = SIZE[size];
  const color = project.color || '#8B1E1E';
  // data-project-avatar: what it shows ("image", "icon" or "initials"), for tests and styling hooks.
  const a11y = label ? { role: 'img', 'aria-label': project.name, title: project.name } : { 'aria-hidden': true as const };
  if (project.imageUrl && !broken) {
    return (
      <span {...a11y} data-project-avatar="image" className={`relative inline-flex flex-none overflow-hidden border border-line bg-surface ${s.box} ${className}`}>
        <img src={srcOf(project.imageUrl)} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" draggable={false} />
      </span>
    );
  }
  return (
    <span
      {...a11y}
      data-project-avatar={isProjectIcon(project.icon) ? 'icon' : 'initials'}
      className={`inline-grid flex-none place-items-center font-bold leading-none ${s.box} ${s.text} ${className}`}
      style={{ background: color, color: readableOn(color) }}
    >
      {isProjectIcon(project.icon) ? <ProjectIconGlyph icon={project.icon} size={s.icon} /> : projectInitials(project.name)}
    </span>
  );
}
