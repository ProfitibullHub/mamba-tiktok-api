import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { OverlayLoader } from './OverlayLoader';
import { SyncProgressBar } from './SyncProgressBar';
import { OverviewView } from './views/OverviewView';
import { ProfitLossView } from './views/ProfitLossView';
import { OrdersView } from './views/OrdersView';
import { ProductsView } from './views/ProductsView';
import { FinanceDebugView } from './views/FinanceDebugView';
import { AdminDashboard } from './views/AdminDashboard';
import { AdminUserManagement } from './views/AdminUserManagement';
import { AdminStoreManagement } from './views/AdminStoreManagement';
import { ProfileView } from './views/ProfileView';
import WelcomeScreen from './WelcomeScreen';
import { ShopList } from './ShopList';
import { Account, supabase } from '../lib/supabase';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useShopStore } from '../store/useShopStore';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export function Dashboard() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(profile?.role === 'admin' ? 'admin-dashboard' : 'overview');
  // We still keep selectedAccount state to allow switching if we ever re-enable it, 
  // but we'll default it to the first account from the query.
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);

  // Shop List State
  const [selectedShop, setSelectedShop] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list');
  const [isSyncing, setIsSyncing] = useState(false);
  const [deletingShopId, setDeletingShopId] = useState<string | null>(null);
  const isShopLoading = useShopStore(state => state.isLoading);
  const cacheMetadata = useShopStore(state => state.cacheMetadata);

  // --- Queries ---

  // 1. Fetch Accounts
  const {
    data: accounts = [],
    isLoading: isLoadingAccounts,
    isFetched: isAccountsFetched
  } = useQuery({
    queryKey: ['accounts', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data: userAccounts, error } = await supabase
        .from('user_accounts')
        .select('account_id, accounts(*)')
        .eq('user_id', user.id);

      if (error) throw error;

      return userAccounts
        ?.map((ua: any) => ua.accounts)
        .filter((acc: Account) => acc.status === 'active') || [];
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Sync selectedAccount with fetched accounts
  useEffect(() => {
    if (isAccountsFetched && viewMode === 'list') {
      if (accounts.length > 0) {
        // If we don't have a selected account, or the selected one is not in the list anymore
        if (!selectedAccount || !accounts.find(a => a.id === selectedAccount.id)) {
          setSelectedAccount(accounts[0]);
        }
      } else {
        setSelectedAccount(null);
      }
    }
  }, [accounts, isAccountsFetched, selectedAccount, viewMode]);



  // 2. Fetch Shops
  const {
    data: shops = [],
    isLoading: isLoadingShops,
    isFetched: isShopsFetched
  } = useQuery({
    queryKey: ['shops', selectedAccount?.id],
    queryFn: async () => {
      if (!selectedAccount?.id) return [];
      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/shops/${selectedAccount.id}`);
      const data = await response.json();
      if (data.success) {
        return data.data;
      }
      return [];
    },
    enabled: !!selectedAccount?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // 3. Fetch Admin Stores (if admin)
  const {
    data: adminAccounts = [],
    isLoading: isLoadingAdminStores,
  } = useQuery({
    queryKey: ['admin-stores-grouped'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch(`${API_BASE_URL}/api/admin/stores`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      return data.success ? data.data : [];
    },
    enabled: profile?.role === 'admin',
    staleTime: 1000 * 60 * 5,
  });

  const [hasSkippedWelcome, setHasSkippedWelcome] = useState(false);

  // Handle Shop Selection & Welcome Screen logic
  useEffect(() => {
    if (isShopsFetched || (profile?.role === 'admin' && adminAccounts.length > 0)) {
      const hasShops = shops.length > 0 || (profile?.role === 'admin' && adminAccounts.some((acc: any) => acc.stores.length > 0));

      if (hasShops) {
        setShowWelcome(false);
        setHasSkippedWelcome(false); // Reset skip state when shops are found
        // Auto-select if only one shop and we haven't selected one yet (or just connected)
        // Or if we are in a state where we should be viewing details
        if (shops.length === 1 && !selectedShop && !selectedAccount) {
          setSelectedShop(shops[0]);
          setViewMode('details');
        }
      } else {
        // No shops found anywhere (for admin) or for current user (for client)
        setShowWelcome(true);
      }
    } else if (!isLoadingAccounts && !isLoadingShops && !selectedAccount && accounts.length === 0 && profile?.role !== 'admin') {
      // No account, show welcome (only for non-admins)
      setShowWelcome(true);
    }
  }, [shops, isShopsFetched, selectedAccount, isLoadingAccounts, isLoadingShops, adminAccounts, profile?.role]);

  // 4. Realtime Profile Updates for selectedAccount owner
  useEffect(() => {
    const ownerId = (selectedAccount as any)?.owner_id;
    if (!ownerId) return;

    console.log('[Dashboard] Setting up realtime subscription for owner:', ownerId);

    const channel = supabase
      .channel(`owner-profile-${ownerId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${ownerId}`
        },
        (payload) => {
          console.log('[Dashboard] Owner profile updated:', payload.new);
          setSelectedAccount(prev => {
            if (!prev) return null;
            return {
              ...prev,
              owner_role: payload.new.role,
              tiktok_handle: payload.new.full_name || prev.tiktok_handle // Update name too if it changed
            };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [(selectedAccount as any)?.owner_id]);

  // Prefetch Admin Data on Mount
  useEffect(() => {
    if (profile?.role === 'admin') {
      console.log('[Dashboard] Admin detected, prefetching admin data...');

      const prefetchAdminData = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        const headers = { 'Authorization': `Bearer ${token}` };

        // Prefetch Stats
        queryClient.prefetchQuery({
          queryKey: ['admin-stats'],
          queryFn: async () => {
            const res = await fetch(`${API_BASE_URL}/api/admin/stats`, { headers });
            const data = await res.json();
            return data.success ? data.data : null;
          }
        });

        // Prefetch Users
        queryClient.prefetchQuery({
          queryKey: ['admin-users'],
          queryFn: async () => {
            const res = await fetch(`${API_BASE_URL}/api/admin/users`, { headers });
            const data = await res.json();
            return data.success ? data.data : null;
          }
        });

        // Prefetch Stores
        queryClient.prefetchQuery({
          queryKey: ['admin-stores'],
          queryFn: async () => {
            const res = await fetch(`${API_BASE_URL}/api/admin/stores`, { headers });
            const data = await res.json();
            return data.success ? data.data : null;
          }
        });
      };

      prefetchAdminData();
    }
  }, [profile?.role, queryClient]);


  // --- Actions ---

  const ensureAccountExists = async (): Promise<Account> => {
    if (selectedAccount) return selectedAccount;

    try {
      if (!user?.id) throw new Error('User not authenticated');

      // 1. Ensure Profile Exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (!existingProfile) {
        console.log('Profile missing, creating new profile for user:', user.id);
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
            role: 'client',
            updated_at: new Date().toISOString(),
          });

        if (profileError) {
          console.error('Error creating profile:', profileError);
          // Continue anyway, maybe it exists but we couldn't read it? 
          // But if insert fails, likely next step fails too.
          throw profileError;
        }
      }

      // 2. Create the account
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .insert({
          name: 'My Shop',
          status: 'active',
        })
        .select()
        .single();

      if (accountError) throw accountError;

      // 3. Link account to user
      const { error: linkError } = await supabase
        .from('user_accounts')
        .insert({
          user_id: user.id,
          account_id: account.id,
        });

      if (linkError) throw linkError;

      // Invalidate accounts query to refresh the list and trigger the useEffect to set selectedAccount
      await queryClient.invalidateQueries({ queryKey: ['accounts', user.id] });

      // We return the account directly here because invalidation is async and we need it now
      setSelectedAccount(account);
      return account;
    } catch (error: any) {
      console.error('Error ensuring account exists:', error);
      throw new Error('Failed to create account record: ' + error.message);
    }
  };

  const handleConnectShop = async () => {
    try {
      const account = await ensureAccountExists();

      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/auth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id,
          accountName: account.name
        }),
      });

      const data = await response.json();

      if (data.authUrl || data.url) {
        window.location.href = data.authUrl || data.url;
      } else {
        alert(`Failed to start authorization. Response: ${JSON.stringify(data)}`);
      }
    } catch (error: any) {
      console.error('Error starting auth:', error);
      alert(`Failed to start authorization: ${error.message}`);
    }
  };

  const handleConnectAgency = async () => {
    try {
      const account = await ensureAccountExists();

      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/auth/partner/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id,
          accountName: account.name
        }),
      });

      const data = await response.json();

      if (data.authUrl || data.url) {
        window.location.href = data.authUrl || data.url;
      } else {
        alert(`Failed to start agency authorization. Response: ${JSON.stringify(data)}`);
      }
    } catch (error: any) {
      console.error('Error starting agency auth:', error);
      alert(`Failed to start agency authorization: ${error.message}`);
    }
  };

  const finalizeAuth = async (code: string, accountId: string) => {
    try {
      window.history.replaceState({}, '', window.location.pathname);
      // We can show a loading state if we want, but React Query's isFetching might be enough if we invalidate

      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/auth/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, accountId }),
      });

      const data = await response.json();

      if (data.success) {
        await queryClient.invalidateQueries({ queryKey: ['shops', accountId] });
        alert('TikTok Shop connected successfully!');
      } else {
        throw new Error(data.error || 'Failed to finalize connection');
      }
    } catch (error: any) {
      console.error('Error finalizing auth:', error);
      alert(`Failed to connect TikTok Shop: ${error.message}`);
    }
  };

  const handleDeleteShop = async (shop: any) => {
    if (!selectedAccount || !shop) return;

    if (!confirm(`Are you sure you want to delete ${shop.shop_name}? This will remove all data associated with this shop.`)) {
      return;
    }

    try {
      setDeletingShopId(shop.shop_id);
      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/auth/disconnect/${selectedAccount.id}/${shop.shop_id}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        await queryClient.invalidateQueries({ queryKey: ['shops', selectedAccount.id] });
        if (profile?.role === 'admin') {
          await queryClient.invalidateQueries({ queryKey: ['admin-stores-grouped'] });
        }
        // If the deleted shop was selected, deselect it
        if (selectedShop?.shop_id === shop.shop_id) {
          setSelectedShop(null);
          setViewMode('list');
        }
      } else {
        throw new Error(data.error || 'Failed to delete shop');
      }
    } catch (error: any) {
      console.error('Error deleting shop:', error);
      alert(`Failed to delete shop: ${error.message}`);
    } finally {
      setDeletingShopId(null);
    }
  };

  const handleSyncShops = async () => {
    if (!selectedAccount) return;

    try {
      setIsSyncing(true);
      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/shops/${selectedAccount.id}?refresh=true`);
      const data = await response.json();

      if (data.success) {
        await queryClient.invalidateQueries({ queryKey: ['shops', selectedAccount.id] });
        // alert('Shops synced successfully!'); // Optional: show success message
      } else {
        throw new Error(data.error || 'Failed to sync shops');
      }
    } catch (error: any) {
      console.error('Error syncing shops:', error);
      alert(`Failed to sync shops: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle TikTok Auth Redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tiktokConnected = params.get('tiktok_connected');
    const tiktokError = params.get('tiktok_error');
    const accountId = params.get('account_id');
    const tiktokCode = params.get('tiktok_code');
    const action = params.get('action');

    if (tiktokConnected === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['shops', accountId] });
      }
    } else if (tiktokError) {
      window.history.replaceState({}, '', window.location.pathname);
      alert(`TikTok Connection Error: ${decodeURIComponent(tiktokError)}`);
    } else if (tiktokCode && action === 'finalize_auth') {
      // If we have a code, we try to finalize. 
      // We need an accountId. If selectedAccount is not yet loaded, we might have an issue.
      // But usually this happens after redirect, so we should have the account loaded or loading.
      if (selectedAccount) {
        finalizeAuth(tiktokCode, selectedAccount.id);
      } else if (accountId) {
        // Fallback if selectedAccount isn't set but we have param
        finalizeAuth(tiktokCode, accountId);
      }
    }
  }, [selectedAccount, queryClient]); // Added queryClient to deps


  // --- Render ---

  // Initial loading state
  if (isLoadingAccounts && !accounts.length) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
      </div>
    );
  }

  // Full screen Welcome if no account or no shops (and not loading)
  // We check !isLoadingShops to avoid flashing welcome screen while fetching shops
  const isUserAdmin = profile?.role === 'admin';
  const hasPlatformShops = isUserAdmin && adminAccounts.some((acc: any) => acc.stores.length > 0);

  // Admins should NOT see the welcome screen if they have platform shops or if they are still loading admin stores
  const needsWelcome = !hasSkippedWelcome &&
    !hasPlatformShops &&
    ((!selectedAccount && accounts.length === 0 && !isLoadingAccounts && !isUserAdmin) ||
      (showWelcome && !isLoadingShops && (!isUserAdmin || !isLoadingAdminStores)));

  if (needsWelcome) {
    return (
      <WelcomeScreen
        onConnect={handleConnectShop}
        onConnectAgency={handleConnectAgency}
        onSkip={() => {
          setHasSkippedWelcome(true);
          setViewMode('details');
        }}
        isConnecting={false}
      />
    );
  }

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Only show sidebar in details mode */}
      {viewMode === 'details' && (
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="mb-6 flex justify-between items-center">
            <div className="flex items-center space-x-4">
              {viewMode === 'details' && (
                <button
                  onClick={() => {
                    setViewMode('list');
                    setSelectedShop(null);
                  }}
                  disabled={cacheMetadata.isSyncing}
                  className={`p-2 rounded-full transition-colors ${cacheMetadata.isSyncing
                    ? 'opacity-50 cursor-not-allowed text-gray-600'
                    : 'hover:bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  title={cacheMetadata.isSyncing ? "Syncing in progress..." : "Back to shop list"}
                >
                  <ArrowLeft size={24} />
                </button>
              )}
            </div>

            {viewMode === 'details' && selectedShop && (
              <div className="text-gray-400 text-sm">
                Viewing: <span className="text-white font-medium">{selectedShop.shop_name}</span>
              </div>
            )}
          </div>

          <OverlayLoader
            isLoading={(!selectedAccount && accounts.length > 0) || (viewMode === 'list' ? (isLoadingShops || (profile?.role === 'admin' && isLoadingAdminStores)) : isShopLoading)}
            message={viewMode === 'list' ? "Loading shops..." : "Loading shop data..."}
          >
            {viewMode === 'list' ? (
              <ShopList
                shops={shops}
                adminAccounts={adminAccounts}
                currentUserId={user?.id}
                deletingShopId={deletingShopId}
                onSelectShop={(shop: any, accountContext?: any) => {
                  const targetAccountId = accountContext?.id || selectedAccount?.id;

                  if (accountContext) {
                    // If we have account context (admin mode), update selectedAccount
                    // This allows the details views to fetch data for the correct account
                    setSelectedAccount({
                      id: accountContext.id,
                      name: accountContext.original_name || accountContext.account_name,
                      status: 'active',
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                      tiktok_handle: accountContext.owner_full_name || '',
                      owner_id: accountContext.owner_id, // Adding this for realtime
                      owner_role: accountContext.owner_role // Adding this for the header
                    } as any);
                  }

                  setSelectedShop(shop);
                  setViewMode('details');

                  // Load cached data first, then auto-sync if stale
                  if (targetAccountId && shop.shop_id) {
                    console.log('[Dashboard] Loading shop data for:', shop.shop_name, 'Account:', targetAccountId);
                    useShopStore.getState().fetchShopData(
                      targetAccountId,
                      shop.shop_id,
                      { showCached: true, forceRefresh: false }
                    );
                  }
                }}
                onAddShop={handleConnectShop}
                onAddAgency={handleConnectAgency}
                onSyncShops={handleSyncShops}
                onDeleteShop={handleDeleteShop}
                isLoading={false} // Handled by OverlayLoader
                isSyncing={isSyncing}
              />
            ) : (
              // Details Views
              (() => {
                switch (activeTab) {
                  case 'overview': return selectedAccount ? <OverviewView account={selectedAccount} shopId={selectedShop?.shop_id} onNavigate={setActiveTab} /> : null;
                  case 'orders': return selectedAccount ? <OrdersView account={selectedAccount} shopId={selectedShop?.shop_id} /> : null;
                  case 'products': return selectedAccount ? <ProductsView account={selectedAccount} shopId={selectedShop?.shop_id} /> : null;
                  case 'profit-loss': return selectedAccount ? <ProfitLossView account={selectedAccount} shopId={selectedShop?.shop_id} /> : null;
                  case 'finance-debug': return selectedAccount ? <FinanceDebugView account={selectedAccount} shopId={selectedShop?.shop_id} /> : null;
                  case 'profile': return <ProfileView />;
                  case 'admin-dashboard': return <AdminDashboard />;
                  case 'admin-users': return <AdminUserManagement />;
                  case 'admin-stores': return <AdminStoreManagement />;
                  default: return selectedAccount ? <OverviewView account={selectedAccount} shopId={selectedShop?.shop_id} /> : null;
                }
              })()
            )}
          </OverlayLoader>

          {/* Sync Progress Bar */}
          <SyncProgressBar />
        </div>
      </main>
    </div>
  );
}
