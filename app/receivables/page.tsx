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
  errorText,
} from "@/lib/finance";

const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];
const METHODS = ["cash", "bank", "kpay", "wave", "cheque", "transfer", "other"];

export default function FinanceReceivablesPage() {
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

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [collectRow, setCollectRow] = useState<Ageing | null>(null);
  const [saving, setSaving] = useState(false);
  const [payDate, setPayDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("cash");

  const [courierRows, setCourierRows] = useState<{ courier: string; courier_id: string | null; orders: number; outstanding: number }[]>([]);
  const [courierPick, setCourierPick] = useState<string | null>(null);
  const [courierOf, setCourierOf] = useState<Record<string, string>>({});

  // Money on its way back from a courier is still money owed to us.
  useEffect(() => {
    supabase.from("fin_voucher_courier").select("*").then(({ data }) => {
      const m: Record<string, string> = {};
      for (const r of ((data || []) as { voucher_id: string; courier: string }[])) m[r.voucher_id] = r.courier;
      setCourierOf(m);
    });
    supabase.from("fin_courier_cod").select("*").then(({ data }) => {
      setCourierRows((data as never) || []);
    });
  }, []);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-receivables")) router.replace("/");
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
    let q = supabase.from("fin_receivables").select("*").limit(1000);
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
          !r.voucher_no.toLowerCase().includes(q) &&
          !(r.doc_no || "").toLowerCase().includes(q)) return false;
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

  // Picking a courier narrows the list to what that courier is carrying.
  const visibleByCourier = courierPick
    ? visible.filter((r) => (courierOf[String(r.id)] || "ရုံး/ဆိုင်ကိုယ်တိုင်") === courierPick)
    : visible;

  const chosen = visible.filter((r) => sel.has(r.id));
  const chosenTotal = chosen.reduce((s2, r) => s2 + Number(r.balance || 0), 0);
  const allShown = visible.length > 0 && chosen.length === visible.length;

  function toggleOne(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSel(allShown ? new Set() : new Set(visibleByCourier.map((r) => r.id)));
  }

  function openBulk() {
    setPayDate(today());
    setMethod("cash");
    const cashAcc = accounts.find((a2) => a2.is_cash) || accounts.find((a2) => a2.is_bank);
    setAccountId(cashAcc?.id || "");
    setBulkOpen(true);
  }

  // One payment per customer, because a receipt belongs to whoever paid it.
  // Several invoices from the same person settle together on one receipt.
  async function bulkCollect() {
    if (!chosen.length || !payDate || !accountId) {
      showToast(t("fin_required"));
      return;
    }
    setSaving(true);
    try {
      const groups = new Map<string, Ageing[]>();
      for (const r of chosen) {
        const k = (r.party_id || r.party_name || "-") + "|" + (r.store_id || "");
        groups.set(k, [...(groups.get(k) || []), r]);
      }
      for (const list of Array.from(groups.values())) {
        const total = list.reduce((s2, r) => s2 + Number(r.balance || 0), 0);
        const { error } = await supabase.rpc("fin_record_payment", {
          p: {
            payment_date: payDate,
            direction: "in",
            store_id: list[0].store_id,
            account_id: accountId,
            method,
            party_type: "customer",
            party_id: list[0].party_id,
            party_name: list[0].party_name,
            amount: total,
            discount_amount: 0,
            reference: list.length === 1 ? list[0].voucher_no : list.length + " invoices",
            allocations: list.map((r) => ({
              voucher_id: r.id,
              amount: Number(r.balance || 0),
              discount_amount: 0,
            })),
          },
        });
        if (error) throw error;
      }
      showToast(t("fin_saved"));
      setSel(new Set());
      setBulkOpen(false);
      await load();
    } catch (err) {
      showToast("error: " + ((err as { message?: string })?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  function openCollect(r: Ageing) {
    setCollectRow(r);
    setPayDate(today());
    setAmount(String(Number(r.balance || 0)));
    setDiscount("");
    setMethod("cash");
    const cashAcc = accounts.find((a) => a.is_cash) || accounts.find((a) => a.is_bank);
    setAccountId(cashAcc?.id || "");
  }

  async function collect() {
    if (!collectRow) return;
    if (!payDate || !accountId || Number(amount || 0) <= 0) {
      showToast(t("fin_required"));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("fin_record_payment", {
        p: {
          payment_date: payDate,
          direction: "in",
          store_id: collectRow.store_id,
          account_id: accountId,
          method,
          party_type: "customer",
          party_id: collectRow.party_id,
          party_name: collectRow.party_name,
          amount: Number(amount || 0),
          discount_amount: Number(discount || 0),
          reference: collectRow.voucher_no,
          allocations: [
            {
              voucher_id: collectRow.id,
              amount: Number(amount || 0),
              discount_amount: Number(discount || 0),
            },
          ],
        },
      });
      if (error) throw error;
      showToast(t("fin_saved"));
      setCollectRow(null);
      await load();
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setSaving(false);
    }
  }

  const cashBankAccounts = useMemo(() => accounts.filter((a) => a.is_cash || a.is_bank), [accounts]);

  if (!profile || !hasPermission(profile, "fin-receivables")) return null;

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-4">{t("fin_receivablesTitle")}</h2>

      {courierRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="text-xs text-slate-500 uppercase mb-2">With couriers</div>
          <div className="flex flex-wrap gap-2">
            {courierRows.map((c) => (
              <button key={c.courier}
                onClick={() => setCourierPick(courierPick === c.courier ? null : c.courier)}
                className={"border rounded-lg px-3 py-2 text-left " +
                  (courierPick === c.courier ? "border-slate-900 bg-slate-50" : "border-slate-200")}>
                <div className="text-sm font-medium">{c.courier}</div>
                <div className="text-xs text-slate-500">{c.orders} · {fmtMMK(c.outstanding)}</div>
              </button>
            ))}
          </div>
        </div>
      )}


      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_arTotal")}</div>
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allShown} onChange={toggleAll} />
              </th>
              <th className="text-left px-3 py-2">Doc no.</th>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_dueDate")}</th>
              <th className="text-left px-3 py-2">{t("fin_customer")}</th>
              <th className="text-left px-3 py-2">{t("fin_channel")}</th>
              <th className="text-left px-3 py-2">{t("fin_salesRep")}</th>
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
              <tr><td colSpan={14} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading && visibleByCourier.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-slate-100 ${Number(r.days_overdue || 0) > 0 ? "bg-orange-50/40" : ""}`}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleOne(r.id)} />
                </td>
                <td className="px-3 py-2 font-medium text-xs">{r.doc_no || "-"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.voucher_no}</td>
                <td className="px-3 py-2">{r.voucher_date}</td>
                <td className="px-3 py-2 text-slate-500">{r.due_date || "-"}</td>
                <td className="px-3 py-2 font-medium">{r.party_name || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.channel || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.sale_rep_name || "-"}</td>
                <td className="px-3 py-2 text-right">{fmtNum(r.total)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{fmtNum(r.paid_amount)}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtMMK(r.balance)}</td>
                <td className={`px-3 py-2 text-right ${Number(r.days_overdue || 0) > 0 ? "text-orange-600 font-medium" : "text-slate-400"}`}>
                  {Number(r.days_overdue || 0) > 0 ? r.days_overdue : "-"}
                </td>
                <td className="px-3 py-2 text-slate-500">{r.ageing_bucket}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openCollect(r)} className="text-green-600 text-xs font-medium">
                    {t("fin_collect")}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={14} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {chosen.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 px-4 py-3 z-40">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
            <span className="text-sm">
              {chosen.length} selected · <strong>{fmtMMK(chosenTotal)}</strong>
            </span>
            <button onClick={() => setSel(new Set())} className="text-xs text-slate-500">clear</button>
            <button onClick={openBulk}
              className="ml-auto px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">
              {t("fin_collect")}
            </button>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-lg">
            <h3 className="font-semibold text-lg mb-1">{t("fin_collect")}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {chosen.length} invoices · <strong>{fmtMMK(chosenTotal)}</strong>
            </p>
            <label className="text-sm text-slate-600">{t("fin_date")}</label>
            <input type="date" value={payDate} onChange={(ev) => setPayDate(ev.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3" />
            <label className="text-sm text-slate-600">{t("fin_account")}</label>
            <select value={accountId} onChange={(ev) => setAccountId(ev.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3">
              <option value="">-</option>
              {accounts.filter((a2) => a2.is_cash || a2.is_bank).map((a2) => (
                <option key={a2.id} value={a2.id}>{accountLabel(a2, lang)}</option>
              ))}
            </select>
            <label className="text-sm text-slate-600">{t("fin_method")}</label>
            <input value={method} onChange={(ev) => setMethod(ev.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setBulkOpen(false)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                {t("fin_cancel")}
              </button>
              <button onClick={bulkCollect} disabled={saving}
                className="flex-1 py-2.5 bg-green-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
                {saving ? "..." : t("fin_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {collectRow && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-lg">
            <h3 className="font-semibold text-lg mb-1">{t("fin_collect")}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {collectRow.voucher_no} · {collectRow.party_name || "-"} ·{" "}
              <strong>{fmtMMK(collectRow.balance)}</strong>
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
                onClick={() => setCollectRow(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {t("fin_cancel")}
              </button>
              <button
                onClick={collect}
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
