import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
    closestCorners,
    DndContext,
    DragOverlay,
    type DragCancelEvent,
    type DragEndEvent,
    type DragStartEvent,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { ChevronRight, GripVertical, KanbanSquare, Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useTenantContext, type ManageableTenant, type MembershipRow } from '../../contexts/TenantContext';
import { useMyEffectivePermissions, effectiveAllowsTasksBoard } from '../../hooks/useMyEffectivePermissions';
import {
    createAgencyTask,
    deleteAgencyTask,
    fetchAgencyTask,
    fetchAgencyTasks,
    fetchTaskAssignees,
    patchAgencyTask,
    type AgencyKanbanStatus,
    type AgencyTask,
    type TaskAssigneeRow,
} from '../../lib/tasksApi';
import { buildConsoleTaskDeepLink, type MessagingTaskSharePayload } from '../../lib/taskDeepLinks';
import { taskPermissionEquivalenceMatches } from '../../lib/taskPermissionAliases';
import { showAppToast } from '../../store/useAppToastStore';

const COLUMNS: { id: AgencyKanbanStatus; label: string }[] = [
    { id: 'todo', label: 'To do' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'done', label: 'Done' },
];

function colDroppableId(s: AgencyKanbanStatus): string {
    return `col-${s}`;
}

/** Floating card while dragging — list item is hidden so DOM moves don’t fight dnd-kit. */
function TaskDragOverlayPreview(props: { task: AgencyTask; sellerLabel: string }) {
    const s = props.task.status as AgencyKanbanStatus;
    const colLabel = COLUMNS.find((c) => c.id === s)?.label ?? s;
    return (
        <div
            className="rounded-xl border p-3 min-w-[220px] max-w-sm space-y-2 bg-gray-950/95 border-emerald-500/50
                shadow-xl shadow-emerald-950/40 ring-2 ring-emerald-500/30 cursor-grabbing"
        >
            <div className="flex items-start gap-2 min-w-0">
                <GripVertical className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-50 text-sm leading-snug break-words">{props.task.title}</div>
                    <div className="text-[10px] text-gray-400 mt-1 truncate" title={props.sellerLabel}>
                        {colLabel} · {props.sellerLabel}
                    </div>
                </div>
                {props.task.is_private ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 shrink-0">
                        Private
                    </span>
                ) : null}
            </div>
        </div>
    );
}

/** PRD-valid single hop when dropping onto a column (server enforces transitions). */
function statusAfterDrop(from: AgencyKanbanStatus, targetCol: AgencyKanbanStatus): AgencyKanbanStatus | null {
    if (from === targetCol) return null;
    if (from === 'todo' && targetCol === 'in_progress') return 'in_progress';
    if (from === 'in_progress' && targetCol === 'done') return 'done';
    if (from === 'done' && targetCol === 'in_progress') return 'in_progress';
    return null;
}

function fmtPerson(p: { full_name?: string | null; email?: string | null } | null | undefined): string {
    const n = p?.full_name?.trim();
    if (n) return n;
    return p?.email ?? 'Unknown';
}

type AgencyTasksPayload = {
    data: AgencyTask[];
    pagination: { limit: number; offset: number; total: number };
};

function parseAgencyTasksCacheFilters(key: readonly unknown[]): {
    seller: string | null;
    assignee: string | null;
    status: AgencyKanbanStatus | null;
} | null {
    if (key[0] !== 'agency-tasks') return null;
    const s = key[3];
    const status: AgencyKanbanStatus | null =
        s === 'todo' || s === 'in_progress' || s === 'done' ? s : null;
    return {
        seller: typeof key[1] === 'string' && key[1] ? key[1] : null,
        assignee: typeof key[2] === 'string' && key[2] ? key[2] : null,
        status,
    };
}

function taskMatchesAgencyTasksFilters(
    task: AgencyTask,
    f: { seller: string | null; assignee: string | null; status: AgencyKanbanStatus | null },
): boolean {
    if (f.seller && task.seller_tenant_id !== f.seller) return false;
    if (f.assignee && (task.assigned_to ?? '') !== f.assignee) return false;
    if (f.status && task.status !== f.status) return false;
    return true;
}

function cloneAgencyTasksPayload(p: AgencyTasksPayload): AgencyTasksPayload {
    return structuredClone(p);
}

function findTaskInAgencyCaches(queryClient: QueryClient, id: string): AgencyTask | undefined {
    for (const [, old] of queryClient.getQueriesData<AgencyTasksPayload>({ queryKey: ['agency-tasks'] })) {
        const t = old?.data.find((x) => x.id === id);
        if (t) return t;
    }
    return undefined;
}

