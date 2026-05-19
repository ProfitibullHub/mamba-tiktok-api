/**
 * PRD §5.1 task permission names vs RBAC catalog (`tasks.*`).
 * Keep in sync with `server/src/lib/task-permission-aliases.ts`.
 */
const TASK_PERMISSION_EQUIVALENCE_GROUPS: readonly (readonly string[])[] = [
    ['tasks.view', 'view_tasks'],
    ['tasks.create', 'create_task'],
    ['tasks.edit', 'edit_task'],
    ['tasks.assign', 'assign_task'],
    ['tasks.delete', 'delete_task'],
    ['tasks.view_private', 'view_private_tasks'],
    ['tasks.create_private', 'create_private_task'],
] as const;

/**
 * True if `effective` grants `required`, where `required` may be either the catalog slug
 * (e.g. `tasks.create`) or the PRD-style alias (`create_task`).
 */
export function taskPermissionEquivalenceMatches(effective: Set<string>, required: string): boolean {
    for (const g of TASK_PERMISSION_EQUIVALENCE_GROUPS) {
        if (g.includes(required)) return g.some((x) => effective.has(x));
    }
    return false;
}
