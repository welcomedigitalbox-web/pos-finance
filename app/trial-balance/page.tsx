"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtNum, today, type AccountType, type TrialBalanceRow } from "@/lib/finance";

const TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

const TYPE_LABEL: Record<AccountType, "fin_type_asset" | "fin_type_liability" | "fin_type_equity" | "fin_type_income" | "fin_type_expense"> = {
  asset: "fin_type_asset",
  liability: "fin_type_liability",
  equity: "fin_type_equity",
  income: "fin_type_income",
  expense: "fin_type_expense",
};

function yearStart() {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function TrialBalancePage() {
  const { profile } = useAuth();
  const { storeId, stores } = useStore();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [scope, setScope] = useState<"all" | "store">("all");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-trial-balance")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, scope, storeId]);

  if (!profile || !hasPermission(profile, "fin-trial-balance")) return null;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("fin_trial_balance", {
      p_from: from || null,
      p_to: to || null,
      p_store: scope === "store" ? storeId || null : null,
    });
    if (error) {
      setToast("❌ " + error.message);
      setTimeout(() => setToast(""), 3500);
    }
    setRows((data as TrialBalanceRow[]) || []);
    setLoading(false);
  }

  const accName = (r: TrialBalanceRow) => (lang === "my" && r.name_my ? r.name_my : r.name);

  const grouped = useMemo(
    () =>
      TYPES.map((type) => {
        const items = rows.filter((r) => r.type === type);
        return {
          type,
          items,
          debit: items.reduce((s, r) => s + Number(r.debit || 0), 0),
          credit: items.reduce((s, r) => s + Number(r.credit || 0), 0),
          balance: items.reduce((s, r) => s + Number(r.balance || 0), 0),
        };
      }),
    [rows]
  );

  const totalDebit = useMemo(() => rows.reduce((s, r) => s + Number(r.debit || 0), 0), [rows]);
  const totalCredit = useMemo(() => rows.reduce((s, r) => s + Number(r.credit || 0), 0), [rows]);
  const balanced = round2(totalDebit) === round2(totalCredit);

  const storeLabel = stores.find((s) => s.id === storeId)?.name || storeId;

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-4">{t("fin_trialBalanceTitle")}</h2>

      <div className="flex flex-wrap items-end gap-2 mb-4">
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
        <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
          balanced ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
        }`}>
          {balanced ? t("fin_balanced") : t("fin_notBalanced")}
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[780px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_accountCode")}</th>
              <th className="text-left px-3 py-2">{t("fin_accountName")}</th>
              <th className="text-left px-3 py-2">{t("fin_accountType")}</th>
              <th className="text-right px-3 py-2">{t("fin_debit")}</th>
              <th className="text-right px-3 py-2">{t("fin_credit")}</th>
              <th className="text-right px-3 py-2">{t("fin_balance")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading &&
              grouped.flatMap((g) =>
                g.items.length === 0
                  ? []
                  : [
                      ...g.items.map((r) => (
                        <tr key={r.account_id} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono text-xs">
                            <Link href={`/finance/general-ledger?account=${r.account_id}`}
                              className="text-blue-600">
                              {r.code}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <Link href={`/finance/general-ledger?account=${r.account_id}`}
                              className="text-blue-600">
                              {accName(r)}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-slate-500">{t(TYPE_LABEL[r.type])}</td>
                          <td className="px-3 py-2 text-right">{fmtNum(r.debit)}</td>
                          <td className="px-3 py-2 text-right">{fmtNum(r.credit)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtNum(r.balance)}</td>
                        </tr>
                      )),
                      <tr key={`sub-${g.type}`} className="border-t border-slate-200 bg-slate-50/70 font-medium">
                        <td className="px-3 py-2" colSpan={3}>{t(TYPE_LABEL[g.type])}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(g.debit)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(g.credit)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(g.balance)}</td>
                      </tr>,
                    ]
              )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
            {!loading && rows.length > 0 && (
              <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                <td className="px-3 py-2" colSpan={3}>{t("fin_total")}</td>
                <td className="px-3 py-2 text-right">{fmtNum(totalDebit)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(totalCredit)}</td>
                <td className="px-3 py-2 text-right">
                  {balanced ? t("fin_balanced") : t("fin_notBalanced")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mt-3 text-sm text-slate-500">
        <span>{t("fin_totalDebit")}: <strong className="text-slate-900">{fmtNum(totalDebit)}</strong></span>
        <span>{t("fin_totalCredit")}: <strong className="text-slate-900">{fmtNum(totalCredit)}</strong></span>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
