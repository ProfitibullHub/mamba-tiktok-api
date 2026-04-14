import { Plus, ShoppingBag, MapPin, ExternalLink, RefreshCw, Trash2, User, AlertTriangle, Clock } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/apiClient';

interface TokenHealth {
    status: 'healthy' | 'warning' | 'critical' | 'expired';
    message: string | null;
    expiresAt: string | null;
    refreshTokenExpiresIn: number | null;
}

interface Shop {
    shop_id: string;
    shop_name: string;
    region: string;
    seller_type: string;
    created_at: string;
    account_id?: string;
    tokenHealth?: TokenHealth;
}

interface AdminAccount {
    id: string;
    account_name: string;
    owner_role?: string;
    original_name?: string;
    owner_id?: string;
    stores: Shop[];
}

interface ShopListProps {
    shops: Shop[];
    adminAccounts?: AdminAccount[];
    /** When false, never show the “All Platform Shops” admin grid (even if adminAccounts is populated). */
    showPlatformShopExplorer?: boolean;
    currentUserId?: string;
    deletingShopId?: string | null;
    disconnectPrompt?: { shopName: string } | null;
    onDismissDisconnect?: () => void;
    onSelectShop: (shop: Shop, account?: AdminAccount) => void;
    onAddShop: () => void;
    onAddAgency?: () => void;
    onSyncShops: () => void;
    onDeleteShop: (shop: Shop) => void;
    isLoading?: boolean;
    isSyncing?: boolean;
}

