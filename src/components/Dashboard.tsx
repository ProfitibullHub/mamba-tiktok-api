import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { OverviewView } from './views/OverviewView';
import { ProfitLossView } from './views/ProfitLossView';
import { OrdersView } from './views/OrdersView';
import { ProductsView } from './views/ProductsView';
import WelcomeScreen from './WelcomeScreen';
import { ShopList } from './ShopList';
import { Account, supabase } from '../lib/supabase';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useShopStore } from '../store/useShopStore';

const API_BASE_URL = 'http://localhost:3001';

export function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');


  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);


  const [selectedShop, setSelectedShop] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list');
  const [isSyncing, setIsSyncing] = useState(false);




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
    staleTime: 1000 * 60 * 5,
  });


  useEffect(() => {
    if (isAccountsFetched) {
      if (accounts.length > 0) {

        if (!selectedAccount || !accounts.find(a => a.id === selectedAccount.id)) {
          setSelectedAccount(accounts[0]);
        }
      } else {
        setSelectedAccount(null);
      }
    }
  }, [accounts, isAccountsFetched, selectedAccount]);



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
    staleTime: 1000 * 60 * 5,
  });


  useEffect(() => {
    if (isShopsFetched) {
      if (shops.length > 0) {
        setShowWelcome(false);


        if (shops.length === 1 && !selectedShop) {
          setSelectedShop(shops[0]);
          setViewMode('details');
        }
      } else {

        setShowWelcome(true);
      }
    } else if (!isLoadingAccounts && !isLoadingShops && !selectedAccount) {

      setShowWelcome(true);
    }
  }, [shops, isShopsFetched, selectedAccount, isLoadingAccounts, isLoadingShops]);


  useEffect(() => {
    if (selectedAccount?.id && selectedShop?.shop_id) {
      console.log('[Dashboard] Fetching shop data for:', selectedShop.shop_name);
      useShopStore.getState().fetchShopData(selectedAccount.id, selectedShop.shop_id);
    }
  }, [selectedAccount?.id, selectedShop?.shop_id]);




  const ensureAccountExists = async (): Promise<Account> => {
    if (selectedAccount) return selectedAccount;

    try {
      if (!user?.id) throw new Error('User not authenticated');


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


          throw profileError;
        }
      }


      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .insert({
          name: 'My Shop',
          status: 'active',
        })
        .select()
        .single();

      if (accountError) throw accountError;


      const { error: linkError } = await supabase
        .from('user_accounts')
        .insert({
          user_id: user.id,
          account_id: account.id,
        });

      if (linkError) throw linkError;


      await queryClient.invalidateQueries({ queryKey: ['accounts', user.id] });


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

      setShowWelcome(false);
      setIsSyncing(true);

      await new Promise(resolve => setTimeout(resolve, 2000));

      const ShopData = {
        shop_id: ' _shop_' + Date.now(),
        shop_name: 'My   TikTok Shop',
        region: 'US',
        seller_type: 'seller'
      };

      const { error } = await supabase
        .from('tiktok_shops')
        .insert({
          account_id: account.id,
          shop_id: ShopData.shop_id,
          shop_cipher: ' _cipher_' + Date.now(),
          shop_name: ShopData.shop_name,
          region: ShopData.region,
          seller_type: ShopData.seller_type,
          access_token: ' _token',
          refresh_token: ' _refresh_token',
          token_expires_at: new Date(Date.now() + 86400000).toISOString(),
          refresh_token_expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        console.error('Error inserting    shop:', error);
        throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ['shops', account.id] });

      setIsSyncing(false);

    } catch (error: any) {
      console.error('Error in mock connection:', error);
      setIsSyncing(false);
      alert(`Failed to connect: ${error.message}`);
    }
  };

  const handleConnectAgency = async () => {
    try {
      const account = await ensureAccountExists();

      setShowWelcome(false);
      setIsSyncing(true);

      await new Promise(resolve => setTimeout(resolve, 2500));

      const ShopData = {
        shop_id: 'agency_shop_' + Date.now(),
        shop_name: 'My Agency Partner Shop',
        region: 'US',
        seller_type: 'partner'
      };

      const { error } = await supabase
        .from('tiktok_shops')
        .insert({
          account_id: account.id,
          shop_id: ShopData.shop_id,
          shop_cipher: 'agency_cipher_' + Date.now(),
          shop_name: ShopData.shop_name,
          region: ShopData.region,
          seller_type: ShopData.seller_type,
          access_token: 'agency_ _token',
          refresh_token: 'agency_ _refresh_token',
          token_expires_at: new Date(Date.now() + 86400000).toISOString(),
          refresh_token_expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        console.error('Error inserting agency shop:', error);
        throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ['shops', account.id] });

      setIsSyncing(false);

    } catch (error: any) {
      console.error('Error in agency mock connection:', error);
      setIsSyncing(false);
      alert(`Failed to connect agency: ${error.message}`);
    }
  };

  const finalizeAuth = async (code: string, accountId: string) => {
    try {
      window.history.replaceState({}, '', window.location.pathname);


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
      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/auth/disconnect/${selectedAccount.id}/${shop.shop_id}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        await queryClient.invalidateQueries({ queryKey: ['shops', selectedAccount.id] });

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



      if (selectedAccount) {
        finalizeAuth(tiktokCode, selectedAccount.id);
      } else if (accountId) {

        finalizeAuth(tiktokCode, accountId);
      }
    }
  }, [selectedAccount, queryClient]);





  if (isLoadingAccounts && !accounts.length) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
      </div>
    );
  }



  if ((!selectedAccount && !isLoadingAccounts) || (showWelcome && !isLoadingShops)) {
    return (
      <WelcomeScreen
        onConnect={handleConnectShop}
        onConnectAgency={handleConnectAgency}
        isConnecting={false}
      />
    );
  }

  return (
    <div className="flex h-screen bg-gray-900">
      { }
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
                  className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
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

          {isLoadingShops ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
            </div>
          ) : viewMode === 'list' ? (
            <ShopList
              shops={shops}
              onSelectShop={(shop) => {
                setSelectedShop(shop);
                setViewMode('details');
              }}
              onAddShop={handleConnectShop}
              onAddAgency={handleConnectAgency}
              onSyncShops={handleSyncShops}
              onDeleteShop={handleDeleteShop}
              isLoading={isLoadingShops}
              isSyncing={isSyncing}
            />
          ) : (

            (() => {
              if (!selectedAccount) return null;
              switch (activeTab) {
                case 'overview': return <OverviewView account={selectedAccount} shopId={selectedShop?.shop_id} onNavigate={setActiveTab} />;
                case 'orders': return <OrdersView />;
                case 'products': return <ProductsView account={selectedAccount} shopId={selectedShop?.shop_id} />;
                case 'profit-loss': return <ProfitLossView shopId={selectedShop?.shop_id} />;
                default: return <OverviewView account={selectedAccount} shopId={selectedShop?.shop_id} />;
              }
            })()
          )}
        </div>
      </main>
    </div>
  );
}
