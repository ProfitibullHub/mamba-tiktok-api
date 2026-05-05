import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, Profile } from '../lib/supabase';
import { queryClient } from '../queryClient';
import { useShopStore } from '../store/useShopStore';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setUser(current => {
        // If the user identity has changed, clear ALL cached query data immediately
        // so the incoming user never sees the outgoing user's shops/memberships/tenants.
        if (current?.id !== newUser?.id) {
          queryClient.clear();
          useShopStore.getState().clearData();
        }
        if (current?.id === newUser?.id && current?.email === newUser?.email) return current;
        return newUser;
      });

      if (newUser) {
        fetchProfile(newUser.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setProfile(prev => {
          if (JSON.stringify(prev) === JSON.stringify(data)) return prev;
          return data;
        });
      } else {
        // Profile missing: create a minimal row only — no seller tenant until Connect shop / agency onboarding.
        console.log('[Auth] Profile missing for user, creating minimal profile:', userId);
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          const email = (authUser.email ?? '').trim();
          if (!email) {
            console.error('[Auth] Cannot create profile: auth user has no email');
          } else {
            const fullName =
              authUser.user_metadata?.full_name?.trim() ||
              email.split('@')[0] ||
              'User';
            const row = {
              id: authUser.id,
              email,
              full_name: fullName,
              role: 'client' as const,
              tenant_id: null as string | null,
              updated_at: new Date().toISOString(),
            };
            const { data: inserted, error: insertError } = await supabase
              .from('profiles')
              .insert(row)
              .select('*')
              .maybeSingle();

            if (insertError?.code === '23505') {
              const { data: existing, error: readErr } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle();
              if (readErr) console.error('[Auth] Profile race: reload failed:', readErr);
              else if (existing) setProfile(existing);
            } else if (insertError) {
              console.error('[Auth] Failed to create minimal profile:', insertError);
            } else if (inserted) {
              setProfile(inserted);
              await queryClient.invalidateQueries({ queryKey: ['profile-tenant', userId] });
              await queryClient.invalidateQueries({ queryKey: ['tenant-memberships', userId] });
              await queryClient.invalidateQueries({ queryKey: ['accounts', userId] });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

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
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out from Supabase:', error);
      }
    } catch (error) {
      console.error('Unexpected error during sign out:', error);
    } finally {
      // Clear the entire React Query cache so the next user starts fresh
      queryClient.clear();
      useShopStore.getState().clearData();
      setUser(null);
      setProfile(null);
      setLoading(false);
      localStorage.removeItem('supabase.auth.token');
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
