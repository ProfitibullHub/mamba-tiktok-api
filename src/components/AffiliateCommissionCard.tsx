import { useState } from 'react';
import { Users, RotateCw } from 'lucide-react';
import { AffiliateSettlement } from '../lib/supabase';

// Duplicate formatter if not exported
const formatCurrencyVal = (num: number) => {
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
};

interface AffiliateCommissionCardProps {
    autoCommission: number;
    manualRetainers: AffiliateSettlement[];
    dateRangeLabel: string;
}

export function AffiliateCommissionCard({ autoCommission, manualRetainers, dateRangeLabel }: AffiliateCommissionCardProps) {
    const [isFlipped, setIsFlipped] = useState(false);

    const totalManual = manualRetainers.reduce((sum, r) => sum + Number(r.amount), 0);
    const totalCommission = autoCommission + totalManual;

    return (
        <div className="relative w-full h-40 perspective-1000 group cursor-pointer" onClick={() => setIsFlipped(!isFlipped)}>
            <div className={`relative w-full h-full transition-all duration-500 transform preserve-3d ${isFlipped ? 'rotate-y-180' : ''}`}>

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
                            </div>
                        </div>
                        <RotateCw className="w-4 h-4 text-pink-500/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    <div>
                        <p className="text-2xl font-bold text-pink-400">{formatCurrencyVal(totalCommission)}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <span>Auto: {formatCurrencyVal(autoCommission)}</span>
                            <span>+</span>
                            <span>Manual: {formatCurrencyVal(totalManual)}</span>
                        </div>
                    </div>
                </div>

                {/* Back Side */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 bg-gray-900 border border-gray-700/50 rounded-xl p-4 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800">
                        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Breakdown</h4>
                        <RotateCw className="w-3 h-3 text-gray-600" />
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                        {/* Auto Commission Row */}
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-400">TikTok Auto</span>
                            <span className="text-gray-200">{formatCurrencyVal(autoCommission)}</span>
                        </div>

                        {/* Manual Retainers */}
                        {manualRetainers.length > 0 && (
                            <>
                                <div className="h-px bg-gray-800 my-1"></div>
                                {manualRetainers.map((r) => (
                                    <div key={r.id} className="flex justify-between items-center text-xs">
                                        <span className="text-gray-500 truncate max-w-[60%]">{r.affiliate_name}</span>
                                        <span className="text-pink-300">{formatCurrencyVal(Number(r.amount))}</span>
                                    </div>
                                ))}
                            </>
                        )}
                        {manualRetainers.length === 0 && autoCommission === 0 && (
                            <p className="text-xs text-center text-gray-600 py-2">No commissions recorded.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
