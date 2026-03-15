"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export interface SupabaseSessionResult {
  session:  Session | null;
  /** True while the initial session check is in flight. */
  loading:  boolean;
  /** Convenience: access token for `Authorization: Bearer` headers. */
  accessToken: string | null;
  /** Sign out the current user. */
  signOut: () => Promise<void>;
}

// Computed once at module load — safe to use as initial state value.
const isSupabaseConfigured = !!(  
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/** Remove all Scout-related sessionStorage entries so cached crawl / audit
 *  data from one account never bleeds into another. */
function clearScoutCache() {
  try {
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith("scout_"));
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* SSR or quota — ignore */ }
}

/**
 * Returns the current Supabase session and re-renders whenever it changes.
 * Safe to call on any page — returns null when Supabase is not configured or
 * the user is not logged in.
 */
export function useSupabaseSession(): SupabaseSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  // Start loading=false immediately when Supabase is not configured so we
  // never need a synchronous setState inside the effect body.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const supabase = createClient();

    // Initial session load
    supabase.auth.getSession().then((res) => {
      const s = res.data.session;
      prevUserIdRef.current = s?.user.id ?? null;
      setSession(s);
      setLoading(false);
    });

    // Subscribe to future auth state changes (login, logout, token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      const newUserId = s?.user.id ?? null;
      // Clear cached crawl/audit data when user changes or signs out
      if (newUserId !== prevUserIdRef.current) {
        clearScoutCache();
      }
      prevUserIdRef.current = newUserId;
      setSession(s);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearScoutCache();
    setSession(null);
  };

  return {
    session,
    loading,
    accessToken: session?.access_token ?? null,
    signOut,
  };
}
