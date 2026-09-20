"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, today, errorText } from "@/lib/finance";

type Acc = { id: string; code: string; name: string; is_cash: boolean; store_id: string | null; balance: number };
type Count = { id: string; count_date: string; account_id: string; store_id: string | null; expected: number; counted: number; note: string | null; closed_by: string | null };

const FIELD = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm";

export default function ClosingPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const [accs, setAccs] = useState<Acc[]>([]);
  const [rows, setRows] = useState<Count[]>([]);
  const [acc, setAcc] = useState("");
  const [date, setDate] = useState(today());
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { load(); }, []);

  if (!profile || !hasPermission(profile, "fin-closing")) return null;

  async function load() {
    const [a, c] = await Promise.all([
      supabase.rpc("fin_cash_accounts", { p_store: null }),
      supabase.from("fin_cash_counts").select("*").order("count_date", { ascending: false }).limit(30),
    ]);
    const list = ((a.data || []) as Acc[]).filter((x) => x.is_cash);
    setAccs(list);
    if (!acc && list[0]) setAcc(list[0].id);
    setRows((c.data as Count[]) || []);
  }

  const chosen = accs.find((a) => a.id === acc);
  const expected = Number(chosen?.balance || 0);
  const diff = counted === "" ? 0 : Number(counted) - expected;

  async function close() {
    if (counted === "") return;
    if (diff !== 0 && !note.trim()) return setMsg("A difference needs a note");
    setBusy(true);
    const { error } = await supabase.rpc("fin_close_cash", {
      p: { account_id: acc, store_id: chosen?.store_id || null, count_date: date,
           counted: Number(counted), note: note.trim() || null },
    });
    setBusy(false);
    if (error) return setMsg("❌ " + errorText(error));
    setMsg("✅"); setCounted(""); setNote(""); load();
  }

  const accName = (id: string) => {
    const a = accs.find((x) => x.id === id);
    return a ? a.code + " · " + a.name : id;
  };

  return (
    <div className="pt-4 max-w-5xl">
      <h2 className="font-semibold text-lg mb-1">{t("nav_finClosing")}</h2>
      <p className="text-sm text-slate-500 mb-4">
        Count what is there, and let the books admit the difference.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end mb-5">
        <div>
          <label className="text-xs text-slate-500">{t("fin_account")}</label>
          <select className={FIELD} value={acc} onChange={(e) => setAcc(e.target.value)}>
            {accs.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_date")}</label>
          <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">Counted</label>
          <input type="number" className={FIELD} value={counted} onChange={(e) => setCounted(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">Note</label>
          <input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="sm:col-span-4 flex items-center justify-between">
          <div className="text-sm">
            <span className="text-slate-500">Books say </span>
            <span className="font-semibold">{fmtMMK(expected)}</span>
            {counted !== "" && (
              <span className={"ml-4 font-semibold " + (diff === 0 ? "text-green-700" : "text-red-600")}>
                Difference {fmtMMK(diff)}
              </span>
            )}
          </div>
          <button onClick={close} disabled={busy || counted === ""}
            className="px-4 py-2 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {busy ? "..." : "Close"}
          </button>
        </div>
        {msg && <p className="sm:col-span-4 text-sm">{msg}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_account")}</th>
              <th className="text-right px-3 py-2">Books</th>
              <th className="text-right px-3 py-2">Counted</th>
              <th className="text-right px-3 py-2">Difference</th>
              <th className="text-left px-3 py-2">Note</th>
              <th className="text-left px-3 py-2">By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = Number(r.counted) - Number(r.expected);
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.count_date}</td>
                  <td className="px-3 py-2">{accName(r.account_id)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{fmtMMK(r.expected)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtMMK(r.counted)}</td>
                  <td className={"px-3 py-2 text-right " + (d === 0 ? "text-slate-400" : "text-red-600 font-semibold")}>
                    {fmtMMK(d)}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{r.note || "-"}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{r.closed_by || "-"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={7}>{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
