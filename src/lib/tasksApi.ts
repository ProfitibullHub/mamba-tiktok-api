import { apiFetch } from './apiClient';

export type AgencyKanbanStatus = 'todo' | 'in_progress' | 'done';

export type AgencyTaskProfile = {
    id: string;
    full_name: string | null;
    email: string | null;
};

export type AgencyTask = {
    id: string;
    tenant_id: string;
    seller_tenant_id: string;
    title: string;
    description: string | null;
    status: AgencyKanbanStatus;
    created_by: string | null;
    assigned_to: string | null;
    is_private: boolean;
    created_at: string;
    updated_at: string;
    created_by_profile: AgencyTaskProfile | null;
    assigned_to_profile: AgencyTaskProfile | null;
};

export type TaskAssigneeRow = {
    user_id: string;
    full_name: string | null;
    email: string | null;
};

export async function fetchAgencyTask(taskId: string): Promise<AgencyTask> {
    const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    const json = (await res.json()) as { success?: boolean; data?: AgencyTask; error?: string };
    if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || `Task request failed (${res.status})`);
    }
    return json.data;
}

export async function fetchAgencyTasks(params: {
    sellerTenantId?: string | null;
    assignedTo?: string | null;
    status?: AgencyKanbanStatus | null;
    limit?: number;
    offset?: number;
}): Promise<{ data: AgencyTask[]; pagination: { limit: number; offset: number; total: number } }> {
    const q = new URLSearchParams();
    if (params.sellerTenantId) q.set('sellerTenantId', params.sellerTenantId);
    if (params.assignedTo) q.set('assignedTo', params.assignedTo);
    if (params.status) q.set('status', params.status);
    if (typeof params.limit === 'number') q.set('limit', String(params.limit));
    if (typeof params.offset === 'number') q.set('offset', String(params.offset));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    const res = await apiFetch(`/api/tasks${suffix}`);
    const json = (await res.json()) as {
        success?: boolean;
        data?: AgencyTask[];
        pagination?: { limit: number; offset: number; total: number };
        error?: string;
    };
    if (!res.ok || !json.success) {
        throw new Error(json.error || `Tasks request failed (${res.status})`);
    }
    return {
        data: json.data ?? [],
        pagination: json.pagination ?? { limit: 100, offset: 0, total: 0 },
    };
}

export async function fetchTaskAssignees(): Promise<TaskAssigneeRow[]> {
    const res = await apiFetch('/api/tasks/assignees');
    const json = (await res.json()) as { success?: boolean; data?: TaskAssigneeRow[]; error?: string };
    if (!res.ok || !json.success) {
        throw new Error(json.error || `Assignees request failed (${res.status})`);
    }
    return json.data ?? [];
}

export async function createAgencyTask(body: {
    seller_tenant_id: string;
    title: string;
    description?: string | null;
    assigned_to?: string | null;
    is_private?: boolean;
}): Promise<AgencyTask> {
    const res = await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    const json = (await res.json()) as { success?: boolean; data?: AgencyTask; error?: string };
    if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || `Create task failed (${res.status})`);
    }
    return json.data;
}

export async function patchAgencyTask(
    taskId: string,
    patch: Partial<{
        title: string;
        description: string | null;
        status: AgencyKanbanStatus;
        assigned_to: string | null;
        is_private: boolean;
    }>,
): Promise<AgencyTask> {
    const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { success?: boolean; data?: AgencyTask; error?: string };
    if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || `Update task failed (${res.status})`);
    }
    return json.data;
}

export async function deleteAgencyTask(taskId: string): Promise<void> {
    const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
    });
    const json = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !json.success) {
        throw new Error(json.error || `Delete task failed (${res.status})`);
    }
}
