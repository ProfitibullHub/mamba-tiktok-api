import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { supabase, Profile } from '../lib/supabase';
import { queryClient } from '../queryClient';
import { useShopStore } from '../store/useShopStore';
import { fetchOrCreateProfile, profileQueryKey } from '../lib/profileApi';
import { clearStaleAuthSession, isRevokedSessionPostgrestError } from '../lib/sessionErrors';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Supabase holds an internal auth lock while onAuthStateChange runs.
 * Never await supabase.auth.* inside that callback — it deadlocks and authReady never flips.
 */
function deferAuthWork(fn: () => void | Promise<void>) {
  setTimeout(() => {
    void fn();
  }, 0);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const applySessionOptimistic = (session: Session | null) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setAuthReady(true);
    };

    const validateSessionInBackground = (session: Session | null) => {
      if (!session) return;
      deferAuthWork(async () => {
        const { data, error } = await supabase.auth.getUser();
        if (!mounted) return;
        if (error || !data.user) {
          await clearStaleAuthSession();
          if (mounted) setUser(null);
          return;
        }
        if (mounted) setUser(data.user);
      });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        queryClient.clear();
        useShopStore.getState().clearData();
        setAuthReady(true);
        return;
      }

      applySessionOptimistic(session);
      validateSessionInBackground(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const profileQuery = useQuery({
    queryKey: user?.id ? profileQueryKey(user.id) : ['profile', 'none'],
    queryFn: () => fetchOrCreateProfile(user!.id),
    enabled: Boolean(user?.id && authReady),
    staleTime: 1000 * 60 * 5,
    retry: (failureCount, error) => {
      if (isRevokedSessionPostgrestError(error)) return false;
      return failureCount < 2;
    },
  });

  useEffect(() => {
    if (profileQuery.error && isRevokedSessionPostgrestError(profileQuery.error)) {
      void clearStaleAuthSession();
    }
  }, [profileQuery.error]);

  const profile = profileQuery.data ?? null;
  const loading =
    !authReady ||
    (Boolean(user?.id) && profileQuery.isPending && !profileQuery.isError);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        console.error('Error signing out from Supabase:', error);
      }
    } catch (error) {
      console.error('Unexpected error during sign out:', error);
    } finally {
      queryClient.clear();
      useShopStore.getState().clearData();
      setUser(null);
      setAuthReady(true);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
