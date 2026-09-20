"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, today, errorText } from "@/lib/finance";

type Acc = { id: string; code: string; name: string; balance: number };
type Row = { id: string; transfer_date: string; from_account: string; to_account: string; amount: number; note: string | null; created_by: string | null };

const FIELD = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm";

export default function TransfersPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const [accs, setAccs] = useState<Acc[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { load(); }, []);

  if (!profile || !hasPermission(profile, "fin-transfers")) return null;

  async function load() {
    const [a, r] = await Promise.all([
      supabase.rpc("fin_cash_accounts", { p_store: null }),
      supabase.from("fin_cash_transfers").select("*").order("transfer_date", { ascending: false }).limit(30),
    ]);
    setAccs((a.data || []) as Acc[]);
    setRows((r.data as Row[]) || []);
  }

  async function save() {
    if (!from || !to || from === to || !amount) return setMsg("Pick two different accounts and an amount");
    setBusy(true);
    const { error } = await supabase.rpc("fin_record_transfer", {
      p: { transfer_date: date, from_account: from, to_account: to,
           amount: Number(amount), note: note.trim() || null },
    });
    setBusy(false);
    if (error) return setMsg("❌ " + errorText(error));
    setMsg("✅"); setAmount(""); setNote(""); load();
  }

  const name = (id: string) => {
    const a = accs.find((x) => x.id === id);
    return a ? a.code + " · " + a.name : id;
  };

  return (
    <div className="pt-4 max-w-5xl">
      <h2 className="font-semibold text-lg mb-1">{t("nav_finTransfers")}</h2>
      <p className="text-sm text-slate-500 mb-4">
        Cash banked, or money moved between wallets. Not income, not a cost.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end mb-5">
        <div>
          <label className="text-xs text-slate-500">{t("fin_date")}</label>
          <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">From</label>
          <select className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">-</option>
            {accs.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">To</label>
          <select className={FIELD} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">-</option>
            {accs.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_amount")}</label>
          <input type="number" className={FIELD} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_note")}</label>
          <input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="sm:col-span-5 flex justify-between items-center">
          <span className="text-sm text-slate-500">
            {from ? name(from) + " → " + (to ? name(to) : "?") : ""}
          </span>
          <button onClick={save} disabled={busy}
            className="px-4 py-2 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {busy ? "..." : t("fin_save")}
          </button>
        </div>
        {msg && <p className="sm:col-span-5 text-sm">{msg}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">From</th>
              <th className="text-left px-3 py-2">To</th>
              <th className="text-right px-3 py-2">{t("fin_amount")}</th>
              <th className="text-left px-3 py-2">{t("fin_note")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{r.transfer_date}</td>
                <td className="px-3 py-2">{name(r.from_account)}</td>
                <td className="px-3 py-2">{name(r.to_account)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtMMK(r.amount)}</td>
                <td className="px-3 py-2 text-slate-500">{r.note || "-"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={5}>{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
