import { useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Layers,
    FolderOpen,
    FileVideo,
    ExternalLink
} from 'lucide-react';
import { CampaignAsset, AdGroupAsset, AdAsset } from '../store/useTikTokAdsStore';

interface CampaignRowProps {
    campaign: CampaignAsset;
    defaultExpanded?: boolean;
}

export function CampaignRow({ campaign, defaultExpanded = false }: CampaignRowProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);

    const toggleExpanded = () => setExpanded(!expanded);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount);
    };

    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800/30">
            {/* Campaign Header */}
            <div
                className="flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 cursor-pointer transition-colors"
                onClick={toggleExpanded}
            >
                <div className="flex items-center gap-3">
                    <button className="p-1 hover:bg-gray-700 rounded transition-colors">
                        {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    </button>
                    <div className="p-2 bg-pink-500/10 rounded-lg">
                        <Layers size={18} className="text-pink-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h4 className="font-medium text-white">{campaign.campaign_name}</h4>
                            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${campaign.status === 'ENABLE'
                                    ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                    : 'bg-gray-500/10 text-gray-400 border-gray-500/30'
                                }`}>
                                {campaign.status}
                            </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                            <span>ID: {campaign.campaign_id}</span>
                            <span>•</span>
                            <span>{campaign.objective_type}</span>
                            <span>•</span>
                            <span>{campaign.budget_mode} Budget: {formatCurrency(campaign.budget)}</span>
                        </div>
                    </div>
                </div>

                {campaign.metrics && (
                    <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                            <p className="text-gray-400 text-xs">Spend</p>
                            <p className="font-medium text-white">{formatCurrency(campaign.metrics.spend)}</p>
                        </div>
                        <div className="text-right hidden sm:block">
                            <p className="text-gray-400 text-xs">Impr.</p>
                            <p className="font-medium text-white">{campaign.metrics.impressions.toLocaleString()}</p>
                        </div>
                        <div className="text-right hidden sm:block">
                            <p className="text-gray-400 text-xs">Clicks</p>
                            <p className="font-medium text-white">{campaign.metrics.clicks.toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-gray-400 text-xs">Conv.</p>
                            <p className="font-medium text-white">{campaign.metrics.conversions}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Ad Groups */}
            {expanded && (
                <div className="border-t border-gray-700 bg-gray-900/30">
                    {campaign.ad_groups && campaign.ad_groups.length > 0 ? (
                        campaign.ad_groups.map(adGroup => (
                            <AdGroupRow key={adGroup.id} adGroup={adGroup} />
                        ))
                    ) : (
                        <div className="p-4 pl-14 text-sm text-gray-500">
                            No ad groups found in this campaign.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AdGroupRow({ adGroup }: { adGroup: AdGroupAsset }) {
    const [expanded, setExpanded] = useState(false);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount);
    };

    return (
        <div className="border-l-4 border-l-pink-500/20 ml-4 pb-1">
            <div
                className="flex items-center justify-between p-3 pl-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    <button className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-500">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div className="p-1.5 bg-orange-500/10 rounded-md">
                        <FolderOpen size={16} className="text-orange-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-200">{adGroup.adgroup_name}</span>
                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full border ${adGroup.status === 'ENABLE'
                                    ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                    : 'bg-gray-500/10 text-gray-400 border-gray-500/30'
                                }`}>
                                {adGroup.status}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                            <span>{adGroup.optimization_goal}</span>
                            <span>•</span>
                            <span>Bid: {adGroup.bid_type}</span>
                        </div>
                    </div>
                </div>

                {adGroup.metrics && (
                    <div className="flex items-center gap-4 text-xs pr-4">
                        <div className="text-right">
                            <span className="text-gray-500 mr-2">Spend</span>
                            <span className="text-gray-300">{formatCurrency(adGroup.metrics.spend)}</span>
                        </div>
                        <div className="text-right">
                            <span className="text-gray-500 mr-2">Conv.</span>
                            <span className="text-gray-300">{adGroup.metrics.conversions}</span>
                        </div>
                    </div>
                )}
            </div>

            {expanded && (
                <div className="pl-12 pr-4 pb-3 space-y-2">
                    {adGroup.ads && adGroup.ads.length > 0 ? (
                        adGroup.ads.map(ad => (
                            <AdRow key={ad.id} ad={ad} />
                        ))
                    ) : (
                        <div className="p-2 text-xs text-gray-500 italic">
                            No ads found in this ad group.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AdRow({ ad }: { ad: AdAsset }) {
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount);
    };

    return (
        <div className="flex items-center justify-between p-2 bg-gray-800/40 rounded border border-gray-700/50 hover:border-gray-600/50 transition-colors">
            <div className="flex items-center gap-3">
                <div className="p-1.5 bg-purple-500/10 rounded-md shrink-0">
                    <FileVideo size={14} className="text-purple-400" />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-300 truncate">{ad.ad_name}</span>
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full border ${ad.status === 'ENABLE'
                                ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                : 'bg-gray-500/10 text-gray-400 border-gray-500/30'
                            }`}>
                            {ad.status}
                        </span>
                    </div>
                    {ad.call_to_action && (
                        <p className="text-xs text-gray-500 mt-0.5">CTA: {ad.call_to_action}</p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-4">
                {ad.metrics && (
                    <div className="flex items-center gap-3 text-xs">
                        <div className="text-right">
                            <span className="text-gray-500 mr-1.5">Spend</span>
                            <span className="text-gray-300">{formatCurrency(ad.metrics.spend)}</span>
                        </div>
                        <div className="text-right w-16">
                            <span className="text-gray-500 mr-1.5">CTR</span>
                            <span className="text-gray-300">
                                {ad.metrics.impressions > 0
                                    ? ((ad.metrics.clicks / ad.metrics.impressions) * 100).toFixed(2)
                                    : '0.00'}%
                            </span>
                        </div>
                    </div>
                )}

                <div className="flex gap-1">
                    {ad.landing_page_url && (
                        <a
                            href={ad.landing_page_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors"
                            title="View Landing Page"
                        >
                            <ExternalLink size={14} />
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