function formatExpiryDate(isoDate: string | null): string {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ShopCard({
    shop,
    onSelect,
    onDelete,
    isDeleting,
    onRefreshToken,
    isRefreshing,
    reviveStatus = 'idle',
    isAdminView = false,
    isOwnShop = true,
    disconnectingShopName,
    onDismissDisconnect
}: {
    shop: Shop,
    onSelect: () => void,
    onDelete?: (e: React.MouseEvent) => void,
    isDeleting?: boolean,
    onRefreshToken?: () => void,
    isRefreshing?: boolean,
    reviveStatus?: 'idle' | 'refreshing' | 'reauthorizing',
    isAdminView?: boolean,
    isOwnShop?: boolean,
    disconnectingShopName?: string | null,
    onDismissDisconnect?: () => void
}) {
    const tokenHealth = shop.tokenHealth;
    const isExpired = tokenHealth?.status === 'expired';
    const needsAttention = tokenHealth?.status === 'warning' || tokenHealth?.status === 'critical';

    // Determine the expired message based on context
    const getExpiredMessage = () => {
        if (isAdminView && !isOwnShop) {
            return {
                title: 'Client Authorization Expired',
                subtitle: 'The client needs to reauthorize their TikTok Shop connection.',
                buttonText: 'Contact Client'
            };
        }
        return {
            title: 'Authorization Expired',
            subtitle: 'Your TikTok Shop authorization has expired. Please reconnect to continue.',
            buttonText: 'Reconnect Shop'
        };
    };

    const expiredContent = getExpiredMessage();

    return (
        <div className="relative">
            {/* Disconnect Prompt Overlay */}
            {disconnectingShopName && (
                <div className="absolute inset-0 z-20 bg-gray-900/95 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center p-6 text-center">
                    <div className="p-3 bg-pink-500/20 rounded-full mb-3">
                        <ExternalLink className="w-7 h-7 text-pink-400" />
                    </div>
                    <h4 className="text-white font-semibold mb-1 text-sm">To Remove This Shop</h4>
                    <p className="text-gray-400 text-xs leading-relaxed mb-4">
                        You need to cancel the authorization<br />from your TikTok Seller Center.<br />Find <span className="text-pink-400 font-medium">Mamba</span> in the list and click <span className="text-white font-medium">"Cancel Authorization"</span>.
                    </p>
                    <div className="flex gap-2">
                        <a
                            href="https://seller-us.tiktok.com/services/authorizations?shop_region=US&tab=apps"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                        >
                            <ExternalLink size={12} />
                            Open TikTok Seller Center
                        </a>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDismissDisconnect?.(); }}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium rounded-lg transition-colors"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )
            }

            {/* Expired Overlay - TEMPORARILY DISABLED FOR DEBUGGING */}
            {
                false && isExpired && (
                    <div className="absolute inset-0 z-10 bg-gray-900/90 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center p-6 text-center">
                        <div className="p-3 bg-red-500/20 rounded-full mb-3">
                            <AlertTriangle className="w-8 h-8 text-red-400" />
                        </div>
                        <h4 className="text-white font-semibold mb-2">{expiredContent.title}</h4>
                        <p className="text-gray-400 text-sm mb-4">
                            {expiredContent.subtitle}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRefreshToken?.();
                                }}
                                disabled={isRefreshing || reviveStatus !== 'idle'}
                                className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-70"
                            >
                                <RefreshCw size={18} className={(isRefreshing || reviveStatus !== 'idle') ? "animate-spin" : ""} />
                                {reviveStatus === 'reauthorizing'
                                    ? 'Redirecting to TikTok...'
                                    : reviveStatus === 'refreshing'
                                        ? 'Attempting Revival...'
                                        : 'Revive Connection'}
                            </button>
                        </div>
                    </div>
                )
            }


            <div
                onClick={onSelect} // TEMPORARILY ALLOW CLICKING EXPIRED SHOPS
                className={`bg-gray-800 rounded-xl p-6 border transition-all relative overflow-hidden ${isDeleting
                    ? 'border-red-500/50 cursor-wait'
                    : isExpired
                        ? 'border-red-500/50 opacity-60 cursor-not-allowed filter blur-[1px]'
                        : 'border-gray-700 hover:border-pink-500 cursor-pointer group'
                    }`}
            >
                {/* Full-card deletion overlay */}
                {isDeleting && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gray-900/80 rounded-xl">
                        <RefreshCw size={24} className="animate-spin text-red-400" />
                        <span className="text-sm font-medium text-red-300">Removing shop…</span>
                    </div>
                )}
                <div className={`absolute top-0 right-0 p-4 transition-opacity flex space-x-2 ${isDeleting || isExpired ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    {isOwnShop && onDelete && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(e); }}
                            disabled={isDeleting}
                            className={`p-2 rounded-lg transition-colors ${isDeleting
                                ? 'bg-red-500/10 text-red-500 cursor-wait'
                                : 'bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white'
                                }`}
                            title={isExpired ? 'Remove expired shop & free TikTok slot' : 'Delete Shop'}
                        >
                            {isDeleting ? (
                                <RefreshCw size={16} className="animate-spin" />
                            ) : (
                                <Trash2 size={16} />
                            )}
                        </button>
                    )}
                    {!isExpired && <ExternalLink size={20} className="text-gray-400 group-hover:text-pink-500" />}
                </div>

                <div className="flex items-start space-x-4">
                    <div className="p-3 bg-gray-700 rounded-lg group-hover:bg-pink-500/10 group-hover:text-pink-500 transition-colors">
                        <ShoppingBag size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-white mb-1 truncate">{shop.shop_name}</h3>
                        <div className="flex items-center text-gray-400 text-sm mb-2">
                            <MapPin size={14} className="mr-1 flex-shrink-0" />
                            {shop.region}
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isExpired
                            ? 'bg-red-900/50 text-red-400'
                            : 'bg-green-900/50 text-green-400'
                            }`}>
                            {isExpired ? 'Expired' : 'Active'}
                        </span>
                    </div>
                </div>

                {/* Token Warning Banner */}
                {needsAttention && tokenHealth && (
                    <div className={`mt-4 p-3 rounded-lg flex items-center justify-between gap-2 ${tokenHealth.status === 'critical'
                        ? 'bg-orange-500/10 border border-orange-500/30'
                        : 'bg-yellow-500/10 border border-yellow-500/30'
                        }`}>
                        <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
                            <Clock size={14} className={tokenHealth.status === 'critical' ? 'text-orange-400' : 'text-yellow-400'} />
                            <span className={`truncate ${tokenHealth.status === 'critical' ? 'text-orange-200' : 'text-yellow-200'}`}>
                                Reauthorize by {formatExpiryDate(tokenHealth.expiresAt)}
                            </span>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRefreshToken?.();
                            }}
                            disabled={isRefreshing}
                            className={`p-1.5 rounded-md transition-colors flex-shrink-0 ${isRefreshing
                                ? 'bg-gray-600 cursor-wait'
                                : tokenHealth.status === 'critical'
                                    ? 'bg-orange-500/20 hover:bg-orange-500/40 text-orange-300'
                                    : 'bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-300'
                                }`}
                            title="Refresh Token"
                        >
                            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                        </button>
                    </div>
                )}

                <div className="mt-6 pt-4 border-t border-gray-700 flex justify-between items-center text-sm text-gray-400">
                    <span className="truncate">ID: {shop.shop_id}</span>
                    <span>{shop.created_at ? new Date(shop.created_at).toLocaleDateString() : 'N/A'}</span>
                </div>
            </div>
        </div >
    );
}

