/**
 * PRD §4 Kanban transitions. Keep in sync with `agency_tasks_enforce_status_transition` in
 * `supabase/migrations/20260522140000_agency_tasks.sql` (database remains authoritative).
 */
export type AgencyKanbanStatus = 'todo' | 'in_progress' | 'done';

export function isAllowedAgencyTaskStatusTransition(from: string, to: string): boolean {
    if (from === to) return true;
    if (from === 'todo' && to === 'in_progress') return true;
    if (from === 'in_progress' && to === 'done') return true;
    if (from === 'done' && to === 'in_progress') return true;
    return false;
}
