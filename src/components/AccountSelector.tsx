import { useState, useEffect } from 'react';
import { ChevronDown, Store, CheckCircle2 } from 'lucide-react';
import { Account, supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTenantContext } from '../contexts/TenantContext';
import { AddAccountModal } from './AddAccountModal';

interface AccountSelectorProps {
  selectedAccount: Account | null;
  onSelectAccount: (account: Account) => void;
}

export function AccountSelector({ selectedAccount, onSelectAccount }: AccountSelectorProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const { profile } = useAuth();
  const { isPlatformSuperAdmin } = useTenantContext();

  useEffect(() => {
    fetchAccounts();
  }, [profile]);

  const fetchAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('status', 'active')
        .order('is_agency_view', { ascending: false, nullsFirst: false })
        .order('name');

      if (error) throw error;
      const list = (data || []) as Account[];
      setAccounts(list);

      if (list.length > 0 && !selectedAccount) {
        const mambaAccount = isPlatformSuperAdmin ? list.find((acc) => acc.is_agency_view) : undefined;
        onSelectAccount(mambaAccount || list[0]);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 text-center">
        <p className="text-gray-400 mb-4">No accounts yet. Create one to get started!</p>
        <AddAccountModal onAccountAdded={fetchAccounts} />
      </div>
    );
  }

  if (accounts.length === 1 && !isPlatformSuperAdmin) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-r from-pink-500 to-red-500 p-2 rounded-lg">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Current Account</p>
            <p className="text-lg font-bold text-white">{accounts[0].name}</p>
            <p className="text-sm text-pink-400">{accounts[0].tiktok_handle}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-pink-500/50 transition-all"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-r from-pink-500 to-red-500 p-2 rounded-lg">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div className="text-left">
              <p className="text-sm text-gray-400">
                {isPlatformSuperAdmin ? 'Viewing Account' : 'Current Account'}
              </p>
              <p className="text-lg font-bold text-white">{selectedAccount?.name || 'Select Account'}</p>
              {selectedAccount && (
                <p className="text-sm text-pink-400">{selectedAccount.tiktok_handle}</p>
              )}
            </div>
          </div>
          <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-20 max-h-96 overflow-y-auto">
            {accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => {
                  onSelectAccount(account);
                  setIsOpen(false);
                }}
                className="w-full p-4 flex items-center justify-between hover:bg-gray-700 transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-gray-700 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedAccount?.id === account.id
                      ? 'bg-gradient-to-r from-pink-500 to-red-500'
                      : 'bg-gray-700'
                    }`}>
                    <Store className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-white">{account.name}</p>
                    <p className="text-sm text-gray-400">{account.tiktok_handle}</p>
                  </div>
                </div>
                {selectedAccount?.id === account.id && (
                  <CheckCircle2 className="w-5 h-5 text-pink-400" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
