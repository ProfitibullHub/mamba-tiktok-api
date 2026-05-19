/** Console deep links for agency Kanban tasks (see PRD: Messaging contextual). */

export const CONSOLE_TASK_TAB = 'tasks';
export const CONSOLE_TASK_QUERY_PARAM = 'taskId';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAgencyTaskId(value: string | null | undefined): value is string {
    return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** Absolute URL to open the console Team tasks tab with a task highlighted (details). */
export function buildConsoleTaskDeepLink(taskId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const q = new URLSearchParams({
        tab: CONSOLE_TASK_TAB,
        [CONSOLE_TASK_QUERY_PARAM]: taskId.trim(),
    });
    return `${origin}/?${q.toString()}`;
}

export type MessagingTaskSharePayload = {
    taskId: string;
    title: string;
    sellerTenantId: string;
};

/** Non-overlapping URL segments in plain text that point to a console task deep link. */
export function extractTaskDeepLinkSpans(body: string): Array<{ start: number; end: number; taskId: string }> {
    const out: Array<{ start: number; end: number; taskId: string }> = [];
    const re = /\btaskId=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        const taskId = m[1];
        if (!UUID_RE.test(taskId)) continue;
        const matchStart = m.index;
        const matchEnd = m.index + m[0].length;
        let left = matchStart;
        while (left > 0 && !/\s/.test(body[left - 1]!)) left--;
        let right = matchEnd;
        while (right < body.length && !/\s/.test(body[right]!)) right++;
        const segment = body.slice(left, right);
        if (!/\btab=tasks\b/i.test(segment)) continue;
        out.push({ start: left, end: right, taskId });
    }
    return out;
}
