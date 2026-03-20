import React, { useState } from 'react';
import { X, DollarSign, Calendar, Building2, FileText, Loader2, Percent, RefreshCw } from 'lucide-react';
import { useShopStore } from '../store/useShopStore';
import { Account, AgencyFeeType, AgencyFeeRecurrence, AgencyCommissionBase } from '../lib/supabase';
import { toLocalDateString } from '../utils/dateUtils';

interface ManualAgencyFeeModalProps {
    isOpen: boolean;
    onClose: () => void;
    account: Account;
    shopId: string;
}

const FEE_TYPES: { value: AgencyFeeType; label: string; desc: string }[] = [
    { value: 'retainer',   label: 'Retainer Only',        desc: 'Fixed monthly/periodic fee' },
    { value: 'commission', label: 'Commission Only',       desc: 'Percentage of a revenue metric' },
    { value: 'both',       label: 'Retainer + Commission', desc: 'Fixed fee plus a percentage' },
];

const RECURRENCE_OPTIONS: { value: AgencyFeeRecurrence; label: string }[] = [
    { value: 'monthly',   label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'biannual',  label: 'Every 6 Months' },
    { value: 'annual',    label: 'Annually' },
];

const COMMISSION_BASES: { value: AgencyCommissionBase; label: string; desc: string }[] = [
    { value: 'gmv',          label: 'GMV',          desc: 'Gross Merchandise Value (total sales)' },
    { value: 'gross_profit', label: 'Gross Profit',  desc: 'Revenue minus COGS & affiliate costs' },
    { value: 'net_revenue',  label: 'Net Revenue',   desc: 'GMV minus returns & refunds' },
];

