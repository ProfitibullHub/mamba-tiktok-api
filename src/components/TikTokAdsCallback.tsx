import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader } from 'lucide-react';

export function TikTokAdsCallback() {
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('Processing authorization...');

    useEffect(() => {
        const handleCallback = async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const authCode = params.get('auth_code');
                const state = params.get('state');

                if (!authCode || !state) {
                    throw new Error('Missing authorization parameters');
                }

                // Backend handles the token exchange automatically
                // Just show success and redirect
                setStatus('success');
                setMessage('TikTok Ads connected successfully!');

                // Redirect to dashboard after 2 seconds
                setTimeout(() => {
                    window.location.href = '/dashboard?tiktok_ads_connected=true';
                }, 2000);

            } catch (error: any) {
                console.error('[TikTok Ads Callback] Error:', error);
                setStatus('error');
                setMessage(error.message || 'Failed to connect TikTok Ads');

                // Redirect back to dashboard after 3 seconds
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 3000);
            }
        };

        handleCallback();
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-6">
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl p-10 max-w-md w-full text-center">
                {status === 'loading' && (
                    <>
                        <Loader className="w-16 h-16 text-pink-500 mx-auto mb-6 animate-spin" />
                        <h2 className="text-2xl font-bold text-white mb-3">
                            Connecting TikTok Ads...
                        </h2>
                        <p className="text-gray-400 text-sm">
                            {message}
                        </p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="bg-green-500/10 border border-green-500/30 rounded-full w-20 h-20 mx-auto mb-6 flex items-center justify-center">
                            <CheckCircle className="w-12 h-12 text-green-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-3">
                            Successfully Connected!
                        </h2>
                        <p className="text-gray-300 mb-2">
                            {message}
                        </p>
                        <p className="text-gray-500 text-sm">
                            Redirecting to dashboard...
                        </p>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <div className="bg-red-500/10 border border-red-500/30 rounded-full w-20 h-20 mx-auto mb-6 flex items-center justify-center">
                            <XCircle className="w-12 h-12 text-red-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-3">
                            Connection Failed
                        </h2>
                        <p className="text-gray-300 mb-2">
                            {message}
                        </p>
                        <p className="text-gray-500 text-sm">
                            Redirecting back...
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
