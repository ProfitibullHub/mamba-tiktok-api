import { useCallback, useEffect, useMemo, useState } from 'react';
import { Account } from '../../lib/supabase';
import { useTenantContext } from '../../contexts/TenantContext';
import {
    FINANCIAL_RESTRICTION_FIELD_OPTIONS,
    FINANCIAL_RESTRICTION_FIELD_ID_SET,
    FinancialRestrictionFieldId,
    getSellerFinancialRestrictions,
    saveSellerFinancialRestrictions,
} from '../../lib/financialVisibilityApi';

type FinancialRestrictionsViewProps = {
    account: Account;
};

const PRINCIPAL_OPTIONS = [
    { id: 'all_agency', label: 'All agency users (default)', hint: 'Applies to every agency-side user on linked agencies.' },
    { id: 'agency_admin', label: 'Agency Admin' },
    { id: 'account_manager', label: 'Account Manager (AM)' },
    { id: 'account_coordinator', label: 'Account Coordinator (AC)' },
    { id: 'all_seller', label: 'All seller users' },
    { id: 'seller_admin', label: 'Seller Admin' },
    { id: 'seller_user', label: 'Seller User' },
] as const;

export function FinancialRestrictionsView({ account }: FinancialRestrictionsViewProps) {
    const { memberships, isPlatformSuperAdmin } = useTenantContext();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [targets, setTargets] = useState<Set<string>>(new Set(['all_agency']));
    const [fields, setFields] = useState<Set<FinancialRestrictionFieldId>>(new Set());

    const canManageRestrictions = useMemo(() => {
        if (isPlatformSuperAdmin) return true;
        return memberships.some(
            (m) =>
                m.tenant_id === account.tenant_id &&
                m.status === 'active' &&
                (m.roles?.name === 'Seller Admin' ||
                    (Array.isArray((m as any).membership_roles) &&
                        (m as any).membership_roles.some((mr: any) => !mr?.revoked_at && mr?.roles?.name === 'Seller Admin')))
        );
    }, [memberships, account.tenant_id, isPlatformSuperAdmin]);

    const load = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const rule = await getSellerFinancialRestrictions(account.id);
            setTargets(new Set(rule.restricted_principals?.length ? rule.restricted_principals : ['all_agency']));
            const hydratedFields = new Set<FinancialRestrictionFieldId>(
                (rule.restricted_fields || []).filter((f): f is FinancialRestrictionFieldId =>
                    FINANCIAL_RESTRICTION_FIELD_ID_SET.has(f as FinancialRestrictionFieldId)
                )
            );
            // Backward compatibility: older rows may have booleans set but restricted_fields empty.
            if (rule.restrict_cogs) hydratedFields.add('cogs');
            if (rule.restrict_margin) hydratedFields.add('margin');
            if (rule.restrict_custom_line_items) hydratedFields.add('custom_line_items');
            setFields(hydratedFields);
        } catch (e: any) {
            setMessage(e?.message || 'Failed to load restrictions');
        } finally {
            setLoading(false);
        }
    }, [account.id]);

    useEffect(() => {
        void load();
    }, [load]);

    const toggleTarget = (id: string) => {
        setTargets((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            if (next.size === 0) next.add('all_agency');
            return next;
        });
    };

    const toggleField = (id: FinancialRestrictionFieldId) => {
        setFields((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const restrictedFields = Array.from(fields);
            await saveSellerFinancialRestrictions(account.id, {
                restrict_cogs: restrictedFields.includes('cogs'),
                restrict_margin: restrictedFields.includes('margin'),
                restrict_custom_line_items: restrictedFields.includes('custom_line_items'),
                restricted_principals: Array.from(targets),
                restricted_fields: restrictedFields,
            });
            setMessage('Restrictions saved successfully.');
        } catch (e: any) {
            setMessage(e?.message || 'Failed to save restrictions');
        } finally {
            setSaving(false);
        }
    };

    if (!canManageRestrictions) {
        return (
            <div className="space-y-4">
                <h2 className="text-2xl font-bold text-white">Financial Restrictions</h2>
                <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 text-sm text-gray-300">
                    You need Seller Admin access on this seller to manage financial restrictions.
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white mb-2">Financial Restrictions</h2>
                <p className="text-gray-400 text-sm">
                    Choose who should be restricted and which financial line items should be hidden.
                </p>
            </div>

            <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-3">Who is restricted</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {PRINCIPAL_OPTIONS.map((p) => (
                        <label key={p.id} className="flex items-start gap-2 text-sm text-gray-200">
                            <input
                                type="checkbox"
                                checked={targets.has(p.id)}
                                onChange={() => toggleTarget(p.id)}
                                className="mt-1"
                                disabled={loading || saving}
                            />
                            <span>
                                {p.label}
                                {p.hint ? <span className="block text-xs text-gray-500">{p.hint}</span> : null}
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-3">Restricted financial information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {FINANCIAL_RESTRICTION_FIELD_OPTIONS.map((f) => (
                        <label key={f.id} className="flex items-center gap-2 text-sm text-gray-200">
                            <input
                                type="checkbox"
                                checked={fields.has(f.id)}
                                onChange={() => toggleField(f.id)}
                                disabled={loading || saving}
                            />
                            {f.label}
                        </label>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={loading || saving}
                    className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white rounded-lg font-semibold"
                >
                    {saving ? 'Saving...' : 'Save restrictions'}
                </button>
                <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading || saving}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg"
                >
                    Reload
                </button>
                {message ? <span className="text-sm text-gray-300">{message}</span> : null}
            </div>
        </div>
    );
}
