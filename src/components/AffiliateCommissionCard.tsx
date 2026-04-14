import { useState } from 'react';
import { Users, RotateCw } from 'lucide-react';
import { AffiliateSettlement } from '../lib/supabase';

const formatCurrencyVal = (num: number) => {
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
};

const formatSignedCurrency = (num: number) => {
    const abs = Math.abs(num);
    const body = `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (num < 0) return `-${body}`;
    if (num > 0) return `+${body}`;
    return body;
};

export interface AutoAffiliateCommissionLine {
    key: string;
    label: string;
    value: number;
}

interface AffiliateCommissionCardProps {
    /** TikTok Seller Center Est. commission (abs): affiliate + partner + cofunded creator bonus only. */
    autoCommission: number;
    /** External affiliate marketing fee (abs), not part of TikTok Est. commission — added to headline total only. */
    autoOtherAffiliateCogs?: number;
    /** Line items; Est. commission lines + optional external marketing line. */
    autoCommissionLines: AutoAffiliateCommissionLine[];
    /** Raw net sum of those lines (reversals can make this negative; P&L uses abs). */
    autoCommissionNetSigned: number;
    manualRetainers: AffiliateSettlement[];
    dateRangeLabel: string;
}

export function AffiliateCommissionCard({
    autoCommission,
    autoOtherAffiliateCogs = 0,
    autoCommissionLines,
    autoCommissionNetSigned,
    manualRetainers,
    dateRangeLabel,
}: AffiliateCommissionCardProps) {
    const [isFlipped, setIsFlipped] = useState(false);

    const totalManual = manualRetainers.reduce((sum, r) => sum + Number(r.amount), 0);
    const totalCommission = autoCommission + autoOtherAffiliateCogs + totalManual;

    return (
        <div className="relative w-full min-h-[11rem] h-48 perspective-1000 group cursor-pointer" onClick={() => setIsFlipped(!isFlipped)}>
            <div className={`relative w-full h-full min-h-[11rem] transition-all duration-500 transform preserve-3d ${isFlipped ? 'rotate-y-180' : ''}`}>

                {/* Front Side */}
                <div className="absolute inset-0 backface-hidden bg-gradient-to-br from-pink-500/10 to-rose-500/10 border border-pink-500/30 rounded-xl p-5 flex flex-col justify-between hover:border-pink-500/50 transition-colors">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-pink-500/20 rounded-lg">
                                <Users className="w-5 h-5 text-pink-400" />
                            </div>
                            <div>
                                <h3 className="text-gray-400 text-sm font-medium">Affiliate Commissions</h3>
                                <p className="text-xs text-gray-600">{dateRangeLabel}</p>
                                <p className="text-[10px] text-gray-600 mt-0.5">Click card for auto commission lines</p>
                            </div>
                        </div>
                        <RotateCw className="w-4 h-4 text-pink-500/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    <div>
                        <p className="text-2xl font-bold text-pink-400">{formatCurrencyVal(totalCommission)}</p>
                        <div className="flex flex-col gap-0.5 mt-1 text-xs text-gray-500">
                            <span>Est. commission (TikTok): {formatCurrencyVal(autoCommission)}</span>
                            {autoOtherAffiliateCogs > 0 && (
                                <span>Other affiliate COGS: {formatCurrencyVal(autoOtherAffiliateCogs)}</span>
                            )}
                            <span>
                                + Manual: {formatCurrencyVal(totalManual)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Back Side — line-by-line TikTok auto commission (tap card to flip) */}
                <div
                    className="absolute inset-0 backface-hidden rotate-y-180 bg-gray-900 border border-gray-700/50 rounded-xl p-4 overflow-hidden flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div
                        className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800 shrink-0 cursor-pointer"
                        onClick={() => setIsFlipped(false)}
                        role="button"
                        aria-label="Close breakdown"
                    >
                        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Auto commission (TikTok)</h4>
                        <RotateCw className="w-3 h-3 text-gray-600" />
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 min-h-0">
                        <p className="text-[10px] text-gray-600 mb-1">
                            Settlement fee lines: affiliate_commission, affiliate_partner_commission, cofunded_creator_bonus; plus affiliate_ads_commission_amount when present. Net may offset (e.g. reversals).
                        </p>
                        {autoCommissionLines.map((line) => (
                            <div key={line.key} className="flex justify-between items-start gap-2 text-xs">
                                <span className="text-gray-500 leading-tight">{line.label}</span>
                                <span className="text-gray-200 tabular-nums shrink-0">{formatSignedCurrency(line.value)}</span>
                            </div>
                        ))}
                        <div className="h-px bg-gray-800 my-1.5" />
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-400 font-medium">Net (signed)</span>
                            <span className="text-gray-200 font-medium tabular-nums">{formatSignedCurrency(autoCommissionNetSigned)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-pink-400/90 font-medium">TikTok Est. commission (abs)</span>
                            <span className="text-pink-300 font-semibold tabular-nums">{formatCurrencyVal(autoCommission)}</span>
                        </div>

                        {manualRetainers.length > 0 && (
                            <>
                                <div className="h-px bg-gray-800 my-2" />
                                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Manual retainers</p>
                                {manualRetainers.map((r) => (
                                    <div key={r.id} className="flex justify-between items-center text-xs">
                                        <span className="text-gray-500 truncate max-w-[55%]">{r.affiliate_name}</span>
                                        <span className="text-pink-300 tabular-nums shrink-0">{formatCurrencyVal(Number(r.amount))}</span>
                                    </div>
                                ))}
                            </>
                        )}
                        {manualRetainers.length === 0 && autoCommission === 0 && autoCommissionLines.every((l) => l.value === 0) && (
                            <p className="text-xs text-center text-gray-600 py-2">No auto commission lines in this range.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
