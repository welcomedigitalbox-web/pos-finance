"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-context";
import { useLanguage } from "./language-context";
import { hasAnyFinanceAccess } from "./permissions";

// A POS account can sign in - Supabase Auth is shared - but it has no row in
// fin_users, so it gets a plain message instead of an empty application.
export default function AccessGate({ children }: { children: ReactNode }) {
  const { profile, notFinance, loading, signOut } = useAuth();
  const { t } = useLanguage();
  const pathname = usePathname();

  if (pathname === "/login") return <>{children}</>;
  if (loading) return null;

  const blocked = notFinance || (profile !== null && !hasAnyFinanceAccess(profile));
  if (!blocked) return <>{children}</>;

  return (
    <div className="pt-24 flex flex-col items-center gap-4 text-center">
      <div className="text-4xl">🔒</div>
      <p className="text-sm text-slate-500 max-w-sm">{t("fin_notFinanceAccount")}</p>
      <button
        onClick={signOut}
        className="text-sm border border-slate-200 rounded-lg px-4 py-2 bg-white"
      >
        {t("fin_signOut")}
      </button>
    </div>
  );
}
