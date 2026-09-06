"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtNum, loadAccounts, today, type FinAccount, type LedgerRow } from "@/lib/finance";

function yearStart() {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
}

function GeneralLedgerBody() {
  const { profile } = useAuth();
  const { storeId, stores } = useStore();
  const { t, lang } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();

  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [accountId, setAccountId] = useState(params.get("account") || "");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [scope, setScope] = useState<"all" | "store">("all");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-ledger")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    loadAccounts().then(setAccounts);
  }, []);

  useEffect(() => {
    if (!accountId) {
      setRows([]);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, from, to, scope, storeId]);

  if (!profile || !hasPermission(profile, "fin-ledger")) return null;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("fin_general_ledger", {
      p_account_id: accountId,
      p_from: from || null,
      p_to: to || null,
      p_store: scope === "store" ? storeId || null : null,
    });
    if (error) {
      setToast("❌ " + error.message);
      setTimeout(() => setToast(""), 3500);
    }
    setRows((data as LedgerRow[]) || []);
    setLoading(false);
  }

  const account = accounts.find((a) => a.id === accountId) || null;
  const accName = (a: FinAccount) => (lang === "my" && a.name_my ? a.name_my : a.name);
  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || id : "-");
  const storeLabel = stores.find((s) => s.id === storeId)?.name || storeId;

  const totalDebit = useMemo(() => rows.reduce((s, r) => s + Number(r.debit || 0), 0), [rows]);
  const totalCredit = useMemo(() => rows.reduce((s, r) => s + Number(r.credit || 0), 0), [rows]);
  const opening = Number(account?.opening_balance || 0);
  const closing = rows.length > 0 ? Number(rows[rows.length - 1].running_balance || 0) : opening;

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-4">{t("fin_glTitle")}</h2>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="text-xs text-slate-500">{t("fin_selectAccount")}</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 max-w-[280px]">
            <option value="">-</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_from")}</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_to")}</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_store")}</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "store")}
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1">
            <option value="all">{t("fin_all")}</option>
            <option value="store">{storeLabel}</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_kind")}</th>
              <th className="text-left px-3 py-2">{t("fin_store")}</th>
              <th className="text-left px-3 py-2">{t("fin_memo")}</th>
              <th className="text-left px-3 py-2">{t("fin_party")}</th>
              <th className="text-right px-3 py-2">{t("fin_debit")}</th>
              <th className="text-right px-3 py-2">{t("fin_credit")}</th>
              <th className="text-right px-3 py-2">{t("fin_runningBalance")}</th>
            </tr>
          </thead>
          <tbody>
            {!accountId && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-8">{t("fin_selectAccount")}</td></tr>
            )}
            {accountId && loading && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {accountId && !loading && (
              <>
                <tr className="bg-slate-50/70">
                  <td className="px-3 py-2 text-slate-500" colSpan={8}>{t("fin_openingBalance")}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtNum(opening)}</td>
                </tr>
                {rows.map((r, i) => (
                  <tr key={`${r.journal_id}-${i}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.journal_date}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.journal_no}</td>
                    <td className="px-3 py-2">{r.journal_type}</td>
                    <td className="px-3 py-2 text-slate-500">{storeName(r.store_id)}</td>
                    <td className="px-3 py-2">{r.memo || "-"}</td>
                    <td className="px-3 py-2">{r.party_name || "-"}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(r.debit)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(r.credit)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtNum(r.running_balance)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
                )}
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                  <td className="px-3 py-2" colSpan={6}>{t("fin_total")}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(totalDebit)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(totalCredit)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(closing)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function GeneralLedgerPage() {
  return (
    <Suspense fallback={null}>
      <GeneralLedgerBody />
    </Suspense>
  );
}
