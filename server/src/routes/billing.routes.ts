import express from 'express';
import { supabase } from '../config/supabase.js';
import { auditLog } from '../services/audit-logger.js';

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EntitlementPayload = {
    tenantId: string;
    sourcePlanId?: string;
    features: Array<{ key: string; allowed: boolean }>;
};

function upsertEntitlementsSqlRows(payload: EntitlementPayload) {
    return payload.features.map((f) => ({
        tenant_id: payload.tenantId,
        feature_key: String(f.key).trim(),
        allowed: !!f.allowed,
        source_plan_id: payload.sourcePlanId || null,
        updated_at: new Date().toISOString(),
    }));
}

/**
 * POST /api/billing/entitlements/sync
 * Internal webhook endpoint for Stripe subscription events.
 * Body:
 * {
 *   tenantId: uuid,
 *   sourcePlanId: string,
 *   features: [{ key: "export_pnl", allowed: true }, ...]
 * }
 */
router.post('/entitlements/sync', async (req, res) => {
    try {
        const secret = process.env.STRIPE_SYNC_SECRET;
        if (!secret) {
            res.status(503).json({ success: false, error: 'STRIPE_SYNC_SECRET not configured' });
            return;
        }
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${secret}`) {
            res.status(403).json({ success: false, error: 'Forbidden' });
            return;
        }

        const body = req.body as Partial<EntitlementPayload> | undefined;
        const tenantId = String(body?.tenantId || '').trim();
        const sourcePlanId = body?.sourcePlanId ? String(body.sourcePlanId) : undefined;
        const features = Array.isArray(body?.features) ? body!.features! : [];

        if (!UUID_RE.test(tenantId)) {
            res.status(400).json({ success: false, error: 'Valid tenantId is required' });
            return;
        }
        if (!features.length) {
            res.status(400).json({ success: false, error: 'features[] is required' });
            return;
        }

        const rows = upsertEntitlementsSqlRows({
            tenantId,
            sourcePlanId,
            features: features.map((f) => ({
                key: String((f as any).key || '').trim(),
                allowed: !!(f as any).allowed,
            })),
        });

        if (rows.some((r) => !r.feature_key)) {
            res.status(400).json({ success: false, error: 'Each feature requires a non-empty key' });
            return;
        }

        const { error } = await supabase
            .from('tenant_plan_entitlements')
            .upsert(rows, { onConflict: 'tenant_id,feature_key' });
        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        auditLog(req, {
            action: 'plan.entitlement_change',
            resourceType: 'tenant_plan_entitlement',
            resourceId: tenantId,
            tenantId,
            metadata: {
                sourcePlanId: sourcePlanId || null,
                features: rows.map((r) => ({ key: r.feature_key, allowed: r.allowed })),
            },
        }).catch(() => undefined);

        res.json({ success: true, data: { tenantId, updated: rows.length } });
    } catch (e: any) {
        console.error('[billing] entitlements sync', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

export default router;