/** Update or remove a task in every `['agency-tasks', …]` cache row according to that query’s filters. */
function setTaskAcrossAgencyCaches(queryClient: QueryClient, task: AgencyTask) {
    const entries = queryClient.getQueriesData<AgencyTasksPayload>({ queryKey: ['agency-tasks'] });
    for (const [key, old] of entries) {
        if (!old) continue;
        const f = parseAgencyTasksCacheFilters(key);
        if (!f) continue;
        const shouldShow = taskMatchesAgencyTasksFilters(task, f);
        const without = old.data.filter((t) => t.id !== task.id);
        const nextData = shouldShow ? [task, ...without] : without;
        queryClient.setQueryData(key as readonly unknown[], { ...old, data: nextData });
    }
}

function removeTaskFromAgencyCaches(queryClient: QueryClient, taskId: string) {
    const entries = queryClient.getQueriesData<AgencyTasksPayload>({ queryKey: ['agency-tasks'] });
    for (const [key, old] of entries) {
        if (!old?.data.some((t) => t.id === taskId)) continue;
        queryClient.setQueryData(key as readonly unknown[], {
            ...old,
            data: old.data.filter((t) => t.id !== taskId),
        });
    }
}

/** Single allowed one-click advance (matches DB trigger on agency_tasks). */
function nextStatusOneClick(current: AgencyKanbanStatus): AgencyKanbanStatus | null {
    if (current === 'todo') return 'in_progress';
    if (current === 'in_progress') return 'done';
    if (current === 'done') return 'in_progress';
    return null;
}

const STATUS_PIPELINE: { id: AgencyKanbanStatus; short: string }[] = [
    { id: 'todo', short: 'To do' },
    { id: 'in_progress', short: 'In progress' },
    { id: 'done', short: 'Done' },
];

function TaskStatusPipeline(props: {
    status: AgencyKanbanStatus;
    canEdit: boolean;
    patchPending: boolean;
    onAdvance: (next: AgencyKanbanStatus) => void;
}) {
    const { status, canEdit, patchPending, onAdvance } = props;
    const next = nextStatusOneClick(status);

    if (!canEdit) {
        return (
            <div className="flex items-center gap-0.5 flex-wrap" aria-label="Task status">
                {STATUS_PIPELINE.map((step, i) => (
                    <span key={step.id} className="flex items-center gap-0.5">
                        {i > 0 && <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" aria-hidden />}
                        <span
                            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md ${
                                step.id === status
                                    ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/35'
                                    : 'text-gray-500'
                            }`}
                        >
                            {step.short}
                        </span>
                    </span>
                ))}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-0.5 flex-wrap" role="group" aria-label="Change task status">
            {STATUS_PIPELINE.map((step, i) => {
                const isCurrent = step.id === status;
                const isNext = next !== null && step.id === next;
                return (
                    <span key={step.id} className="flex items-center gap-0.5">
                        {i > 0 && <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" aria-hidden />}
                        {isNext ? (
                            <button
                                type="button"
                                disabled={patchPending}
                                onClick={() => onAdvance(step.id)}
                                className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-md
                                    bg-emerald-500/90 text-mamba-dark hover:bg-emerald-400
                                    shadow-sm shadow-emerald-900/30
                                    focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-950
                                    disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                            >
                                {step.id === 'in_progress' && status === 'todo'
                                    ? 'Start'
                                    : step.id === 'done' && status === 'in_progress'
                                      ? 'Complete'
                                      : 'Reopen'}
                            </button>
                        ) : (
                            <span
                                className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md ${
                                    isCurrent
                                        ? 'bg-white/10 text-gray-100 ring-1 ring-white/15'
                                        : 'text-gray-600'
                                }`}
                                aria-current={isCurrent ? 'step' : undefined}
                            >
                                {step.short}
                            </span>
                        )}
                    </span>
                );
            })}
        </div>
    );
}

