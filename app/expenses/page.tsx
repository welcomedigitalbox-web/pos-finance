"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK } from "@/lib/finance";

type Row = {
  id: string; voucher_no: string; voucher_date: string; store_id: string | null;
  party_name: string | null; total: number; balance: number; status: string; note: string | null;
};

export default function FinanceExpensesPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-expenses")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, storeFilter]);

  async function load() {
    setLoading(true);
    let q = supabase.from("fin_vouchers").select("*").eq("kind", "expense")
      .order("voucher_date", { ascending: false })
      .order("voucher_no", { ascending: false }).limit(300);
    if (from) q = q.gte("voucher_date", from);
    if (to) q = q.lte("voucher_date", to);
    if (storeFilter) q = q.eq("store_id", storeFilter);
    const { data } = await q;
    setRows((data as Row[]) || []);
    setLoading(false);
  }

  const q = search.trim().toLowerCase();
  const visible = !q ? rows : rows.filter((r) =>
    (r.party_name || "").toLowerCase().includes(q) ||
    r.voucher_no.toLowerCase().includes(q) ||
    (r.note || "").toLowerCase().includes(q));

  const total = visible.reduce((s, r) => s + Number(r.total || 0), 0);
  const unpaid = visible.reduce((s, r) => s + Number(r.balance || 0), 0);

  if (!profile || !hasPermission(profile, "fin-expenses")) return null;

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="font-semibold text-lg">{t("nav_finExpenses")}</h2>
        <button onClick={() => router.push("/expenses/new")}
          className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold">
          + {t("nav_finExpenses")}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_total")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(total)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_balance")}</div>
          <div className="text-lg font-bold mt-1 text-orange-600">{fmtMMK(unpaid)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_no")}</div>
          <div className="text-xl font-bold mt-1">{visible.length}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="">{t("fin_store")} — {t("fin_all")}</option>
          {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
        <input placeholder={t("fin_search")} value={search} onChange={(e) => setSearch(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_party")}</th>
              <th className="text-left px-3 py-2">{t("fin_store")}</th>
              <th className="text-right px-3 py-2">{t("fin_total")}</th>
              <th className="text-right px-3 py-2">{t("fin_balance")}</th>
              <th className="text-left px-3 py-2">{t("fin_note")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr key={r.id} onClick={() => router.push("/expenses/" + r.id)}
                className="border-t border-slate-100 cursor-pointer hover:bg-slate-50">
                <td className="px-3 py-2">{r.voucher_date}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.voucher_no}</td>
                <td className="px-3 py-2 font-medium">{r.party_name || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.store_id || "-"}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtMMK(r.total)}</td>
                <td className={"px-3 py-2 text-right " + (Number(r.balance) > 0 ? "text-orange-600 font-medium" : "text-slate-400")}>
                  {Number(r.balance) > 0 ? fmtMMK(r.balance) : "-"}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">{r.note || "-"}</td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
