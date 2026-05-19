import { useCallback, useEffect, useMemo, useState } from 'react';
import { Account } from '../../lib/supabase';
import { useTenantContext } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import {
    FINANCIAL_RESTRICTION_FIELD_OPTIONS,
    FINANCIAL_RESTRICTION_FIELD_ID_SET,
    FinancialRestrictionFieldId,
    getSellerFinancialRestrictions,
    saveSellerFinancialRestrictions,
} from '../../lib/financialVisibilityApi';
import { fetchCustomPlLineItemCatalog, type CustomPlLineCatalogRow } from '../../lib/customPlFinanceApi';

type FinancialRestrictionsViewProps = {
    account: Account;
    shopId: string;
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

export function FinancialRestrictionsView({ account, shopId }: FinancialRestrictionsViewProps) {
    const { isPlatformSuperAdmin, isSellerAdminOn } = useTenantContext();
    const { profile } = useAuth();

    const canManageRestrictions = useMemo(() => {
        if (isPlatformSuperAdmin || profile?.role?.toLowerCase() === 'admin') return true;
        const sellerTid = account.tenant_id;
        if (!sellerTid) return false;
        return isSellerAdminOn(sellerTid);
    }, [isPlatformSuperAdmin, profile?.role, account.tenant_id, isSellerAdminOn]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [targets, setTargets] = useState<Set<string>>(new Set(['all_agency']));
    const [fields, setFields] = useState<Set<FinancialRestrictionFieldId>>(new Set());
    const [customPlCatalog, setCustomPlCatalog] = useState<CustomPlLineCatalogRow[]>([]);
    const [restrictedCustomPlLineIds, setRestrictedCustomPlLineIds] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const [rule, catalog] = await Promise.all([
                getSellerFinancialRestrictions(account.id),
                fetchCustomPlLineItemCatalog(account.id, shopId).catch(() => [] as CustomPlLineCatalogRow[]),
            ]);
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
            setCustomPlCatalog(catalog);
            const lineIds = Array.isArray(rule.restricted_custom_pl_line_item_ids) ? rule.restricted_custom_pl_line_item_ids : [];
            setRestrictedCustomPlLineIds(new Set(lineIds.filter((x): x is string => typeof x === 'string' && x.length > 0)));
        } catch (e: any) {
            setMessage(e?.message || 'Failed to load restrictions');
        } finally {
            setLoading(false);
        }
    }, [account.id, shopId]);

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

    const toggleRestrictedCustomPlLine = (lineId: string) => {
        setRestrictedCustomPlLineIds((prev) => {
            const next = new Set(prev);
            if (next.has(lineId)) next.delete(lineId);
            else next.add(lineId);
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
                restricted_custom_pl_line_item_ids: Array.from(restrictedCustomPlLineIds),
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
                    Only Seller Admins on this shop or platform operators may manage financial restrictions.
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
                                {'hint' in p && p.hint ? (
                                    <span className="block text-xs text-gray-500">{p.hint}</span>
                                ) : null}
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

            <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-2">Specific custom P&amp;L lines (this shop)</h3>
                <p className="text-gray-500 text-xs mb-3">
                    For users who can see custom P&amp;L, hide individual lines by id. Applies together with &quot;Custom line items&quot; above.
                </p>
                {customPlCatalog.length === 0 ? (
                    <p className="text-sm text-gray-500">No custom P&amp;L lines configured for this shop yet.</p>
                ) : (
                    <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                        {customPlCatalog.map((line) => (
                            <label key={line.id} className="flex items-start gap-2 text-sm text-gray-200">
                                <input
                                    type="checkbox"
                                    checked={restrictedCustomPlLineIds.has(line.id)}
                                    onChange={() => toggleRestrictedCustomPlLine(line.id)}
                                    disabled={loading || saving}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="text-gray-100">{line.name}</span>
                                    <span className="block text-xs text-gray-500 font-mono">{line.id}</span>
                                    {!line.is_active ? <span className="text-xs text-amber-500"> (inactive)</span> : null}
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={loading || saving}
                    className="px-4 py-2 bg-mamba-green hover:bg-mamba-deep disabled:opacity-50 text-mamba-dark rounded-lg font-semibold"
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
