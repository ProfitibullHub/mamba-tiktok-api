import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut } from 'lucide-react';
import { MAMBA_FULL_LOGO_SRC } from '../lib/brandAssets';

interface WelcomeScreenProps {
    onConnect?: () => void;
    onConnectAgency?: () => void;
    onSkip?: () => void;
    isConnecting?: boolean;
}

export default function WelcomeScreen({ onConnect, onConnectAgency, onSkip, isConnecting = false }: WelcomeScreenProps) {
    const { profile, signOut } = useAuth();
    const [localConnecting, setLocalConnecting] = useState(false);
    const [localAgencyConnecting, setLocalAgencyConnecting] = useState(false);

    const handleConnect = async () => {
        if (onConnect) {
            setLocalConnecting(true);
            try {
                await onConnect();
            } finally {
                setLocalConnecting(false);
            }
        }
    };

    const handleConnectAgency = async () => {
        if (onConnectAgency) {
            setLocalAgencyConnecting(true);
            try {
                await onConnectAgency();
            } finally {
                setLocalAgencyConnecting(false);
            }
        }
    };

    const isLoading = isConnecting || localConnecting || localAgencyConnecting;

    return (
        <div className="fixed inset-0 z-50 bg-gradient-to-br from-gray-900 via-purple-900 to-mamba-dark flex items-center justify-center p-6 overflow-hidden">
            <div className="absolute top-6 right-6 z-10 flex gap-3">
                {onSkip && (
                    <button
                        type="button"
                        onClick={onSkip}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all border border-white/20 backdrop-blur-sm text-sm font-medium"
                    >
                        Continue without connecting
                    </button>
                )}
                <button
                    onClick={() => signOut()}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 hover:bg-gray-800 text-gray-300 hover:text-white rounded-lg transition-all border border-gray-700 hover:border-gray-600 backdrop-blur-sm"
                >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                </button>
            </div>

            <div className="max-w-4xl w-full max-h-full overflow-y-auto custom-scrollbar">
                {/* Welcome Header */}
                <div className="text-center mb-8">
                    <div className="flex justify-center mb-4">
                        <img
                            src={MAMBA_FULL_LOGO_SRC}
                            alt="Mamba"
                            className="h-28 w-auto max-w-[min(100%,360px)] object-contain drop-shadow-lg drop-shadow-mamba-green/20"
                        />
                    </div>
                    <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">Welcome</h1>
                    <p className="text-xl text-gray-300">
                        Hi {profile?.full_name || 'there'}! Let's connect your TikTok Shop to get started.
                    </p>
                </div>

                {/* Main Card */}
                <div className="bg-gray-800/50 backdrop-blur-lg rounded-2xl border border-gray-700 p-8 shadow-2xl">
                    {/* Instructions */}
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-white mb-6">Quick Setup</h2>
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="bg-mamba-green rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 text-mamba-dark font-bold shadow-lg shadow-mamba-green/30">
                                    1
                                </div>
                                <div>
                                    <h3 className="text-white font-semibold mb-1 text-lg">Connect Your TikTok Shop</h3>
                                    <p className="text-gray-400">Authorize access to your TikTok Shop seller account</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <div className="bg-gray-700 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 text-gray-400 font-bold border border-gray-600">
                                    2
                                </div>
                                <div>
                                    <h3 className="text-white font-semibold mb-1 text-lg">Sync Your Data</h3>
                                    <p className="text-gray-400">We'll fetch your orders, products, and sales data</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <div className="bg-gray-700 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 text-gray-400 font-bold border border-gray-600">
                                    3
                                </div>
                                <div>
                                    <h3 className="text-white font-semibold mb-1 text-lg">View Your Analytics</h3>
                                    <p className="text-gray-400">Track revenue, orders, inventory, and performance</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Connection Component */}
                    <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-700">
                        <button
                            onClick={handleConnect}
                            disabled={isLoading}
                            className="w-full bg-gradient-to-r from-mamba-green to-mamba-deep text-mamba-dark px-6 py-4 rounded-xl font-semibold text-lg hover:from-mamba-neon hover:to-mamba-deep transition-all shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none active:scale-[0.98]"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-mamba-dark border-t-transparent"></div>
                                    Connecting...
                                </span>
                            ) : (
                                'Connect TikTok Shop'
                            )}
                        </button>

                        <div className="mt-4 flex items-center justify-center">
                            <span className="text-gray-400 text-sm">or</span>
                        </div>

                        <button
                            onClick={handleConnectAgency}
                            disabled={isLoading}
                            className="w-full mt-4 bg-gray-700 text-white px-6 py-4 rounded-xl font-semibold text-lg hover:bg-gray-600 transition-all shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none active:scale-[0.98] border border-gray-600"
                        >
                            {localAgencyConnecting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                                    Connecting Agency...
                                </span>
                            ) : (
                                'Connect as Agency (Partner)'
                            )}
                        </button>
                    </div>

                    {/* Info Box */}
                    <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                        <p className="text-blue-300 text-sm flex gap-2">
                            <span className="text-lg">💡</span>
                            <span>
                                <strong>Note:</strong> We only request read-only access to your TikTok Shop data.
                                We cannot make changes to your shop or process orders on your behalf.
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
