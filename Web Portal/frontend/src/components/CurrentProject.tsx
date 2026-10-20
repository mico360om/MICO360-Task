import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The project the open page shows — a project's page, the board, a project meeting, a list filtered
 * to one project — so "New task" (the header button, N, a day on the calendar) starts in it.
 */
const ProjectIdContext = createContext<string | null>(null);
const SetProjectIdContext = createContext<((projectId: string | null) => void) | null>(null);

export function CurrentProjectProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  // The setter has its own context, so pages that only report their project don't re-render on it.
  const set = useMemo(() => setProjectId, []);
  return (
    <SetProjectIdContext.Provider value={set}>
      <ProjectIdContext.Provider value={projectId}>{children}</ProjectIdContext.Provider>
    </SetProjectIdContext.Provider>
  );
}

/** A page shows this one project (null / empty: none) for as long as it is open. */
export function useCurrentProject(projectId: string | null | undefined): void {
  const set = useContext(SetProjectIdContext);
  const id = projectId || null;
  useEffect(() => {
    if (!set || !id) return;
    set(id);
    return () => set(null);
  }, [set, id]);
}

/** The project the open page shows, or null. */
export function useCurrentProjectId(): string | null {
  return useContext(ProjectIdContext);
}
