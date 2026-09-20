"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { today, loadAccounts, accountLabel, type FinAccount, errorText } from "@/lib/finance";

const METHODS = ["cash", "bank", "kpay", "wave", "cheque", "transfer", "other"];
const FIELD = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1";

export default function NewExpensePage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

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

  useEffect(() => {
    loadAccounts().then((a) => {
      setAccounts(a);
      const cash = a.find((x) => x.is_cash) || a.find((x) => x.is_bank);
      setPayAccount(cash?.id || "");
    });
  }, []);

  const expenseAccounts = useMemo(() => {
    const list = accounts.filter((a) => a.type === "expense");
    if (!expType) return list;
    return list.filter((a) => (a.expense_kind || "indirect") === expType);
  }, [accounts, expType]);

  const cashBank = useMemo(() => accounts.filter((a) => a.is_cash || a.is_bank), [accounts]);

  async function save() {
    const acc = accounts.find((a) => a.id === expAccount);
    if (!date || !acc || Number(amount || 0) <= 0) { setErr(t("fin_required")); return; }
    const payAcc = accounts.find((a) => a.id === payAccount);
    if (payNow && !payAcc) { setErr(t("fin_required")); return; }

    setSaving(true); setErr("");
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
      const { data, error } = await supabase.rpc("fin_save_voucher", { p: payload });
      if (error) throw error;
      router.push("/expenses/" + String(data));
    } catch (e) {
      setErr(errorText(e));
      setSaving(false);
    }
  }

  if (!profile || !hasPermission(profile, "fin-expenses")) return null;

  return (
    <div className="pt-4 max-w-3xl">
      <button onClick={() => router.push("/expenses")} className="text-blue-600 text-sm font-medium mb-3">
        ← {t("nav_finExpenses")}
      </button>
      <h2 className="font-semibold text-lg mb-4">+ {t("nav_finExpenses")}</h2>

      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-600">{t("fin_date")}</label>
          <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">{t("fin_store")}</label>
          <select className={FIELD} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">-</option>
            {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600">Expense type</label>
          <select className={FIELD} value={expType}
            onChange={(e) => { setExpType(e.target.value); setExpAccount(""); }}>
            <option value="">All</option>
            <option value="direct">Direct</option>
            <option value="indirect">Indirect</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600">{t("fin_account")}</label>
          <select className={FIELD} value={expAccount} onChange={(e) => setExpAccount(e.target.value)}>
            <option value="">-</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600">{t("fin_amount")}</label>
          <input type="number" min={0} className={FIELD} value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-slate-600">{t("fin_party")}</label>
          <input className={FIELD} value={payee} onChange={(e) => setPayee(e.target.value)} />
        </div>

        <div className="sm:col-span-2 border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
            {t("fin_dir_out")}
          </label>
        </div>

        {payNow && (
          <>
            <div>
              <label className="text-sm text-slate-600">{t("fin_account")}</label>
              <select className={FIELD} value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>
                <option value="">-</option>
                {cashBank.map((a) => (
                  <option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-slate-600">{t("fin_method")}</label>
              <select className={FIELD} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
          </>
        )}

        <div className="sm:col-span-2">
          <label className="text-sm text-slate-600">{t("fin_note")}</label>
          <input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="sm:col-span-2 flex gap-2 pt-2">
          <button onClick={() => router.push("/expenses")}
            className="px-5 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
            {t("fin_cancel")}
          </button>
          <button onClick={save} disabled={saving}
            className="px-6 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {saving ? "..." : t("fin_save")}
          </button>
          {err && <span className="text-sm text-red-600 self-center">{err}</span>}
        </div>
      </div>
    </div>
  );
}
