import type { ApiClient } from '../lib/api-client';

/** 1.24 Task categories: each project's own list (name + one of 12 colours, lib/task-categories), in order. */
export interface ApiCategory {
  id: string;
  projectId: string;
  name: string;
  /** A key of CATEGORY_TONES (lib/task-categories). */
  color: string;
  position: number;
  retired: boolean;
  retiredAt: string | null;
  /** Tasks that have it, the Recycle Bin's too (only for those who may change the list). */
  taskCount?: number;
}

/** A category as a task row carries it. */
export interface TaskCategoryChip {
  id: string;
  name: string;
  color: string;
  retired: boolean;
}

export interface ProjectCategories {
  /** "Every task needs a category". */
  requireCategory: boolean;
  categories: ApiCategory[];
  /** The signed-in person may change the list (an admin or one of the project's managers). */
  canManage: boolean;
}

export function categoriesApi(client: ApiClient) {
  return {
    forProject: (projectId: string) => client.get<{ data: ProjectCategories }>(`/projects/${projectId}/categories`).then((r) => r.data),
    /** Add one at the end (409 CATEGORY_DUPLICATE for a name the project has, case and spaces aside). */
    create: (projectId: string, input: { name: string; color?: string }) => client.post<{ data: ApiCategory }>(`/projects/${projectId}/categories`, input).then((r) => r.data),
    update: (categoryId: string, patch: { name?: string; color?: string; retired?: boolean }) => client.put<{ data: ApiCategory }>(`/project-categories/${categoryId}`, patch).then((r) => r.data),
    reorder: (projectId: string, orderedIds: string[]) => client.put<{ data: ApiCategory[] }>(`/projects/${projectId}/categories/order`, { orderedIds }).then((r) => r.data),
    setRequired: (projectId: string, requireCategory: boolean) =>
      client.put<{ data: { requireCategory: boolean } }>(`/projects/${projectId}/category-settings`, { requireCategory }).then((r) => r.data),
    /** Delete — refused (409 CATEGORY_IN_USE) while a task uses it (Recycle Bin tasks count): retire it instead. */
    remove: (categoryId: string) => client.del<void>(`/project-categories/${categoryId}`),
    /** Give a task exactly these categories (400 "Pick at least one category." when the project needs one). */
    setForTask: (taskId: string, categoryIds: string[]) => client.put<{ data: ApiCategory[] }>(`/tasks/${taskId}/categories`, { categoryIds }).then((r) => r.data),
  };
}

export type CategoriesApi = ReturnType<typeof categoriesApi>;
