"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_URL } from "@/lib/apps";
import { useAuth } from "./auth-context";
import { useLanguage } from "./language-context";
import type { TranslationKey } from "./i18n";
import { PAGE_OPTIONS, GROUP_LABELS, PageGroup, hasPermission } from "./permissions";

const GROUPS: PageGroup[] = ["entry", "outstanding", "books", "setup"];

export default function Nav() {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (pathname === "/login" || !profile) return null;

  const visible = PAGE_OPTIONS.filter((p) => hasPermission(profile, p.key));

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 sm:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`fixed top-0 left-0 h-screen z-50 sm:z-30 w-56 bg-white border-r border-slate-200 flex flex-col py-3 overflow-y-auto transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"
        }`}
      >
        <div className="px-4 pb-3 flex items-center gap-2">
          <span className="text-2xl">💰</span>
          <span className="font-semibold">{t("dept_finance")}</span>
        </div>

        {GROUPS.map((g) => {
          const pages = visible.filter((p) => p.group === g);
          if (pages.length === 0) return null;
          return (
            <div key={g} className="mb-2">
              <div className="px-4 py-1 text-[10px] uppercase tracking-wide text-slate-400">
                {t(GROUP_LABELS[g] as TranslationKey)}
              </div>
              {pages.map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className={`block px-4 py-2 text-sm ${
                    pathname === p.href
                      ? "bg-blue-50 text-blue-600 font-semibold border-r-2 border-blue-600"
                      : "text-slate-600"
                  }`}
                >
                  {t(p.labelKey as TranslationKey)}
                </Link>
              ))}
            </div>
          );
        })}
      </aside>

      <div className="sm:ml-56">
        <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
          <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button className="sm:hidden text-xl leading-none shrink-0" onClick={() => setMobileOpen(true)}>
                ☰
              </button>
              <h1 className="font-semibold text-base sm:text-lg truncate">{t("dept_finance")}</h1>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <a href={`${APP_URL.report}/dashboard`} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs sm:text-sm bg-white text-slate-600 hover:bg-slate-50 whitespace-nowrap">📋 Daily Report</a>

              <div className="hidden sm:flex border border-slate-200 rounded-lg overflow-hidden text-xs">
                <button
                  onClick={() => setLang("my")}
                  className={`px-2 py-1.5 ${lang === "my" ? "bg-blue-600 text-white" : "bg-white text-slate-500"}`}
                >
                  မြန်မာ
                </button>
                <button
                  onClick={() => setLang("en")}
                  className={`px-2 py-1.5 ${lang === "en" ? "bg-blue-600 text-white" : "bg-white text-slate-500"}`}
                >
                  EN
                </button>
              </div>

              <span className="text-xs text-slate-400 hidden md:inline">
                {profile.email} · {t(`fin_role_${profile.role}` as TranslationKey)}
              </span>
              <button
                onClick={signOut}
                className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2 py-1.5"
              >
                {t("logout")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
