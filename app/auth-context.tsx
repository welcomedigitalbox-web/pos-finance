"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { applyRolePages } from "@/app/permissions";
import { supabase } from "@/lib/supabase";
import { usePathname } from "next/navigation";
import { APP_URL } from "@/lib/apps";
import type { Session } from "@supabase/supabase-js";

import type { FinanceRole } from "./permissions";

// A finance account. It shares Supabase Auth with the POS, but the POS
// `profiles` table is never read here: someone who only exists in the POS
// has no row in fin_users and cannot get past the login screen.
export type FinanceUser = {
  id: string;
  email: string;
  name: string | null;
  role: FinanceRole;
  all_stores: boolean;
  permissions: string[];
  is_active: boolean;
};

type AuthContextType = {
  session: Session | null;
  profile: FinanceUser | null;
  stores: string[];          // branch ids this account may work in
  loading: boolean;
  /** signed in to Supabase, but not a finance account */
  notFinance: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<FinanceUser | null>(null);
  const [stores, setStores] = useState<string[]>([]);
  const [notFinance, setNotFinance] = useState(false);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadUser(data.session.user.id);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) loadUser(newSession.user.id);
      else {
        setProfile(null);
        setStores([]);
        setNotFinance(false);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUser(userId: string) {
    const { data } = await supabase
      .from("fin_users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    const user = data as FinanceUser | null;

    if (!user || !user.is_active) {
      setProfile(null);
      setNotFinance(true);
      setLoading(false);
      return;
    }

    const { data: scope } = await supabase
      .from("fin_user_stores")
      .select("store_id")
      .eq("user_id", userId);

    const { data: rp } = await supabase.rpc("my_pages", { p_app: "finance" });
    applyRolePages(((rp as string[]) || []).map(String));
    setProfile(user);
    setStores(((scope as { store_id: string }[]) || []).map((r) => r.store_id));
    setNotFinance(false);
    setLoading(false);
  }

  useEffect(() => {
    // One sign-in covers every app and the POS owns the login screen, so send
    // people there with a note of where they were headed. Whether a finance
    // account exists is a separate question, answered by AccessGate.
    if (!loading && !session && pathname !== "/login") {
      const back = encodeURIComponent(window.location.href);
      window.location.replace(`${APP_URL.pos}/login?next=${back}`);
    }
  }, [loading, session, pathname]);

  async function signOut() {
    // Clears the shared cookie, so this signs the person out of every app at
    // once -- which is what one sign-in ought to mean.
    await supabase.auth.signOut();
    window.location.replace(`${APP_URL.pos}/login`);
  }

  return (
    <AuthContext.Provider value={{ session, profile, stores, loading, notFinance, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
