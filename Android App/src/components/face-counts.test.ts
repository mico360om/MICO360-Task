import { it, expect } from 'vitest';
import { appSources } from '../testing/web-source';

/**
 * Device check D (31 Oct): at the phone's largest font size the "+N" circle after a row of faces (a
 * project card's team) was cut — its count grew with the font while the circle, like the faces, keeps
 * its size. The count stays the size of the initials beside it (they don't scale either); the row's
 * TalkBack label says the whole team.
 */
it('every "+N" count in a row of faces keeps its size, like the initials beside it', () => {
  const counts = appSources().flatMap(([file, text]) => [...text.matchAll(/<Text\b[^>]*>\+\{[^}]+\}<\/Text>/g)].map((m) => [file, m[0]] as const));
  expect(counts.map(([file]) => file).sort()).toEqual(['components/board/BoardCard.tsx', 'components/my-tasks/MyTaskItem.tsx', 'components/projects/ProjectCard.tsx']);
  for (const [file, tag] of counts) expect(tag, file).toMatch(/allowFontScaling=\{false\}/);
});
