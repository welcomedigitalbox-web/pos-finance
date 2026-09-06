"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import {
  fmtMMK,
  fmtNum,
  today,
  loadAccounts,
  accountLabel,
  type FinAccount,
  type Ageing,
} from "@/lib/finance";

const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];
const METHODS = ["cash", "bank", "kpay", "wave", "cheque", "transfer", "other"];

export default function FinancePayablesPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<Ageing[]>([]);
  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [storeFilter, setStoreFilter] = useState("");
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [settleRow, setSettleRow] = useState<Ageing | null>(null);
  const [saving, setSaving] = useState(false);
  const [payDate, setPayDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("cash");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-payables")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    loadAccounts().then(setAccounts);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter]);

  async function load() {
    setLoading(true);
    let q = supabase.from("fin_payables").select("*").limit(1000);
    if (storeFilter) q = q.eq("store_id", storeFilter);
    const { data } = await q;
    const list = ((data as Ageing[]) || []).slice().sort(
      (a, b) => Number(b.days_overdue || 0) - Number(a.days_overdue || 0)
    );
    setRows(list);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (bucket && r.ageing_bucket !== bucket) return false;
      if (overdueOnly && Number(r.days_overdue || 0) <= 0) return false;
      if (q && !(r.party_name || "").toLowerCase().includes(q) &&
          !r.voucher_no.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, bucket, overdueOnly]);

  const totalOutstanding = visible.reduce((s, r) => s + Number(r.balance || 0), 0);
  const overdueTotal = visible
    .filter((r) => Number(r.days_overdue || 0) > 0)
    .reduce((s, r) => s + Number(r.balance || 0), 0);

  const ageing = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of BUCKETS) map[b] = 0;
    for (const r of visible) map[r.ageing_bucket] = (map[r.ageing_bucket] || 0) + Number(r.balance || 0);
    return map;
  }, [visible]);

  const byParty = useMemo(() => {
    const map = new Map<string, { name: string; count: number; balance: number; oldest: number }>();
    for (const r of visible) {
      const key = r.party_id || r.party_name || "-";
      const cur = map.get(key) || { name: r.party_name || "-", count: 0, balance: 0, oldest: 0 };
      cur.count += 1;
      cur.balance += Number(r.balance || 0);
      cur.oldest = Math.max(cur.oldest, Number(r.days_overdue || 0));
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
  }, [visible]);

  function openSettle(r: Ageing) {
    setSettleRow(r);
    setPayDate(today());
    setAmount(String(Number(r.balance || 0)));
    setDiscount("");
    setMethod("cash");
    const cashAcc = accounts.find((a) => a.is_cash) || accounts.find((a) => a.is_bank);
    setAccountId(cashAcc?.id || "");
  }

  async function settle() {
    if (!settleRow) return;
    if (!payDate || !accountId || Number(amount || 0) <= 0) {
      showToast(t("fin_required"));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("fin_record_payment", {
        p: {
          payment_date: payDate,
          direction: "out",
          store_id: settleRow.store_id,
          account_id: accountId,
          method,
          party_type: "supplier",
          party_id: settleRow.party_id,
          party_name: settleRow.party_name,
          amount: Number(amount || 0),
          discount_amount: Number(discount || 0),
          reference: settleRow.voucher_no,
          allocations: [
            {
              voucher_id: settleRow.id,
              amount: Number(amount || 0),
              discount_amount: Number(discount || 0),
            },
          ],
        },
      });
      if (error) throw error;
      showToast(t("fin_saved"));
      setSettleRow(null);
      await load();
    } catch (err) {
      showToast("❌ " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  const cashBankAccounts = useMemo(() => accounts.filter((a) => a.is_cash || a.is_bank), [accounts]);

  if (!profile || !hasPermission(profile, "fin-payables")) return null;

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-4">{t("fin_payablesTitle")}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_apTotal")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(totalOutstanding)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_overdue")}</div>
          <div className="text-lg font-bold mt-1 text-orange-600">{fmtMMK(overdueTotal)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_no")}</div>
          <div className="text-xl font-bold mt-1">{visible.length}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-5">
        <div className="text-xs text-slate-500 uppercase mb-2">{t("fin_ageing")}</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {BUCKETS.map((b) => (
            <div key={b}>
              <div className="text-xs text-slate-500">{b}</div>
              <div className="text-sm font-semibold">{fmtNum(ageing[b])}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
        >
          <option value="">{t("fin_store")} — {t("fin_all")}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
        >
          <option value="">{t("fin_ageing")} — {t("fin_all")}</option>
          {BUCKETS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm px-3 py-2 border border-slate-200 rounded-lg">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          {t("fin_overdue")}
        </label>
        <input
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]"
          placeholder={t("fin_search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_supplier")}</th>
              <th className="text-right px-3 py-2">{t("fin_no")}</th>
              <th className="text-right px-3 py-2">{t("fin_outstanding")}</th>
              <th className="text-right px-3 py-2">{t("fin_daysOverdue")}</th>
            </tr>
          </thead>
          <tbody>
            {byParty.map((p, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-right text-slate-500">{p.count}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtMMK(p.balance)}</td>
                <td className={`px-3 py-2 text-right ${p.oldest > 0 ? "text-orange-600 font-medium" : "text-slate-400"}`}>
                  {p.oldest > 0 ? p.oldest : "-"}
                </td>
              </tr>
            ))}
            {!loading && byParty.length === 0 && (
              <tr><td colSpan={4} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_dueDate")}</th>
              <th className="text-left px-3 py-2">{t("fin_supplier")}</th>
              <th className="text-left px-3 py-2">{t("fin_channel")}</th>
              <th className="text-right px-3 py-2">{t("fin_total")}</th>
              <th className="text-right px-3 py-2">{t("fin_paid")}</th>
              <th className="text-right px-3 py-2">{t("fin_balance")}</th>
              <th className="text-right px-3 py-2">{t("fin_daysOverdue")}</th>
              <th className="text-left px-3 py-2">{t("fin_ageing")}</th>
              <th className="text-right px-3 py-2">{t("fin_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-slate-100 ${Number(r.days_overdue || 0) > 0 ? "bg-orange-50/40" : ""}`}
              >
                <td className="px-3 py-2 font-mono text-xs">{r.voucher_no}</td>
                <td className="px-3 py-2">{r.voucher_date}</td>
                <td className="px-3 py-2 text-slate-500">{r.due_date || "-"}</td>
                <td className="px-3 py-2 font-medium">{r.party_name || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.channel || "-"}</td>
                <td className="px-3 py-2 text-right">{fmtNum(r.total)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{fmtNum(r.paid_amount)}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtMMK(r.balance)}</td>
                <td className={`px-3 py-2 text-right ${Number(r.days_overdue || 0) > 0 ? "text-orange-600 font-medium" : "text-slate-400"}`}>
                  {Number(r.days_overdue || 0) > 0 ? r.days_overdue : "-"}
                </td>
                <td className="px-3 py-2 text-slate-500">{r.ageing_bucket}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openSettle(r)} className="text-green-600 text-xs font-medium">
                    {t("fin_settle")}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={11} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {settleRow && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-lg">
            <h3 className="font-semibold text-lg mb-1">{t("fin_settle")}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {settleRow.voucher_no} · {settleRow.party_name || "-"} ·{" "}
              <strong>{fmtMMK(settleRow.balance)}</strong>
            </p>

            <label className="text-sm text-slate-600">{t("fin_date")}</label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />

            <label className="text-sm text-slate-600">{t("fin_amount")}</label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />

            <label className="text-sm text-slate-600">{t("fin_cashDiscount")}</label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />

            <label className="text-sm text-slate-600">{t("fin_account")}</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">-</option>
              {cashBankAccounts.map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>
              ))}
            </select>

            <label className="text-sm text-slate-600">{t("fin_method")}</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <div className="flex gap-2">
              <button
                onClick={() => setSettleRow(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {t("fin_cancel")}
              </button>
              <button
                onClick={settle}
                disabled={saving}
                className="flex-1 py-2.5 bg-green-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
              >
                {saving ? "..." : t("fin_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
