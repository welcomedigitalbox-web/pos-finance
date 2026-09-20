"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission, hasAnyFinanceAccess, PAGE_OPTIONS } from "@/app/permissions";
import type { PageKey } from "@/app/permissions";
import { fmtMMK, today, type Ageing } from "@/lib/finance";

type CashRow = Record<string, unknown> & { id: string; balance: number; is_cash: boolean; is_bank: boolean };

type VoucherRow = {
  id: string;
  voucher_date: string;
  kind: string;
  store_id: string | null;
  reference: string | null;
  total: number | string | null;
};

type QuickLink = { key: PageKey; href: string; labelKey: "nav_finSales" | "nav_finVouchers" | "nav_finPayments" | "nav_finReceivables" | "nav_finPayables" };

const QUICK_LINKS: QuickLink[] = [
  { key: "fin-sales", href: "/sales", labelKey: "nav_finSales" },
  { key: "fin-vouchers", href: "/vouchers", labelKey: "nav_finVouchers" },
  { key: "fin-payments", href: "/payments", labelKey: "nav_finPayments" },
  { key: "fin-receivables", href: "/receivables", labelKey: "nav_finReceivables" },
  { key: "fin-payables", href: "/payables", labelKey: "nav_finPayables" },
];

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function shift(day: string, days: number) {
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000) + 1;
}

const n = (v: unknown) => Number(v || 0);

// An order that came from the online shop carries its own reference; anything
// else was rung up at a counter.
function channelOf(v: VoucherRow) {
  const ref = (v.reference || "").toLowerCase();
  if (ref.startsWith("msgr") || ref.startsWith("ebh")) return "Online";
  if ((v.store_id || "").toUpperCase().endsWith("-WH")) return "Online";
  return "POS";
}

