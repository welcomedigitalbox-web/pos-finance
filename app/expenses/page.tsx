"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import {
  fmtMMK, today, loadAccounts, accountLabel,
  type FinAccount, errorText,
} from "@/lib/finance";

const METHODS = ["cash", "bank", "kpay", "wave", "cheque", "transfer", "other"];

type Row = {
  id: string; voucher_no: string; voucher_date: string; store_id: string | null;
  party_name: string | null; total: number; balance: number; status: string; note: string | null;
};

export default function FinanceExpensesPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [open, setOpen] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [storeFilter, setStoreFilter] = useState("");

  const [date, setDate] = useState(today());
  const [expType, setExpType] = useState("");
  const [expAccount, setExpAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [store, setStore] = useState("");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [payNow, setPayNow] = useState(true);
  const [payAccount, setPayAccount] = useState("");
  const [method, setMethod] = useState("cash");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-expenses")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => { loadAccounts().then(setAccounts); }, []);

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

  function say(m: string) { setToast(m); setTimeout(() => setToast(""), 3500); }

  const expenseAccounts = useMemo(() => {
    const list = accounts.filter((a) => a.type === "expense");
    if (!expType) return list;
    return list.filter((a) => (a.expense_kind || "indirect") === expType);
  }, [accounts, expType]);

  const cashBank = useMemo(() => accounts.filter((a) => a.is_cash || a.is_bank), [accounts]);

  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const unpaid = rows.reduce((s, r) => s + Number(r.balance || 0), 0);

  function openNew() {
    setDate(today());
    setExpType("");
    setExpAccount("");
    setAmount("");
    setStore(storeFilter || "");
    setPayee("");
    setNote("");
    setPayNow(true);
    setMethod("cash");
    const cash = accounts.find((a) => a.is_cash) || accounts.find((a) => a.is_bank);
    setPayAccount(cash?.id || "");
    setOpen(true);
  }

  async function save() {
    const acc = accounts.find((a) => a.id === expAccount);
    if (!date || !acc || Number(amount || 0) <= 0) { say(t("fin_required")); return; }
    const payAcc = accounts.find((a) => a.id === payAccount);
    if (payNow && !payAcc) { say(t("fin_required")); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        kind: "expense",
        voucher_date: date,
        store_id: store || null,
        party_type: "other",
        party_name: payee.trim() || acc.name,
        note: note.trim() || null,
        items: [{
          description: note.trim() || acc.name,
          qty: 1,
          unit_price: Number(amount || 0),
          account_code: acc.code,
        }],
      };
      if (payNow && payAcc) {
        payload.payment = {
          payment_date: date,
          account_code: payAcc.code,
          method,
          amount: Number(amount || 0),
        };
      }
      const { error } = await supabase.rpc("fin_save_voucher", { p: payload });
      if (error) throw error;
      say(t("fin_saved"));
      setOpen(false);
      await load();
    } catch (err) {
      say("error: " + errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const accName = (id: string | null) => {
    const a = accounts.find((x) => x.id === id);
    return a ? accountLabel(a, lang) : "-";
  };

  if (!profile || !hasPermission(profile, "fin-expenses")) return null;

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="font-semibold text-lg">{t("nav_finExpenses")}</h2>
        <button onClick={openNew}
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
          <div className="text-xl font-bold mt-1">{rows.length}</div>
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
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
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
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-lg my-8">
            <h3 className="font-semibold text-lg mb-4">{t("nav_finExpenses")}</h3>

            <label className="text-sm text-slate-600">{t("fin_date")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3" />

            <label className="text-sm text-slate-600">Expense type</label>
            <select value={expType} onChange={(e) => { setExpType(e.target.value); setExpAccount(""); }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3">
              <option value="">All</option>
              <option value="direct">Direct</option>
              <option value="indirect">Indirect</option>
            </select>

            <label className="text-sm text-slate-600">{t("fin_account")}</label>
            <select value={expAccount} onChange={(e) => setExpAccount(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3">
              <option value="">-</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>
              ))}
            </select>

            <label className="text-sm text-slate-600">{t("fin_amount")}</label>
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3" />

            <label className="text-sm text-slate-600">{t("fin_store")}</label>
            <select value={store} onChange={(e) => setStore(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3">
              <option value="">-</option>
              {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>

            <label className="text-sm text-slate-600">{t("fin_party")}</label>
            <input value={payee} onChange={(e) => setPayee(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3" />

            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
              {t("fin_dir_out")}
            </label>

            {payNow && (
              <>
                <label className="text-sm text-slate-600">{t("fin_account")}</label>
                <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3">
                  <option value="">-</option>
                  {cashBank.map((a) => (
                    <option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>
                  ))}
                </select>
                <label className="text-sm text-slate-600">{t("fin_method")}</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3">
                  {METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
              </>
            )}

            <label className="text-sm text-slate-600">{t("fin_note")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4" />

            <div className="flex gap-2">
              <button onClick={() => setOpen(false)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                {t("fin_cancel")}
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
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
