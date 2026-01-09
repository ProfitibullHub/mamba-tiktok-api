import { useQuery } from '@tanstack/react-query';
import { Users, Store, TrendingUp, Activity } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export function AdminDashboard() {


    const { profile } = useAuth();

    const { data: stats, isLoading } = useQuery({
        queryKey: ['admin-stats'],
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch(`${API_BASE_URL}/api/admin/stats`, {
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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
            </div>
        );
    }

    const cards = [
        { label: 'Total Users', value: stats?.totalUsers || 0, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
        { label: 'Integrated Stores', value: stats?.totalStores || 0, icon: Store, color: 'text-pink-400', bg: 'bg-pink-400/10' },
        { label: 'Active Sessions', value: stats?.totalUsers || 0, icon: Activity, color: 'text-green-400', bg: 'bg-green-400/10' },
        { label: 'Growth Rate', value: '+12%', icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    ];

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-white mb-2">Admin Dashboard</h2>
                <p className="text-gray-400">Overview of the Mamba platform performance and users.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {cards.map((card) => (
                    <div key={card.label} className="bg-gray-800/50 border border-gray-700 p-6 rounded-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <div className={`${card.bg} p-3 rounded-xl`}>
                                <card.icon className={`w-6 h-6 ${card.color}`} />
                            </div>
                        </div>
                        <p className="text-gray-400 text-sm font-medium">{card.label}</p>
                        <h3 className="text-3xl font-bold text-white mt-1">{card.value}</h3>
                    </div>
                ))}
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-8">
                <h3 className="text-xl font-bold text-white mb-4">Platform Activity</h3>
                <div className="h-64 flex items-center justify-center border-2 border-dashed border-gray-700 rounded-xl">
                    <p className="text-gray-500">Activity chart will be implemented here</p>
                </div>
            </div>
        </div>
    );
}
