"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { loadAccounts, accountLabel, errorText, type FinAccount } from "@/lib/finance";

type Method = {
  method_code: string;
  label: string | null;
  account_id: string;
  is_primary: boolean;
  use_in_pos: boolean;
  use_in_online: boolean;
  is_cash: boolean;
  is_cod: boolean;
  sort_order: number;
  active: boolean;
};

const FIELD = "w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm";

export default function MethodsPage() {
  const { profile } = useAuth();
  const { t, lang } = useLanguage();

  const [rows, setRows] = useState<Method[]>([]);
  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [toast, setToast] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [account, setAccount] = useState("");

  useEffect(() => {
    load();
    loadAccounts().then((a) => setAccounts(a.filter((x) => x.is_cash || x.is_bank)));
  }, []);

  if (!profile || !hasPermission(profile, "fin-methods")) return null;

  async function load() {
    const { data } = await supabase.from("fin_method_accounts").select("*")
      .eq("is_primary", true).order("sort_order").order("label");
    setRows((data as Method[]) || []);
  }

  function say(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  // A change here is the only change: POS, the online shop and the ledger all
  // read this one row.
  async function patch(m: Method, fields: Partial<Method>) {
    setRows(rows.map((r) => (r.method_code === m.method_code ? { ...r, ...fields } : r)));
    const { error } = await supabase.from("fin_method_accounts").update(fields)
      .eq("method_code", m.method_code);
    if (error) { say("❌ " + errorText(error)); load(); }
  }

  async function add() {
    const c = code.trim().toLowerCase().replace(/\s+/g, "");
    if (!c || !account) return;
    const { error } = await supabase.from("fin_method_accounts").insert({
      method_code: c, label: label.trim() || c, account_id: account,
      is_primary: true, use_in_pos: true, use_in_online: true,
      sort_order: 100, active: true,
    });
    if (error) return say("❌ " + errorText(error));
    setCode(""); setLabel(""); setAccount("");
    load();
    say("✅");
  }

  const Tick = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => (
    <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
  );

  return (
    <div className="pt-4 max-w-5xl">
      <h2 className="font-semibold text-lg mb-1">{t("nav_finMethods")}</h2>
      <p className="text-sm text-slate-500 mb-4">
        POS, the online shop and the ledger all read this list.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-5">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Code</th>
              <th className="text-left px-3 py-2">{t("fin_account")}</th>
              <th className="px-3 py-2">POS</th>
              <th className="px-3 py-2">Online</th>
              <th className="px-3 py-2">Cash</th>
              <th className="px-3 py-2">COD</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.method_code} className={"border-t border-slate-100 " + (m.active ? "" : "opacity-50")}>
                <td className="px-3 py-2">
                  <input className={FIELD} value={m.label || ""}
                    onChange={(e) => setRows(rows.map((r) => r.method_code === m.method_code ? { ...r, label: e.target.value } : r))}
                    onBlur={(e) => patch(m, { label: e.target.value })} />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{m.method_code}</td>
                <td className="px-3 py-2">
                  <select className={FIELD} value={m.account_id}
                    onChange={(e) => patch(m, { account_id: e.target.value })}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-center"><Tick on={m.use_in_pos} set={(v) => patch(m, { use_in_pos: v })} /></td>
                <td className="px-3 py-2 text-center"><Tick on={m.use_in_online} set={(v) => patch(m, { use_in_online: v })} /></td>
                <td className="px-3 py-2 text-center"><Tick on={m.is_cash} set={(v) => patch(m, { is_cash: v })} /></td>
                <td className="px-3 py-2 text-center"><Tick on={m.is_cod} set={(v) => patch(m, { is_cod: v })} /></td>
                <td className="px-3 py-2 text-center">
                  <input type="number" className="w-16 border border-slate-200 rounded px-2 py-1 text-sm"
                    value={m.sort_order}
                    onChange={(e) => setRows(rows.map((r) => r.method_code === m.method_code ? { ...r, sort_order: Number(e.target.value) } : r))}
                    onBlur={(e) => patch(m, { sort_order: Number(e.target.value) || 100 })} />
                </td>
                <td className="px-3 py-2 text-center"><Tick on={m.active} set={(v) => patch(m, { active: v })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold mb-3">+ Payment method</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500">Name</label>
            <input className={FIELD} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Code</label>
            <input className={FIELD} value={code} onChange={(e) => setCode(e.target.value)} placeholder="uabpay" />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t("fin_account")}</label>
            <select className={FIELD} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">-</option>
              {accounts.map((a) => (<option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>))}
            </select>
          </div>
          <button onClick={add} disabled={!code.trim() || !account}
            className="px-4 py-2 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {t("fin_save")}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
