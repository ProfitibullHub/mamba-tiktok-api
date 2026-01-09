import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export function AdminUserManagement() {
    const queryClient = useQueryClient();
    const { profile } = useAuth();
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

    const { data: users, isLoading } = useQuery({
        queryKey: ['admin-users'],
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (data.success) return data.data;
            throw new Error(data.error);
        },
        enabled: profile?.role === 'admin'
    });

    const updateRoleMutation = useMutation({
        mutationFn: async ({ userId, role }: { userId: string, role: string }) => {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/role`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ role })
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.error);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
            setUpdatingUserId(null);
        }
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-white mb-2">User Management</h2>
                <p className="text-gray-400">Manage user roles and view their connected stores.</p>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-gray-700 bg-gray-800/50">
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">User</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Role</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Connected Stores</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Joined</th>
                            <th className="px-6 py-4 text-sm font-semibold text-gray-300">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {users?.map((user: any) => (
                            <tr key={user.id} className="hover:bg-gray-700/30 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-gray-700 p-2 rounded-full">
                                            <User className="w-4 h-4 text-gray-300" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-white">{user.full_name}</p>
                                            <p className="text-xs text-gray-400">{user.email}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="relative">
                                        <select
                                            value={user.role}
                                            onChange={(e) => {
                                                setUpdatingUserId(user.id);
                                                updateRoleMutation.mutate({ userId: user.id, role: e.target.value });
                                            }}
                                            disabled={updatingUserId === user.id}
                                            className={`bg-gray-700 border border-gray-600 text-white text-xs rounded-lg focus:ring-pink-500 focus:border-pink-500 block w-full p-2.5 ${updatingUserId === user.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            <option value="client">User</option>
                                            <option value="moderator">Moderator</option>
                                            <option value="accountant">Accountant</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                        {updatingUserId === user.id && (
                                            <div className="absolute right-8 top-1/2 -translate-y-1/2">
                                                <div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-wrap gap-2">
                                        {user.user_accounts?.map((ua: any) => (
                                            ua.accounts?.tiktok_shops?.map((shop: any) => (
                                                <span key={shop.id} className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-pink-500/10 text-pink-400 border border-pink-500/20">
                                                    {shop.shop_name}
                                                </span>
                                            ))
                                        )) || <span className="text-gray-500 text-xs italic">No stores connected</span>}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-400">
                                    {new Date(user.created_at).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4">
                                    <button className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 transition-colors">
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
