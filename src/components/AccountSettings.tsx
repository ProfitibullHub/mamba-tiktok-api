import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import TikTokConnect from './TikTokConnect';
import TikTokAnalytics from './TikTokAnalytics';

interface Account {
    id: string;
    name: string;
    tiktok_handle: string;
}

export default function AccountSettings() {
    const { user } = useAuth();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            fetchAccounts();
        }
    }, [user]);

    const fetchAccounts = async () => {
        try {
            setLoading(true);

            // Get user's profile to check role
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user?.id)
                .single();

            let query = supabase.from('accounts').select('*');

            // If not admin, filter by user's assigned accounts
            if (profile?.role !== 'admin') {
                const { data: userAccounts } = await supabase
                    .from('user_accounts')
                    .select('account_id')
                    .eq('user_id', user?.id);

                const accountIds = userAccounts?.map(ua => ua.account_id) || [];
                query = query.in('id', accountIds);
            }

            const { data, error } = await query;

            if (error) throw error;

            setAccounts(data || []);
            if (data && data.length > 0 && !selectedAccount) {
                setSelectedAccount(data[0].id);
            }
        } catch (error) {
            console.error('Error fetching accounts:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Account Settings</h1>
                <p className="text-gray-500 mt-2">Manage your TikTok account connections and view analytics</p>
            </div>

            {/* Account Selector */}
            {accounts.length > 1 && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select Account
                    </label>
                    <select
                        value={selectedAccount || ''}
                        onChange={(e) => setSelectedAccount(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                                {account.name} ({account.tiktok_handle})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {selectedAccount && (
                <>
                    {/* TikTok Connection */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">TikTok Connection</h2>
                        <TikTokConnect accountId={selectedAccount} />
                    </div>

                    {/* TikTok Analytics */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">TikTok Analytics</h2>
                        <TikTokAnalytics accountId={selectedAccount} />
                    </div>
                </>
            )}

            {accounts.length === 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                    <p className="text-yellow-800">No accounts found. Please contact your administrator.</p>
                </div>
            )}
        </div>
    );
}
