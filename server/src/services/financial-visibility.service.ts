import { supabase } from '../config/supabase.js';

export type FinancialFieldAccess = {
    canViewCogs: boolean;
    canViewMargin: boolean;
    canViewCustomLineItems: boolean;
    restrictedFields: string[];
};

const DEFAULT_RESTRICTED: FinancialFieldAccess = {
    canViewCogs: false,
    canViewMargin: false,
    canViewCustomLineItems: false,
    restrictedFields: ['cogs', 'margin', 'custom_line_items'],
};

export async function getFinancialFieldAccess(userId: string, sellerTenantId: string): Promise<FinancialFieldAccess> {
    const { data, error } = await supabase.rpc('get_financial_field_access', {
        p_user_id: userId,
        p_seller_tenant_id: sellerTenantId,
    });
    if (error) {
        console.error('[financial-visibility] get_financial_field_access', error.message);
        return DEFAULT_RESTRICTED;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return DEFAULT_RESTRICTED;

    const restrictedFields = Array.isArray(row.restricted_fields)
        ? row.restricted_fields.filter((x: unknown): x is string => typeof x === 'string')
        : [];

    return {
        canViewCogs: row.can_view_cogs === true,
        canViewMargin: row.can_view_margin === true,
        canViewCustomLineItems: row.can_view_custom_line_items === true,
        restrictedFields,
    };
}

export function applyFinancialFieldFiltering<T extends Record<string, unknown>>(payload: T, access: FinancialFieldAccess): T {
    const out: Record<string, unknown> = { ...payload };

    if (!access.canViewCogs) {
        delete out.total_cogs;
        delete out.cogs;
        delete out.cogs_total;
    }
    if (!access.canViewMargin) {
        out.margin = 'Restricted';
        delete out.margin_amount;
        delete out.margin_percent;
    }
    if (!access.canViewCustomLineItems) {
        delete out.custom_line_items;
    }

    for (const field of access.restrictedFields) {
        delete out[field];
    }

    if (!access.canViewCogs || !access.canViewMargin || !access.canViewCustomLineItems) {
        out.restriction_notice = 'Some financial fields are restricted by seller visibility policy.';
    }

    return out as T;
}