export default function FinanceDashboardPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const { t } = useLanguage();
  const router = useRouter();

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const [ar, setAr] = useState<Ageing[]>([]);
  const [ap, setAp] = useState<Ageing[]>([]);
  const [cash, setCash] = useState<CashRow[]>([]);
  const [cur, setCur] = useState<VoucherRow[]>([]);
  const [prev, setPrev] = useState<VoucherRow[]>([]);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-dashboard")) {
      const first = PAGE_OPTIONS.find((p) => p.href !== "/" && hasPermission(profile, p.key));
      if (first) router.replace(first.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  if (profile && !hasAnyFinanceAccess(profile)) {
    return <div className="pt-16 text-center text-slate-500 text-sm">{t("fin_noAccess")}</div>;
  }

  if (!profile || !hasPermission(profile, "fin-dashboard")) return null;

  async function load() {
    const span = Math.max(1, daysBetween(from, to));
    const pFrom = shift(from, -span);
    const pTo = shift(from, -1);
    const cols = "id,voucher_date,kind,store_id,reference,total";
    const [arRes, apRes, cashRes, curRes, prevRes] = await Promise.all([
      supabase.from("fin_receivables").select("*"),
      supabase.from("fin_payables").select("*"),
      supabase.from("fin_cash_balances").select("*"),
      supabase.from("fin_vouchers").select(cols).gte("voucher_date", from).lte("voucher_date", to).neq("status", "cancelled"),
      supabase.from("fin_vouchers").select(cols).gte("voucher_date", pFrom).lte("voucher_date", pTo).neq("status", "cancelled"),
    ]);
    setAr((arRes.data as Ageing[]) || []);
    setAp((apRes.data as Ageing[]) || []);
    setCash((cashRes.data as CashRow[]) || []);
    setCur((curRes.data as VoucherRow[]) || []);
    setPrev((prevRes.data as VoucherRow[]) || []);
  }

  const sum = (rows: Ageing[]) => rows.reduce((s, r) => s + n(r.balance), 0);
  const vsum = (rows: VoucherRow[]) => rows.reduce((s, r) => s + n(r.total), 0);
  const sales = (rows: VoucherRow[]) => vsum(rows.filter((r) => r.kind === "sale"));
  const spend = (rows: VoucherRow[]) => vsum(rows.filter((r) => r.kind === "expense"));

  const arTotal = useMemo(() => sum(ar), [ar]);
  const apTotal = useMemo(() => sum(ap), [ap]);
  const cashTotal = useMemo(() => cash.filter((c) => c.is_cash).reduce((s, c) => s + n(c.balance), 0), [cash]);
  const bankTotal = useMemo(() => cash.filter((c) => c.is_bank).reduce((s, c) => s + n(c.balance), 0), [cash]);

  const curSale = useMemo(() => sales(cur), [cur]);
  const prevSale = useMemo(() => sales(prev), [prev]);
  const curExp = useMemo(() => spend(cur), [cur]);
  const prevExp = useMemo(() => spend(prev), [prev]);

  function group(rows: VoucherRow[], key: (v: VoucherRow) => string) {
    const m: Record<string, number> = {};
    for (const v of rows) if (v.kind === "sale") m[key(v)] = (m[key(v)] || 0) + n(v.total);
    return m;
  }

  const byChannel = useMemo(() => ({ cur: group(cur, channelOf), prev: group(prev, channelOf) }), [cur, prev]);
  const byStore = useMemo(
    () => ({ cur: group(cur, (v) => v.store_id || "-"), prev: group(prev, (v) => v.store_id || "-") }),
    [cur, prev]
  );

  const storeName = (id: string) => (id === "-" ? "-" : stores.find((s) => s.id === id)?.name || id);
  const accName = (c: CashRow) => String(c.name ?? c.account_name ?? c.code ?? c.id);

  function Delta({ now, before }: { now: number; before: number }) {
    if (!before) return <span className="text-xs text-slate-400">-</span>;
    const pct = ((now - before) / before) * 100;
    const up = pct >= 0;
    return (
      <span className={"text-xs font-medium " + (up ? "text-green-600" : "text-red-600")}>
        {(up ? "▲ " : "▼ ") + Math.abs(pct).toFixed(1) + "%"}
      </span>
    );
  }

  function Compare({ title, rows }: { title: string; rows: { cur: Record<string, number>; prev: Record<string, number> } }) {
    const keys = Array.from(new Set([...Object.keys(rows.cur), ...Object.keys(rows.prev)]))
      .sort((a, b) => (rows.cur[b] || 0) - (rows.cur[a] || 0));
    return (
      <div>
        <h3 className="font-semibold mb-2">{title}</h3>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">{title}</th>
                <th className="text-right px-3 py-2">This period</th>
                <th className="text-right px-3 py-2">Previous</th>
                <th className="text-right px-3 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="px-3 py-2">{title.includes("store") ? storeName(k) : k}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtMMK(rows.cur[k] || 0)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{fmtMMK(rows.prev[k] || 0)}</td>
                  <td className="px-3 py-2 text-right"><Delta now={rows.cur[k] || 0} before={rows.prev[k] || 0} /></td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={4}>{t("fin_empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const Card = ({ label, value, extra, tone }: { label: string; value: number; extra?: React.ReactNode; tone?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={"text-lg font-bold mt-1 " + (tone || "")}>{fmtMMK(value)}</div>
      {extra && <div className="mt-1">{extra}</div>}
    </div>
  );

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h2 className="font-semibold text-lg">{t("fin_dashTitle")}</h2>
        <div className="flex items-end gap-2">
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
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Card label="Sales" value={curSale} extra={<Delta now={curSale} before={prevSale} />} />
        <Card label="Expenses" value={curExp} tone="text-orange-700" extra={<Delta now={curExp} before={prevExp} />} />
        <Card label="Net" value={curSale - curExp} tone={curSale - curExp >= 0 ? "text-green-700" : "text-red-600"} />
        <Card label={t("fin_arTotal")} value={arTotal} extra={<span className="text-xs text-slate-500">{t("fin_apTotal")}: {fmtMMK(apTotal)}</span>} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <div className="flex flex-wrap gap-6 pb-3 border-b border-slate-100">
          <div>
            <div className="text-xs text-slate-500 uppercase">{t("fin_cashTotal")}</div>
            <div className="text-lg font-bold text-green-700">{fmtMMK(cashTotal)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">{t("fin_bankTotal")}</div>
            <div className="text-lg font-bold text-green-700">{fmtMMK(bankTotal)}</div>
          </div>
        </div>
        {/* only the wallets holding something are worth a line */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 pt-3">
          {cash.filter((c) => (c.is_cash || c.is_bank) && n(c.balance) !== 0).map((c) => (
            <div key={c.id} className="flex justify-between text-sm">
              <span className="text-slate-600">{accName(c)}</span>
              <span className="font-medium">{fmtMMK(n(c.balance))}</span>
            </div>
          ))}
        </div>
      </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {QUICK_LINKS.filter((l) => hasPermission(profile, l.key)).map((l) => (
          <Link key={l.key} href={l.href}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-50">
            {t(l.labelKey)}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Compare title="Sales by channel" rows={byChannel} />
        <Compare title="Sales by store" rows={byStore} />
      </div>
    </div>
  );
}
