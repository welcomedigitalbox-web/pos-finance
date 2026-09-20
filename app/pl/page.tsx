"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { useStore } from "@/app/store-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, today } from "@/lib/finance";

type Line = { code: string; name: string; amount: number; prev: number };
type PL = {
  income: Line[];
  expense: Line[];
  totals: { income: number; expense: number; prev_income: number; prev_expense: number };
};

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const n = (v: unknown) => Number(v || 0);
const FIELD = "border border-slate-200 rounded-lg px-3 py-2 text-sm";

export default function PLPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const { t } = useLanguage();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [store, setStore] = useState("");
  const [pl, setPl] = useState<PL | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, store]);

  if (!profile || !hasPermission(profile, "fin-pl")) return null;

  async function load() {
    const { data } = await supabase.rpc("fin_pl", { p_from: from, p_to: to, p_store: store || null });
    setPl((data as PL) || null);
  }

  const inc = n(pl?.totals.income);
  const exp = n(pl?.totals.expense);
  const prevInc = n(pl?.totals.prev_income);
  const prevExp = n(pl?.totals.prev_expense);
  const net = inc - exp;
  const prevNet = prevInc - prevExp;

  function Delta({ now, before }: { now: number; before: number }) {
    if (!before) return <span className="text-xs text-slate-400">-</span>;
    const pct = ((now - before) / Math.abs(before)) * 100;
    return (
      <span className={"text-xs " + (pct >= 0 ? "text-green-600" : "text-red-600")}>
        {(pct >= 0 ? "▲ " : "▼ ") + Math.abs(pct).toFixed(1) + "%"}
      </span>
    );
  }

  function Block({ title, lines, total }: { title: string; lines: Line[]; total: number }) {
    return (
      <>
        <tr className="bg-slate-50">
          <td className="px-3 py-2 font-semibold" colSpan={4}>{title}</td>
        </tr>
        {lines.map((l) => (
          <tr key={l.code} className="border-t border-slate-100">
            <td className="px-3 py-2 text-slate-400 text-xs">{l.code}</td>
            <td className="px-3 py-2">{l.name}</td>
            <td className="px-3 py-2 text-right">{fmtMMK(l.amount)}</td>
            <td className="px-3 py-2 text-right text-slate-400">{fmtMMK(l.prev)}</td>
          </tr>
        ))}
        {lines.length === 0 && (
          <tr className="border-t border-slate-100">
            <td className="px-3 py-3 text-slate-400" colSpan={4}>{t("fin_empty")}</td>
          </tr>
        )}
        <tr className="border-t border-slate-200 font-semibold">
          <td className="px-3 py-2" colSpan={2}>{title} total</td>
          <td className="px-3 py-2 text-right">{fmtMMK(total)}</td>
          <td className="px-3 py-2 text-right text-slate-400"></td>
        </tr>
      </>
    );
  }

  return (
    <div className="pt-4 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h2 className="font-semibold text-lg">{t("nav_finPL")}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input type="date" className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} />
          <select className={FIELD} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">{t("fin_store")}: All</option>
            {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Income</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(inc)}</div>
          <Delta now={inc} before={prevInc} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Expenses</div>
          <div className="text-lg font-bold mt-1 text-orange-700">{fmtMMK(exp)}</div>
          <Delta now={exp} before={prevExp} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Net</div>
          <div className={"text-lg font-bold mt-1 " + (net >= 0 ? "text-green-700" : "text-red-600")}>
            {fmtMMK(net)}
          </div>
          <Delta now={net} before={prevNet} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2" colSpan={2}>Account</th>
              <th className="text-right px-3 py-2">This period</th>
              <th className="text-right px-3 py-2">Previous</th>
            </tr>
          </thead>
          <tbody>
            <Block title="Income" lines={pl?.income || []} total={inc} />
            <Block title="Expenses" lines={pl?.expense || []} total={exp} />
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
              <td className="px-3 py-3" colSpan={2}>Net profit</td>
              <td className={"px-3 py-3 text-right " + (net >= 0 ? "text-green-700" : "text-red-600")}>
                {fmtMMK(net)}
              </td>
              <td className="px-3 py-3 text-right text-slate-400">{fmtMMK(prevNet)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 mt-3">
        Cost of goods is not in here yet: it arrives with the product costs.
      </p>
    </div>
  );
}
