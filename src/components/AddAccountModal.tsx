import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface AddAccountModalProps {
    onAccountAdded: () => void;
}

export function AddAccountModal({ onAccountAdded }: AddAccountModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [accountName, setAccountName] = useState('');
    const [tiktokHandle, setTiktokHandle] = useState('');
    const [loading, setLoading] = useState(false);
    const { profile } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            setLoading(true);

            // Create the account
            const { data: account, error: accountError } = await supabase
                .from('accounts')
                .insert({
                    name: accountName.trim() || 'New Shop',
                    tiktok_handle: tiktokHandle.trim() || null,
                    status: 'active',
                })
                .select()
                .single();

            if (accountError) throw accountError;

            // Link account to user
            const { error: linkError } = await supabase
                .from('user_accounts')
                .insert({
                    user_id: profile?.id,
                    account_id: account.id,
                });

            if (linkError) throw linkError;

            // Reset form and close modal
            setAccountName('');
            setTiktokHandle('');
            setIsOpen(false);

            // Notify parent to refresh accounts
            onAccountAdded();
        } catch (error: any) {
            console.error('Error creating account:', error);
            alert(`Failed to create account: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-red-500 text-white rounded-lg font-semibold hover:from-pink-600 hover:to-red-600 transition-all shadow-lg hover:shadow-xl"
            >
                <Plus className="w-5 h-5" />
                Add Account
            </button>

            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsOpen(false)} />

                    {/* Modal */}
                    <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
                        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 max-w-md w-full shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-2xl font-bold text-white">Add New Account</h2>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="text-gray-400 hover:text-white transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Account Name (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={accountName}
                                        onChange={(e) => setAccountName(e.target.value)}
                                        placeholder="e.g., My TikTok Shop (will be updated automatically)"
                                        className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-pink-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        TikTok Handle (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={tiktokHandle}
                                        onChange={(e) => setTiktokHandle(e.target.value)}
                                        placeholder="@yourshop"
                                        className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-pink-500"
                                    />
                                </div>

                                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                                    <p className="text-blue-300 text-sm">
                                        💡 After creating the account, you'll be able to connect it to your TikTok Shop.
                                    </p>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsOpen(false)}
                                        className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg font-semibold hover:bg-gray-600 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="flex-1 px-4 py-2 bg-gradient-to-r from-pink-500 to-red-500 text-white rounded-lg font-semibold hover:from-pink-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {loading ? 'Creating...' : 'Create Account'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
