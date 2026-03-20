import { useState } from 'react';
import { useTikTokAdsStore } from '../../store/useTikTokAdsStore';
import { Copy, Database, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

export function AdsDataReviewView() {
    const { debugData, error } = useTikTokAdsStore();
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        'sync': true,
        'overview': true,
        'campaigns': true,
        'spend': true,
        'assets': true
    });

    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const sections = [
        { id: 'sync', label: 'Sync Summary', icon: Database },
        { id: 'overview', label: 'Ads Overview', icon: Database },
        { id: 'campaigns', label: 'Campaigns', icon: Database },
        { id: 'spend', label: 'Spend Data', icon: Database },
        { id: 'assets', label: 'Ad Assets', icon: Database },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-2">Ads Data Review</h1>
                    <p className="text-gray-400">Inspect raw JSON responses from TikTok Ads API.</p>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-start gap-3 max-w-md">
                    <div className="p-2 bg-blue-500/20 rounded-lg shrink-0">
                        <AlertTriangle className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <p className="text-sm text-blue-300 font-medium mb-1">How to use</p>
                        <p className="text-xs text-blue-200/70">
                            1. Go to <strong>Marketing</strong> tab and click "Sync Ads".<br />
                            2. Come back here to view the raw data response.<br />
                            3. Review the JSON below to see if values are 0 or missing.
                        </p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <span className="text-red-300">{error}</span>
                </div>
            )}

            <div className="grid gap-6">
                {sections.map(section => {
                    const data = debugData[section.id];
                    const isExpanded = expandedSections[section.id];
                    const isEmpty = !data || (Array.isArray(data) && data.length === 0) || (typeof data === 'object' && Object.keys(data).length === 0);

                    return (
                        <div key={section.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                            <button
                                onClick={() => toggleSection(section.id)}
                                className="w-full flex items-center justify-between p-4 hover:bg-gray-750 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${isEmpty ? 'bg-gray-700 text-gray-400' : 'bg-pink-500/10 text-pink-400'}`}>
                                        <section.icon className="w-5 h-5" />
                                    </div>
                                    <div className="text-left">
                                        <h3 className="font-medium text-white">{section.label}</h3>
                                        <p className="text-xs text-gray-400">
                                            {isEmpty ? 'No data captured yet' : 'Data available'}
                                        </p>
                                    </div>
                                </div>
                                {isExpanded ? (
                                    <ChevronDown className="w-5 h-5 text-gray-500" />
                                ) : (
                                    <ChevronRight className="w-5 h-5 text-gray-500" />
                                )}
                            </button>

                            {isExpanded && (
                                <div className="border-t border-gray-700 bg-gray-900/50 p-4">
                                    {isEmpty ? (
                                        <div className="text-center py-8 text-gray-500 text-sm">
                                            Run a sync to populate this data.
                                        </div>
                                    ) : (
                                        <div className="relative group">
                                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
                                                    className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white border border-gray-600 transition-colors"
                                                    title="Copy JSON"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <pre className="text-xs text-green-400 font-mono overflow-auto max-h-[500px] p-4 bg-black/50 rounded-lg custom-scrollbar">
                                                {JSON.stringify(data, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
