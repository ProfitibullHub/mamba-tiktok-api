import { useState } from 'react';
import { Search, Filter, RefreshCw } from 'lucide-react';
import { useShopStore, Order } from '../../store/useShopStore';
import { Account } from '../../lib/supabase';
import { OrderCard } from '../OrderCard';
import { OrderDetails } from '../OrderDetails';

interface OrdersViewProps {
    account: Account;
    shopId?: string;
}

export function OrdersView({ account, shopId }: OrdersViewProps) {
    const { orders, isLoading, syncData, cacheMetadata } = useShopStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;

    const handleSync = async () => {
        if (!shopId) return;
        await syncData(account.id, shopId, 'orders');
    };

    const filteredOrders = orders.filter(order => {
        const matchesSearch =
            order.order_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            order.line_items.some(item => item.product_name.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesStatus = statusFilter === 'all' || order.order_status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    // Reset page when filters change
    if (currentPage > 1 && filteredOrders.length < (currentPage - 1) * itemsPerPage) {
        setCurrentPage(1);
    }

    const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-white">Orders</h2>
                    <p className="text-gray-400">Manage and track your shop orders</p>
                </div>
                <button
                    onClick={handleSync}
                    disabled={cacheMetadata.isSyncing || isLoading}
                    className="flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={20} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
                    <span>{cacheMetadata.isSyncing ? 'Syncing...' : 'Sync Orders'}</span>
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by Order ID or Product..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-pink-500"
                    />
                </div>
                <div className="flex gap-4">
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-gray-900 border border-gray-700 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:border-pink-500 appearance-none cursor-pointer"
                        >
                            <option value="all">All Status</option>
                            <option value="UNPAID">Unpaid</option>
                            <option value="AWAITING_SHIPMENT">Awaiting Shipment</option>
                            <option value="AWAITING_COLLECTION">Awaiting Collection</option>
                            <option value="SHIPPED">Shipped</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="CANCELLED">Cancelled</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Orders Grid */}
            {isLoading && orders.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
                </div>
            ) : filteredOrders.length > 0 ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {paginatedOrders.map((order) => (
                            <OrderCard
                                key={order.order_id}
                                order={order}
                                onClick={() => setSelectedOrder(order)}
                            />
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex justify-center items-center space-x-4 mt-8">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
                            >
                                Previous
                            </button>
                            <span className="text-gray-400">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700 border-dashed">
                    <p className="text-gray-400 text-lg">No orders found matching your criteria</p>
                </div>
            )}

            {/* Order Details Modal */}
            {selectedOrder && (
                <OrderDetails
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                />
            )}
        </div>
    );
}
