import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface CalculationTooltipProps {
    source: string;
    calculation: string;
    api: string;
    className?: string;
}

export function CalculationTooltip({ source, calculation, api, className = '' }: CalculationTooltipProps) {
    const [show, setShow] = useState(false);

    return (
        <div
            className={`relative inline-flex items-center ml-1.5 z-40 ${className}`}
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
            onClick={(e) => { e.stopPropagation(); setShow(!show); }}
        >
            <HelpCircle size={13} className="text-gray-500 hover:text-white cursor-help transition-colors" />

            {show && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 pointer-events-none">
                    <div className="space-y-2.5 text-left">
                        <div>
                            <span className="text-gray-500 font-bold uppercase text-[10px] tracking-wider block mb-0.5">Source</span>
                            <p className="text-gray-200 text-xs leading-relaxed">{source}</p>
                        </div>

                        <div className="border-t border-gray-800 pt-2">
                            <span className="text-gray-500 font-bold uppercase text-[10px] tracking-wider block mb-0.5">Calculation</span>
                            <p className="text-gray-300 text-xs font-mono bg-gray-950/50 p-1.5 rounded border border-gray-800/50 break-words whitespace-pre-wrap">
                                {calculation}
                            </p>
                        </div>

                        <div className="border-t border-gray-800 pt-2">
                            <span className="text-gray-500 font-bold uppercase text-[10px] tracking-wider block mb-0.5">API Endpoint</span>
                            <code className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px] break-all font-mono">
                                {api}
                            </code>
                        </div>
                    </div>

                    {/* Arrow */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-4 border-transparent border-t-gray-900" />
                </div>
            )}
        </div>
    );
}