export function ShopList({
    shops,
    adminAccounts,
    showPlatformShopExplorer = false,
    currentUserId,
    deletingShopId,
    disconnectPrompt,
    onDismissDisconnect,
    onSelectShop,
    onAddShop,
    onAddAgency,
    onSyncShops,
    onDeleteShop,
    isLoading,
    isSyncing,
}: ShopListProps) {
    const [refreshingShopId, setRefreshingShopId] = useState<string | null>(null);
    const [reviveStatus, setReviveStatus] = useState<'idle' | 'refreshing' | 'reauthorizing'>('idle');

    const handleReauthorize = async (accountId: string) => {
        try {
            setReviveStatus('reauthorizing');
            const response = await apiFetch(`/api/tiktok-shop/auth/start`, {
                method: 'POST',
                body: JSON.stringify({ accountId })
            });
            const data = await response.json();
            if (data.authUrl) {
                window.location.href = data.authUrl;
            }
        } catch (err) {
            console.error('Error starting re-auth:', err);
            setReviveStatus('idle');
        }
    };

    const handleRefreshToken = async (shop: Shop) => {
        if (!shop.account_id) return;

        setRefreshingShopId(shop.shop_id);
        setReviveStatus('refreshing');

        try {
            // Step 1: Attempt to sync/refresh the shop data
            const response = await apiFetch(`/api/tiktok-shop/sync/${shop.account_id}`, {
                method: 'POST',
                body: JSON.stringify({ shopId: shop.shop_id, syncType: 'orders' })
            });
            const data = await response.json();

            if (data.success) {
                // Token refresh worked! Refresh the shops list.
                setReviveStatus('idle');
                onSyncShops();
            } else {
                // Step 2: Check if the error is due to expired refresh token
                const isRefreshTokenExpired =
                    data.error?.includes('REFRESH_TOKEN_EXPIRED') ||
                    data.error?.includes('Authorization has expired') ||
                    data.error?.includes('expired') ||
                    data.code === 105002 ||
                    data.tokenExpired === true;

                if (isRefreshTokenExpired) {
                    console.log('[Revive] Refresh token expired, initiating re-authorization...');
                    // Automatically fallback to full re-auth
                    await handleReauthorize(shop.account_id);
                } else {
                    console.error('[Revive] Sync failed with unexpected error:', data.error);
                    setReviveStatus('idle');
                }
            }
        } catch (err) {
            console.error('Error refreshing token:', err);
            setReviveStatus('idle');
        } finally {
            setRefreshingShopId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-gray-800 rounded-xl p-6 h-48 animate-pulse">
                        <div className="h-6 bg-gray-700 rounded w-3/4 mb-4"></div>
                        <div className="h-4 bg-gray-700 rounded w-1/2 mb-2"></div>
                        <div className="h-4 bg-gray-700 rounded w-1/3"></div>
                    </div>
                ))}
            </div>
        );
    }

    const isPlatformExplorer =
        showPlatformShopExplorer && adminAccounts && adminAccounts.length > 0;

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">
                    {isPlatformExplorer ? 'All platform shops (internal admin)' : 'Shops you can access'}
                </h2>
                <div className="flex space-x-3">
                    <button
                        onClick={onSyncShops}
                        disabled={isSyncing}
                        className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RefreshCw size={20} className={isSyncing ? "animate-spin" : ""} />
                        <span>{isSyncing ? 'Syncing...' : 'Sync Shops'}</span>
                    </button>
                    <button
                        onClick={onAddShop}
                        className="flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
                    >
                        <Plus size={20} />
                        <span>Add Shop</span>
                    </button>
                    {onAddAgency && (
                        <button
                            onClick={onAddAgency}
                            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                        >
                            <Plus size={20} />
                            <span>Add Agency</span>
                        </button>
                    )}
                </div>
            </div>

            {isPlatformExplorer ? (
                <div className="space-y-12">
                    {adminAccounts.filter(a => a.stores.length > 0).map((account) => (
                        <div key={account.id} className="space-y-6">
                            <div className="flex items-center gap-3 border-b border-gray-700 pb-4">
                                <div className="p-2 bg-pink-500/10 rounded-lg">
                                    <User className="w-5 h-5 text-pink-500" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-bold text-white">{account.account_name}</h3>
                                        {(account as any).owner_role && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-pink-500/20 text-pink-400 border border-pink-500/30">
                                                {(account as any).owner_role.toUpperCase()}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-500">{account.stores.length} connected shops</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {account.stores.map((shop) => (
                                    <ShopCard
                                        key={shop.shop_id}
                                        shop={{ ...shop, account_id: account.id }}
                                        isDeleting={deletingShopId === shop.shop_id}
                                        isRefreshing={refreshingShopId === shop.shop_id}
                                        reviveStatus={refreshingShopId === shop.shop_id ? reviveStatus : 'idle'}
                                        isAdminView={true}
                                        isOwnShop={account.owner_id === currentUserId}
                                        disconnectingShopName={disconnectPrompt?.shopName === shop.shop_name ? disconnectPrompt.shopName : null}
                                        onDismissDisconnect={onDismissDisconnect}
                                        onSelect={() => onSelectShop(shop, account)}
                                        onRefreshToken={() => handleRefreshToken({ ...shop, account_id: account.id })}
                                        onDelete={() => onDeleteShop({ ...shop, account_id: account.id })}
                                    />

                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {shops.map((shop) => (
                        <ShopCard
                            key={shop.shop_id}
                            shop={shop}
                            isDeleting={deletingShopId === shop.shop_id}
                            isRefreshing={refreshingShopId === shop.shop_id}
                            reviveStatus={refreshingShopId === shop.shop_id ? reviveStatus : 'idle'}
                            disconnectingShopName={disconnectPrompt?.shopName === shop.shop_name ? disconnectPrompt.shopName : null}
                            onDismissDisconnect={onDismissDisconnect}
                            onSelect={() => onSelectShop(shop)}
                            onRefreshToken={() => handleRefreshToken(shop)}
                            onDelete={() => onDeleteShop(shop)}
                        />
                    ))}

                    {/* Add Shop Card (always visible at the end for regular users) */}
                    <button
                        onClick={onAddShop}
                        className="flex flex-col items-center justify-center h-full min-h-[200px] bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 hover:border-pink-500 hover:bg-gray-800 transition-all group"
                    >
                        <div className="p-4 bg-gray-700 rounded-full mb-4 group-hover:bg-pink-600 group-hover:text-white transition-colors">
                            <Plus size={32} />
                        </div>
                        <span className="text-lg font-medium text-gray-300 group-hover:text-white">Connect New Shop</span>
                    </button>
                </div>
            )}
        </div>
    );
}
