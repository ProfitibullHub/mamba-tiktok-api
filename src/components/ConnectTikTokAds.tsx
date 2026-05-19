import { useState, useEffect } from 'react';
import { TrendingUp, Zap, CheckCircle, Loader } from 'lucide-react';
import { useTikTokAdsStore } from '../store/useTikTokAdsStore';

interface ConnectTikTokAdsProps {
    accountId: string;
    compact?: boolean;
}

export function ConnectTikTokAds({ accountId, compact = false }: ConnectTikTokAdsProps) {
    const { connected, isLoading, checkConnection, connectTikTokAds } = useTikTokAdsStore();
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const check = async () => {
            setChecking(true);
            await checkConnection(accountId);
            setChecking(false);
        };
        check();
    }, [accountId, checkConnection]);

    const handleConnect = async () => {
        try {
            await connectTikTokAds(accountId);
        } catch (error) {
            console.error('Failed to connect TikTok Ads:', error);
        }
    };

    if (checking) {
        return compact ? null : (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Loader className="w-4 h-4 animate-spin" />
                <span>Checking connection...</span>
            </div>
        );
    }

    if (connected) {
        return (
            <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>TikTok Ads Connected</span>
            </div>
        );
    }

    // Not connected - show connect button
    if (compact) {
        return (
            <button
                onClick={handleConnect}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-mamba-green to-mamba-deep hover:from-mamba-neon hover:to-mamba-deep text-mamba-dark text-sm font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isLoading ? (
                    <>
                        <Loader className="w-4 h-4 animate-spin" />
                        <span>Connecting...</span>
                    </>
                ) : (
                    <>
                        <Zap className="w-4 h-4" />
                        <span>Connect Ads</span>
                    </>
                )}
            </button>
        );
    }

    return (
        <div className="bg-gradient-to-r from-mamba-green/10 to-mamba-deep/10 border border-mamba-green/30 rounded-xl p-6">
            <div className="flex items-start gap-4">
                <div className="bg-gradient-to-r from-mamba-neon to-mamba-deep p-3 rounded-xl">
                    <TrendingUp className="w-6 h-6 text-mamba-dark" />
                </div>
                <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2">
                        Track Your Ad Performance
                    </h3>
                    <p className="text-gray-400 text-sm mb-4">
                        Connect your TikTok Ads account to track spend, ROAS, conversions, and integrate ad costs into your profit calculations.
                    </p>
                    <button
                        onClick={handleConnect}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-mamba-green to-mamba-deep hover:from-mamba-neon hover:to-mamba-deep text-mamba-dark font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <>
                                <Loader className="w-5 h-5 animate-spin" />
                                <span>Connecting...</span>
                            </>
                        ) : (
                            <>
                                <Zap className="w-5 h-5" />
                                <span>Connect TikTok Ads</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
