/**
 * audit-logger.ts
 *
 * Server-side utility for writing immutable audit log entries to `audit_logs`.
 * All writes use the service-role client directly — never the user's token.
 *
 * Usage:
 *   import { auditLog } from './audit-logger.js';
 *
 *   await auditLog(req, {
 *       action: 'shop.disconnect',
 *       resourceType: 'shop',
 *       resourceId: shopId,
 *       accountId,
 *       afterState: { reason: 'user_initiated' },
 *   });
 *
 * Actions naming convention: '<resource>.<verb>'
 *   shop.connect       shop.disconnect
 *   role.grant         role.revoke
 *   member.invite      member.accept   member.decline   member.remove
 *   admin.user_wipe
 *   export.dashboard   export.csv
 *   auth.start         auth.finalize
 */

import type { Request } from 'express';
import { supabase } from '../config/supabase.js';
import { resolveRequestUserId } from '../middleware/account-access.middleware.js';

export type AuditAction =
    // Shop lifecycle
    | 'shop.connect'
    | 'shop.disconnect'
    | 'shop.auth_start'
    // Role / permission
    | 'role.grant'
    | 'role.revoke'
    // Team membership
    | 'member.invite'
    | 'member.accept'
    | 'member.decline'
    | 'member.remove'
    | 'member.reinvite'
    // Admin actions
    | 'admin.user_wipe'
    | 'admin.tenant_create'
    | 'admin.tenant_delete'
    // Data exports
    | 'export.dashboard_email'
    | 'export.csv'
    // Auth
    | 'auth.tiktok_start'
    | 'auth.tiktok_finalize'
    | 'auth.ads_connect'
    // Generic escape hatch
    | (string & {});

export interface AuditLogEntry {
    action: AuditAction;
    resourceType: string;
    resourceId?: string | null;
    accountId?: string | null;
    tenantId?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    /** Extra structured metadata that doesn't fit state snapshots */
    metadata?: Record<string, unknown> | null;
}

/**
 * Write an audit log entry.
 *
 * This function is intentionally fire-and-forget-safe — it logs an error
 * internally but NEVER throws, so it never interrupts the caller's response.
 *
 * Pass `req` so we can extract the actor's userId, IP, and user-agent.
 * Pass `null` for `req` when calling from a background cron context.
 */
export async function auditLog(
    req: Request | null,
    entry: AuditLogEntry,
): Promise<void> {
    try {
        let actorUserId: string | null = null;
        let actorEmail: string | null = null;
        let ipAddress: string | null = null;
        let userAgent: string | null = null;

        if (req) {
            actorUserId = await resolveRequestUserId(req);
            userAgent = req.headers['user-agent'] ?? null;
            // Respect Vercel/proxy forwarded IP; fall back to socket remote
            const forwarded = req.headers['x-forwarded-for'];
            ipAddress = typeof forwarded === 'string'
                ? forwarded.split(',')[0].trim()
                : req.socket?.remoteAddress ?? null;

            // Resolve email from Supabase if we have a userId
            if (actorUserId) {
                const { data: user } = await supabase.auth.admin.getUserById(actorUserId);
                actorEmail = user?.user?.email ?? null;
            }
        }

        const { error } = await supabase.from('audit_logs').insert({
            actor_user_id: actorUserId,
            actor_email: actorEmail,
            action: entry.action,
            resource_type: entry.resourceType,
            resource_id: entry.resourceId ?? null,
            account_id: entry.accountId ?? null,
            tenant_id: entry.tenantId ?? null,
            before_state: entry.beforeState ?? null,
            after_state: entry.afterState ?? null,
            ip_address: ipAddress,
            user_agent: userAgent,
            metadata: entry.metadata ?? {},
        });

        if (error) {
            console.error('[AuditLog] Failed to write audit entry:', error.message, {
                action: entry.action,
                resourceType: entry.resourceType,
                resourceId: entry.resourceId,
            });
        }
    } catch (err: any) {
        // Audit failures must NEVER crash the request
        console.error('[AuditLog] Unexpected error writing audit log:', err?.message);
    }
}