export function ManualAgencyFeeModal({ isOpen, onClose, account, shopId }: ManualAgencyFeeModalProps) {
    const [formData, setFormData] = useState({
        agency_name:      '',
        fee_type:         'retainer' as AgencyFeeType,
        retainer_amount:  '',
        commission_rate:  '',
        commission_base:  'gmv' as AgencyCommissionBase,
        recurrence:       'monthly' as AgencyFeeRecurrence,
        date:             toLocalDateString(new Date()),
        description:      '',
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const addAgencyFee = useShopStore(state => state.addAgencyFee);

    if (!isOpen) return null;

    const hasRetainer   = formData.fee_type === 'retainer'   || formData.fee_type === 'both';
    const hasCommission = formData.fee_type === 'commission'  || formData.fee_type === 'both';

    const isValid =
        formData.agency_name.trim() !== '' &&
        formData.date !== '' &&
        (!hasRetainer   || formData.retainer_amount  !== '') &&
        (!hasCommission || formData.commission_rate   !== '');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid) return;

        setIsSubmitting(true);
        try {
            const retainerAmt  = hasRetainer   ? parseFloat(formData.retainer_amount  || '0') : 0;
            const commissionRt = hasCommission  ? parseFloat(formData.commission_rate  || '0') : 0;

            await addAgencyFee({
                account_id:       account.id,
                shop_id:          shopId,
                date:             formData.date,
                agency_name:      formData.agency_name,
                amount:           retainerAmt,
                description:      formData.description,
                fee_type:         formData.fee_type,
                retainer_amount:  retainerAmt,
                commission_rate:  commissionRt,
                commission_base:  formData.commission_base,
                recurrence:       formData.recurrence,
            });
            onClose();
            setFormData({
                agency_name:     '',
                fee_type:        'retainer',
                retainer_amount: '',
                commission_rate: '',
                commission_base: 'gmv',
                recurrence:      'monthly',
                date:            toLocalDateString(new Date()),
                description:     '',
            });
        } catch (error) {
            console.error('Failed to add agency fee:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const recurrenceLabel = formData.recurrence === 'biannual'
        ? '6-month period'
        : formData.recurrence === 'quarterly'
        ? 'quarter'
        : formData.recurrence === 'annual'
        ? 'year'
        : 'month';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-white">Add Agency Fee</h2>
                        <p className="text-gray-500 text-sm mt-0.5">Set up retainer, commission, or both</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1">
                        <X size={22} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">

                    {/* Agency Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Agency Name</label>
                        <div className="relative">
                            <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="text"
                                required
                                value={formData.agency_name}
                                onChange={e => setFormData({ ...formData, agency_name: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-9 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                                placeholder="e.g. Mamba Agency"
                            />
                        </div>
                    </div>

                    {/* Fee Type */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Fee Structure</label>
                        <div className="grid grid-cols-3 gap-2">
                            {FEE_TYPES.map(ft => (
                                <button
                                    key={ft.value}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, fee_type: ft.value })}
                                    className={`flex flex-col items-center text-center p-3 rounded-xl border transition-all ${
                                        formData.fee_type === ft.value
                                            ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                                    }`}
                                >
                                    <span className="text-xs font-semibold">{ft.label}</span>
                                    <span className="text-[10px] text-gray-500 mt-0.5 leading-tight">{ft.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Retainer Amount */}
                    {hasRetainer && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Retainer Amount</label>
                            <div className="relative flex items-center bg-gray-800 border border-gray-700 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent">
                                <DollarSign size={15} className="absolute left-3 text-gray-500 pointer-events-none" />
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    required={hasRetainer}
                                    value={formData.retainer_amount}
                                    onChange={e => setFormData({ ...formData, retainer_amount: e.target.value })}
                                    className="flex-1 bg-transparent text-white pl-9 pr-2 py-2.5 outline-none text-sm"
                                    placeholder="0.00"
                                />
                                <span className="text-gray-500 text-xs pr-3 whitespace-nowrap">
                                    {formData.recurrence === 'monthly'   && 'per month'}
                                    {formData.recurrence === 'quarterly' && 'per quarter'}
                                    {formData.recurrence === 'biannual'  && 'per 6 months'}
                                    {formData.recurrence === 'annual'    && 'per year'}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Commission fields */}
                    {hasCommission && (
                        <div className="space-y-3 bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Commission Settings</p>

                            {/* Rate */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1.5">Commission Rate (%)</label>
                                <div className="relative">
                                    <Percent size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="100"
                                        required={hasCommission}
                                        value={formData.commission_rate}
                                        onChange={e => setFormData({ ...formData, commission_rate: e.target.value })}
                                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-9 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                                        placeholder="e.g. 10"
                                    />
                                </div>
                            </div>

                            {/* Commission Base */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1.5">Commission Based On</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {COMMISSION_BASES.map(cb => (
                                        <button
                                            key={cb.value}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, commission_base: cb.value })}
                                            className={`flex flex-col items-center text-center p-2.5 rounded-lg border transition-all ${
                                                formData.commission_base === cb.value
                                                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                                            }`}
                                        >
                                            <span className="text-xs font-semibold">{cb.label}</span>
                                            <span className="text-[10px] text-gray-500 mt-0.5 leading-tight">{cb.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Recurrence */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">
                            <span className="flex items-center gap-1.5">
                                <RefreshCw size={13} />
                                Recurrence
                            </span>
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                            {RECURRENCE_OPTIONS.map(r => (
                                <button
                                    key={r.value}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, recurrence: r.value })}
                                    className={`py-2 px-1 text-xs font-medium rounded-lg border transition-all ${
                                        formData.recurrence === r.value
                                            ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-gray-600 text-xs mt-1.5">
                            The system will apply this fee once per {recurrenceLabel} that falls within the selected date range.
                        </p>
                    </div>

                    {/* Start Date */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Start Date</label>
                        <div className="relative">
                            <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="date"
                                required
                                value={formData.date}
                                onChange={e => setFormData({ ...formData, date: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-9 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                            />
                        </div>
                        <p className="text-gray-600 text-xs mt-1">
                            The first date this fee applies. Subsequent occurrences are auto-calculated.
                        </p>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Notes (Optional)</label>
                        <div className="relative">
                            <FileText size={15} className="absolute left-3 top-3 text-gray-500" />
                            <textarea
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-9 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none h-20 text-sm"
                                placeholder="Contract reference, notes..."
                            />
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !isValid}
                            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={15} className="animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                'Save Agency Fee'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