function TaskCard(props: {
    task: AgencyTask;
    sellerLabel: string;
    canDrag: boolean;
    canEdit: boolean;
    canAssign: boolean;
    canDelete: boolean;
    canCreatePrivate: boolean;
    patchPending: boolean;
    onOpenDetails: (task: AgencyTask) => void;
    onDelete: (task: AgencyTask) => void;
    onPatch: (taskId: string, patch: Parameters<typeof patchAgencyTask>[1], source: 'inline' | 'modal') => void;
    onDiscussInMessages?: (task: AgencyTask) => void;
}) {
    const {
        task,
        sellerLabel,
        canDrag,
        canEdit,
        canAssign,
        canDelete,
        canCreatePrivate,
        patchPending,
        onOpenDetails,
        onDelete,
        onPatch,
        onDiscussInMessages,
    } = props;

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `task:${task.id}`,
        disabled: !canDrag,
    });

    const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

    const [titleDraft, setTitleDraft] = useState(task.title);
    const [titleEditing, setTitleEditing] = useState(false);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const titleEditCancelledRef = useRef(false);

    useEffect(() => {
        if (!titleEditing) setTitleDraft(task.title);
    }, [task.id, task.title, titleEditing]);

    useEffect(() => {
        if (titleEditing) {
            titleInputRef.current?.focus();
            titleInputRef.current?.select();
        }
    }, [titleEditing]);

    const assignLabel = task.assigned_to_profile ? fmtPerson(task.assigned_to_profile) : '—';
    const privateChip = task.is_private ? (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 shrink-0">
            Private
        </span>
    ) : null;

    const flushTitle = () => {
        const next = titleDraft.trim();
        if (!next || next === task.title) {
            setTitleDraft(task.title);
            return;
        }
        onPatch(task.id, { title: next }, 'inline');
    };

    const endTitleEdit = () => {
        if (titleEditCancelledRef.current) {
            titleEditCancelledRef.current = false;
            return;
        }
        flushTitle();
        setTitleEditing(false);
    };

    const cancelTitleEdit = () => {
        titleEditCancelledRef.current = true;
        setTitleDraft(task.title);
        setTitleEditing(false);
    };
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`rounded-xl border p-3 space-y-2 bg-gray-950/60 border-gray-700/80 ${
                isDragging ? 'opacity-0 pointer-events-none ring-0' : ''
            }`}
        >
            <div className="flex items-start gap-2 min-w-0">
                {canDrag ? (
                    <button
                        type="button"
                        className="mt-0.5 shrink-0 p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/5 cursor-grab active:cursor-grabbing touch-none"
                        aria-label="Drag to move column"
                        {...listeners}
                        {...attributes}
                    >
                        <GripVertical className="w-4 h-4" />
                    </button>
                ) : (
                    <span className="w-6 shrink-0" aria-hidden />
                )}
                <div className="flex-1 min-w-0 space-y-1.5">
                    {canEdit ? (
                        titleEditing ? (
                            <input
                                ref={titleInputRef}
                                data-task-title={task.id}
                                value={titleDraft}
                                disabled={patchPending}
                                onChange={(e) => setTitleDraft(e.target.value)}
                                onBlur={endTitleEdit}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        (e.target as HTMLInputElement).blur();
                                    }
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        cancelTitleEdit();
                                        return;
                                    }
                                }}
                                className="w-full font-medium text-gray-50 text-sm leading-snug bg-white/5 border border-gray-700/80 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
                            />
                        ) : (
                            <button
                                type="button"
                                disabled={patchPending}
                                onClick={() => {
                                    titleEditCancelledRef.current = false;
                                    setTitleDraft(task.title);
                                    setTitleEditing(true);
                                }}
                                className="w-full text-left font-medium text-gray-50 text-sm leading-snug break-words rounded-lg px-1 py-0.5 -mx-1 hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 disabled:opacity-50"
                            >
                                {task.title}
                            </button>
                        )
                    ) : (
                        <div className="font-medium text-gray-50 text-sm leading-snug break-words">{task.title}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <TaskStatusPipeline
                            status={task.status as AgencyKanbanStatus}
                            canEdit={canEdit}
                            patchPending={patchPending}
                            onAdvance={(next) => {
                                if (next !== task.status) onPatch(task.id, { status: next }, 'inline');
                            }}
                        />
                    </div>
                    <div className="text-[11px] text-gray-400 truncate" title={sellerLabel}>
                        {sellerLabel}
                    </div>
                </div>
                {privateChip}
            </div>
            <div className="text-xs text-gray-400 flex flex-wrap items-center gap-x-2 gap-y-1 pl-8">
                <span>Assignee:</span>
                <span className="text-gray-200">{assignLabel}</span>
            </div>
            {(canAssign || canDelete || canEdit || canCreatePrivate || onDiscussInMessages) && (
                <div className="flex flex-wrap gap-2 pt-1 pl-8">
                    {(canEdit || canAssign || canCreatePrivate) && (
                        <button
                            type="button"
                            onClick={() => onOpenDetails(task)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-gray-700/80"
                        >
                            Details
                        </button>
                    )}
                    {onDiscussInMessages && (
                        <button
                            type="button"
                            onClick={() => onDiscussInMessages(task)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-100 border border-emerald-500/35"
                        >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Message
                        </button>
                    )}
                    {canDelete && (
                        <button
                            type="button"
                            onClick={() => onDelete(task)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 border border-rose-500/30"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function KanbanColumnShell(props: {
    status: AgencyKanbanStatus;
    label: string;
    tasks: AgencyTask[];
    sellerMap: Map<string, string>;
    canDragCards: boolean;
    canEdit: boolean;
    canAssign: boolean;
    canDelete: boolean;
    canCreatePrivate: boolean;
    onOpenDetails: (task: AgencyTask) => void;
    onDelete: (task: AgencyTask) => void;
    onPatch: (taskId: string, patch: Parameters<typeof patchAgencyTask>[1], source: 'inline' | 'modal') => void;
    onDiscussInMessages?: (task: AgencyTask) => void;
}) {
    const dropId = colDroppableId(props.status);
    const { setNodeRef, isOver } = useDroppable({ id: dropId });

    return (
        <div className="flex-1 min-w-[240px] max-w-xl flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-100">{props.label}</div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300">{props.tasks.length}</span>
            </div>
            <div
                ref={setNodeRef}
                className={`flex-1 min-h-[200px] rounded-2xl border border-dashed p-2 flex flex-col gap-2 overflow-y-auto ${
                    isOver ? 'border-emerald-500/55 bg-emerald-500/5' : 'border-gray-700/80 bg-black/25'
                }`}
            >
                {props.tasks.length === 0 && (
                    <p className="text-xs text-gray-500 px-1 py-4 text-center">No tasks.</p>
                )}
                {props.tasks.map((t: AgencyTask) => (
                    <TaskCard
                        key={t.id}
                        task={t}
                        sellerLabel={props.sellerMap.get(t.seller_tenant_id) ?? 'Seller'}
                        canDrag={props.canDragCards}
                        canEdit={props.canEdit}
                        canAssign={props.canAssign}
                        canDelete={props.canDelete}
                        canCreatePrivate={props.canCreatePrivate}
                        patchPending={false}
                        onOpenDetails={props.onOpenDetails}
                        onDelete={props.onDelete}
                        onPatch={props.onPatch}
                        onDiscussInMessages={props.onDiscussInMessages}
                    />
                ))}
            </div>
        </div>
    );
}

export type AgencyTasksViewProps = {
    /** From `/?tab=tasks&taskId=` — opens task details once resolved. */
    deepLinkTaskId?: string | null;
    onConsumeTaskDeepLink?: () => void;
};

export function AgencyTasksView({ deepLinkTaskId = null, onConsumeTaskDeepLink }: AgencyTasksViewProps = {}) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const location = useLocation();
    const {
        manageableAdminTenants,
        profileTenantId,
        profileTenantType,
        agencyMemberships,
        hasAgencyAccess,
    } = useTenantContext();

    const agencyTenantForPerms =
        profileTenantType === 'agency' && profileTenantId
            ? profileTenantId
            : agencyMemberships.filter((m: MembershipRow) => m.status === 'active')[0]?.tenant_id ?? null;

    const { data: permSet, isLoading: loadingPerms } = useMyEffectivePermissions(agencyTenantForPerms, {
        enabled: Boolean(agencyTenantForPerms),
    });

    const allowedBoard = !!permSet && effectiveAllowsTasksBoard(permSet);
    const perm = permSet ?? new Set<string>();
    const canCreate = perm.has('tasks.manage') || taskPermissionEquivalenceMatches(perm, 'tasks.create');
    const canAssign = perm.has('tasks.manage') || taskPermissionEquivalenceMatches(perm, 'tasks.assign');
    const canEdit = perm.has('tasks.manage') || taskPermissionEquivalenceMatches(perm, 'tasks.edit');
    const canDrag = canEdit;
    const canDelete = perm.has('tasks.manage') || taskPermissionEquivalenceMatches(perm, 'tasks.delete');
    const canCreatePrivate = perm.has('tasks.manage') || taskPermissionEquivalenceMatches(perm, 'tasks.create_private');

    const sellerOptions = useMemo(
        () => manageableAdminTenants.filter((t: ManageableTenant) => t.type === 'seller'),
        [manageableAdminTenants],
    );
    const sellerMap = useMemo((): Map<string, string> => {
        return new Map(sellerOptions.map((s: ManageableTenant) => [s.id, s.name]));
    }, [sellerOptions]);

    const [filterSeller, setFilterSeller] = useState<string>('');
    const [filterAssignee, setFilterAssignee] = useState<string>('');
    const [filterStatus, setFilterStatus] = useState<AgencyKanbanStatus | ''>('');

    const tasksQueryKey = ['agency-tasks', filterSeller || null, filterAssignee || null, filterStatus || null] as const;

    const { data: taskPayload, isLoading: loadingTasks } = useQuery({
        queryKey: tasksQueryKey,
        queryFn: () =>
            fetchAgencyTasks({
                sellerTenantId: filterSeller || null,
                assignedTo: filterAssignee || null,
                status: filterStatus || null,
                limit: 200,
                offset: 0,
            }),
        enabled: Boolean(agencyTenantForPerms) && allowedBoard,
        staleTime: 60_000,
    });

    const { data: assignees = [], isLoading: loadingAssignees } = useQuery({
        queryKey: ['agency-task-assignees'],
        queryFn: () => fetchTaskAssignees(),
        enabled: Boolean(agencyTenantForPerms) && allowedBoard,
        staleTime: 60_000,
    });

    const createMutation = useMutation<AgencyTask, Error, Parameters<typeof createAgencyTask>[0]>({
        mutationFn: createAgencyTask,
        onSuccess: (serverTask) => {
            setTaskAcrossAgencyCaches(queryClient, serverTask);
            closeCreate();
            showAppToast('Task created', 'ok');
        },
        onError: (e: unknown) => showAppToast(e instanceof Error ? e.message : String(e), 'err'),
    });

    const patchRequestSeqByTaskRef = useRef(new Map<string, number>());

    type PatchVars = { id: string; patch: Parameters<typeof patchAgencyTask>[1]; source: 'inline' | 'modal' | 'drag' };
    type PatchCtx = {
        snapshot: [readonly unknown[], AgencyTasksPayload | undefined][];
        seq: number;
        taskId: string;
    };

    const patchMutation = useMutation<AgencyTask, Error, PatchVars, PatchCtx>({
        mutationFn: (vars) => patchAgencyTask(vars.id, vars.patch),
        onMutate: async (vars) => {
            await queryClient.cancelQueries({ queryKey: ['agency-tasks'] });
            const previous = queryClient.getQueriesData<AgencyTasksPayload>({ queryKey: ['agency-tasks'] });
            const snapshot: PatchCtx['snapshot'] = previous.map(([k, v]) => [
                k,
                v ? cloneAgencyTasksPayload(v) : v,
            ]);
            const taskId = vars.id;
            const seq = (patchRequestSeqByTaskRef.current.get(taskId) ?? 0) + 1;
            patchRequestSeqByTaskRef.current.set(taskId, seq);
            const existing = findTaskInAgencyCaches(queryClient, vars.id);
            if (existing) {
                const optimistic: AgencyTask = {
                    ...existing,
                    ...vars.patch,
                    updated_at: new Date().toISOString(),
                };
                setTaskAcrossAgencyCaches(queryClient, optimistic);
            }
            return { snapshot, seq, taskId };
        },
        onError: (e, vars, ctx) => {
            const latest = patchRequestSeqByTaskRef.current.get(vars.id);
            if (!ctx || ctx.seq !== latest) {
                return;
            }
            if (ctx.snapshot) {
                for (const [key, data] of ctx.snapshot) {
                    queryClient.setQueryData(key, data);
                }
            }
            const msg = e instanceof Error ? e.message : String(e);
            const statusPatch = vars.patch.status !== undefined;
            showAppToast(
                statusPatch && msg.toLowerCase().includes('transition')
                    ? 'That status change isn’t allowed. Use the adjacent column first.'
                    : msg,
                'err',
            );
        },
        onSuccess: (serverTask, vars, ctx) => {
            const latest = patchRequestSeqByTaskRef.current.get(vars.id);
            if (!ctx || ctx.seq !== latest) {
                return;
            }
            setTaskAcrossAgencyCaches(queryClient, serverTask);
            if (vars.source === 'modal') {
                closeEdit();
                showAppToast('Saved', 'ok');
            }
        },
    });

    const patchTask = useCallback(
        (taskId: string, patch: Parameters<typeof patchAgencyTask>[1], source: 'inline' | 'modal') => {
            patchMutation.mutate({ id: taskId, patch, source });
        },
        [patchMutation],
    );

    type DeleteCtx = { snapshot: [readonly unknown[], AgencyTasksPayload | undefined][] };

    const deleteMutation = useMutation<void, Error, string, DeleteCtx>({
        mutationFn: deleteAgencyTask,
        onMutate: async (taskId) => {
            await queryClient.cancelQueries({ queryKey: ['agency-tasks'] });
            const previous = queryClient.getQueriesData<AgencyTasksPayload>({ queryKey: ['agency-tasks'] });
            const snapshot: DeleteCtx['snapshot'] = previous.map(([k, v]) => [
                k,
                v ? cloneAgencyTasksPayload(v) : v,
            ]);
            removeTaskFromAgencyCaches(queryClient, taskId);
            return { snapshot };
        },
        onError: (e, _taskId, ctx) => {
            if (ctx?.snapshot) {
                for (const [key, data] of ctx.snapshot) {
                    queryClient.setQueryData(key, data);
                }
            }
            showAppToast(e instanceof Error ? e.message : String(e), 'err');
        },
        onSuccess: () => {
            showAppToast('Task deleted', 'ok');
        },
    });

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    const [createOpen, setCreateOpen] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newSeller, setNewSeller] = useState('');
    const [newAssignee, setNewAssignee] = useState('');
    const [newPrivate, setNewPrivate] = useState(false);

    const [editTask, setEditTask] = useState<AgencyTask | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editAssignee, setEditAssignee] = useState('');
    const [editPrivate, setEditPrivate] = useState(false);

    function closeCreate() {
        setCreateOpen(false);
        setNewTitle('');
        setNewSeller('');
        setNewAssignee('');
        setNewPrivate(false);
    }

    function closeEdit() {
        setEditTask(null);
        setEditTitle('');
        setEditDescription('');
        setEditAssignee('');
        setEditPrivate(false);
    }

    const openEdit = useCallback((t: AgencyTask) => {
        setEditTask(t);
        setEditTitle(t.title);
        setEditDescription(t.description ?? '');
        setEditAssignee(t.assigned_to ?? '');
        setEditPrivate(t.is_private);
    }, []);

    const discussInMessages = useCallback(
        (task: AgencyTask) => {
            const share: MessagingTaskSharePayload = {
                taskId: task.id,
                title: task.title,
                sellerTenantId: task.seller_tenant_id,
            };
            navigate('/messages', {
                state: {
                    messagingReturnPath: `${location.pathname}${location.search || ''}`,
                    messagingTaskShare: share,
                },
            });
        },
        [navigate, location.pathname, location.search],
    );

    useEffect(() => {
        if (!deepLinkTaskId || !onConsumeTaskDeepLink) return;
        let cancelled = false;
        void (async () => {
            const inList = taskPayload?.data?.find((t: AgencyTask) => t.id === deepLinkTaskId);
            if (inList) {
                if (cancelled) return;
                openEdit(inList);
                onConsumeTaskDeepLink();
                return;
            }
            try {
                const t = await fetchAgencyTask(deepLinkTaskId);
                if (cancelled) return;
                setTaskAcrossAgencyCaches(queryClient, t);
                openEdit(t);
            } catch {
                showAppToast(
                    'Could not open that task. It may be private, filtered out, in another workspace, or removed.',
                    'err',
                );
            } finally {
                if (!cancelled) onConsumeTaskDeepLink();
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [deepLinkTaskId, onConsumeTaskDeepLink, taskPayload?.data, openEdit, queryClient]);

    const [activeDragTask, setActiveDragTask] = useState<AgencyTask | null>(null);

    const onDragStart = useCallback(
        (ev: DragStartEvent) => {
            const raw = ev.active.id;
            if (typeof raw !== 'string' || !raw.startsWith('task:')) return;
            const taskId = raw.slice('task:'.length);
            const t = taskPayload?.data?.find((x: AgencyTask) => x.id === taskId);
            if (t) setActiveDragTask(t);
        },
        [taskPayload?.data],
    );

    const onDragCancel = useCallback((_ev: DragCancelEvent) => {
        setActiveDragTask(null);
    }, []);

    const onDragEnd = useCallback(
        (ev: DragEndEvent) => {
            const clearDrag = () => setActiveDragTask(null);

            if (!canDrag) {
                clearDrag();
                return;
            }
            const raw = ev.active.id;
            const over = ev.over;
            if (!over || typeof raw !== 'string' || !raw.startsWith('task:')) {
                clearDrag();
                return;
            }
            const taskId = raw.slice('task:'.length);
            const tasks = taskPayload?.data ?? [];
            const task = tasks.find((t: AgencyTask) => t.id === taskId);
            if (!task || typeof over.id !== 'string' || !over.id.startsWith('col-')) {
                clearDrag();
                return;
            }

            const targetCol = over.id.slice('col-'.length) as AgencyKanbanStatus;
            const next = statusAfterDrop(task.status as AgencyKanbanStatus, targetCol);
            if (!next) {
                showAppToast('Cannot move directly to that column for this task.', 'err');
                clearDrag();
                return;
            }
            if (next === task.status) {
                clearDrag();
                return;
            }

            // Let dnd-kit finish drag teardown before we reorder the React tree (avoids snap-back).
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    patchMutation.mutate({ id: taskId, patch: { status: next }, source: 'drag' });
                    clearDrag();
                });
            });
        },
        [canDrag, patchMutation, taskPayload?.data],
    );

    const tasksByColumn = useMemo(() => {
        const rows = taskPayload?.data ?? [];
        const mapCols: Record<AgencyKanbanStatus, AgencyTask[]> = {
            todo: [],
            in_progress: [],
            done: [],
        };
        for (const r of rows) {
            const s = r.status as AgencyKanbanStatus;
            if (mapCols[s]) mapCols[s].push(r);
        }
        return mapCols;
    }, [taskPayload?.data]);

    if (!agencyTenantForPerms) {
        return (
            <div className="max-w-xl rounded-2xl border border-gray-700/80 bg-gray-900/50 p-6 text-gray-200 text-sm">
                Could not resolve an agency tenant for permissions. Ensure you belong to at least one agency
                workspace.
            </div>
        );
    }

    if (loadingPerms || !permSet) {
        return (
            <div className="flex items-center gap-3 text-gray-300 p-8">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span>Loading task permissions…</span>
            </div>
        );
    }

    if (!allowedBoard) {
        return (
            <div className="max-w-xl rounded-2xl border border-gray-700/80 bg-gray-900/50 p-6 text-gray-200">
                <div className="flex items-center gap-2 mb-2 text-gray-300">
                    <KanbanSquare className="w-5 h-5" />
                    <h2 className="text-lg font-semibold">Team tasks</h2>
                </div>
                <p className="text-sm text-gray-400">
                    Your role does not include task board access (<code className="text-gray-300">tasks.view</code>).
                    Ask an agency administrator if you believe this is a mistake.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-[1600px] mx-auto space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 brand-text">
                        {loadingTasks ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                        ) : (
                            <KanbanSquare className="w-6 h-6 shrink-0" />
                        )}
                        <h1 className="text-2xl font-bold">Team tasks</h1>
                    </div>
                    <p className="text-sm text-gray-400">Kanban for agency staff on linked seller accounts.</p>
                </div>
                {canCreate && (
                    <button
                        type="button"
                        disabled={sellerOptions.length === 0}
                        title={
                            sellerOptions.length === 0
                                ? 'No linked seller accounts in scope yet.'
                                : undefined
                        }
                        onClick={() => {
                            setCreateOpen(true);
                            if (!newSeller && sellerOptions[0]) setNewSeller(sellerOptions[0].id);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-emerald-500/90 hover:bg-emerald-500 text-mamba-dark"
                    >
                        <Plus className="w-4 h-4" />
                        New task
                    </button>
                )}
            </header>

            <div className="flex flex-wrap gap-3 items-end">
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                    Seller
                    <select
                        className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100 min-w-[180px]"
                        value={filterSeller}
                        onChange={(e) => setFilterSeller(e.target.value)}
                    >
                        <option value="">All assigned sellers</option>
                        {sellerOptions.map((s: ManageableTenant) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                    Assignee
                    <select
                        className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100 min-w-[180px]"
                        value={filterAssignee}
                        onChange={(e) => setFilterAssignee(e.target.value)}
                        disabled={loadingAssignees}
                    >
                        <option value="">Anyone</option>
                        {assignees.map((a: TaskAssigneeRow) => (
                            <option key={a.user_id} value={a.user_id}>
                                {fmtPerson(a)}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                    Status filter
                    <select
                        className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100 min-w-[160px]"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus((e.target.value || '') as AgencyKanbanStatus | '')}
                    >
                        <option value="">All statuses</option>
                        {COLUMNS.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={onDragStart}
                onDragCancel={onDragCancel}
                onDragEnd={onDragEnd}
            >
                <div className="flex flex-wrap gap-4 items-start pb-16">
                    {COLUMNS.map((c) => (
                        <KanbanColumnShell
                            key={c.id}
                            status={c.id}
                            label={c.label}
                            tasks={tasksByColumn[c.id]}
                            sellerMap={sellerMap}
                            canDragCards={canDrag}
                            canEdit={canEdit}
                            canAssign={canAssign}
                            canDelete={canDelete}
                            canCreatePrivate={canCreatePrivate}
                            onOpenDetails={openEdit}
                            onDelete={(t: AgencyTask) => {
                                if (window.confirm(`Delete task “${t.title}”?`)) deleteMutation.mutate(t.id);
                            }}
                            onPatch={patchTask}
                            onDiscussInMessages={
                                hasAgencyAccess && allowedBoard ? discussInMessages : undefined
                            }
                        />
                    ))}
                </div>
                <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
                    {activeDragTask ? (
                        <TaskDragOverlayPreview
                            task={activeDragTask}
                            sellerLabel={sellerMap.get(activeDragTask.seller_tenant_id) ?? 'Seller'}
                        />
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Create */}
            {createOpen && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-lg font-semibold text-gray-50">New task</h3>
                            <button type="button" className="text-gray-400 hover:text-gray-100" onClick={closeCreate}>
                                Close
                            </button>
                        </div>
                        <label className="block space-y-1 text-xs text-gray-400">
                            Title*
                            <input
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
                                autoFocus
                            />
                        </label>
                        <label className="block space-y-1 text-xs text-gray-400">
                            Seller*
                            <select
                                value={newSeller}
                                onChange={(e) => setNewSeller(e.target.value)}
                                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
                            >
                                <option value="" disabled>
                                    Select seller…
                                </option>
                                {sellerOptions.map((s: ManageableTenant) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {canAssign && (
                            <label className="block space-y-1 text-xs text-gray-400">
                                Assignee
                                <select
                                    value={newAssignee}
                                    onChange={(e) => setNewAssignee(e.target.value)}
                                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
                                >
                                    <option value="">—</option>
                                    {assignees.map((a: TaskAssigneeRow) => (
                                        <option key={a.user_id} value={a.user_id}>
                                            {fmtPerson(a)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {canCreatePrivate && (
                            <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                                <input
                                    type="checkbox"
                                    checked={newPrivate}
                                    onChange={(e) => setNewPrivate(e.target.checked)}
                                />
                                Private (only creator / assignee)
                            </label>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                className="px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5"
                                onClick={closeCreate}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={
                                    createMutation.isPending ||
                                    !newTitle.trim() ||
                                    !newSeller ||
                                    sellerOptions.find((x: ManageableTenant) => x.id === newSeller) === undefined
                                }
                                onClick={() => {
                                    createMutation.mutate({
                                        seller_tenant_id: newSeller,
                                        title: newTitle.trim(),
                                        assigned_to: newAssignee || null,
                                        is_private: canCreatePrivate ? newPrivate : false,
                                    });
                                }}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-emerald-500/90 hover:bg-emerald-500 text-mamba-dark disabled:opacity-50"
                            >
                                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit */}
            {editTask && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-lg font-semibold text-gray-50">Edit task</h3>
                            <button type="button" className="text-gray-400 hover:text-gray-100" onClick={closeEdit}>
                                Close
                            </button>
                        </div>
                        <label className="block space-y-1 text-xs text-gray-400">
                            Title*
                            <input
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
                            />
                        </label>
                        <label className="block space-y-1 text-xs text-gray-400">
                            Description
                            <textarea
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                rows={4}
                                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
                            />
                        </label>
                        {canAssign && (
                            <label className="block space-y-1 text-xs text-gray-400">
                                Assignee
                                <select
                                    value={editAssignee}
                                    onChange={(e) => setEditAssignee(e.target.value)}
                                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100"
                                >
                                    <option value="">—</option>
                                    {assignees.map((a: TaskAssigneeRow) => (
                                        <option key={a.user_id} value={a.user_id}>
                                            {fmtPerson(a)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {canCreatePrivate && (
                            <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                                <input
                                    type="checkbox"
                                    checked={editPrivate}
                                    onChange={(e) => setEditPrivate(e.target.checked)}
                                />
                                Private
                            </label>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                            <div className="flex flex-wrap gap-2">
                                {hasAgencyAccess && editTask && (
                                    <>
                                        <button
                                            type="button"
                                            className="px-3 py-2 rounded-lg text-sm text-emerald-200 hover:bg-emerald-500/15 border border-emerald-500/35 inline-flex items-center gap-1.5"
                                            onClick={() => {
                                                void discussInMessages(editTask);
                                            }}
                                        >
                                            <MessageSquare className="w-4 h-4" />
                                            Open in Messages
                                        </button>
                                        <button
                                            type="button"
                                            className="px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5 border border-gray-600/80"
                                            onClick={() => {
                                                const url = buildConsoleTaskDeepLink(editTask.id);
                                                void navigator.clipboard.writeText(url).then(
                                                    () => showAppToast('Task link copied', 'ok'),
                                                    () => showAppToast('Could not copy link', 'err'),
                                                );
                                            }}
                                        >
                                            Copy console link
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className="px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5"
                                onClick={closeEdit}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={patchMutation.isPending || !editTitle.trim()}
                                onClick={() => {
                                    patchMutation.mutate({
                                        id: editTask.id,
                                        source: 'modal',
                                        patch: {
                                            title: editTitle.trim(),
                                            description: editDescription.trim() === '' ? null : editDescription,
                                            ...(canAssign
                                                ? {
                                                      assigned_to: editAssignee ? editAssignee : null,
                                                  }
                                                : {}),
                                            ...(canCreatePrivate ? { is_private: editPrivate } : {}),
                                        },
                                    });
                                }}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm bg-emerald-500/90 hover:bg-emerald-500 text-mamba-dark disabled:opacity-50"
                            >
                                {patchMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                                Save
                            </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
