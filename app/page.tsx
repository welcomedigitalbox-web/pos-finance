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

// The four spans anyone actually asks for, in the order they ask.
const RANGES: { key: string; label: string; span: () => [string, string] }[] = [
  { key: "today", label: "Today", span: () => [today(), today()] },
  { key: "yesterday", label: "Yesterday", span: () => [shift(today(), -1), shift(today(), -1)] },
  { key: "week", label: "This week", span: () => {
      const d = new Date(today() + "T00:00:00");
      return [shift(today(), -((d.getDay() + 6) % 7)), today()];
    } },
  { key: "month", label: "This month", span: () => [monthStart(), today()] },
];

const n = (v: unknown) => Number(v || 0);

// An order raised by the online shop carries its own reference; anything else
// was rung up at a counter.
function channelOf(v: VoucherRow) {
  const ref = (v.reference || "").toLowerCase();
  if (ref.startsWith("msgr") || ref.startsWith("ebh")) return "Online";
  if ((v.store_id || "").toUpperCase().endsWith("-WH")) return "Online";
  return "Store";
}

export default function FinanceDashboardPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const { t } = useLanguage();
  const router = useRouter();

  const [range, setRange] = useState("month");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const [ar, setAr] = useState<Ageing[]>([]);
  const [ap, setAp] = useState<Ageing[]>([]);
  const [cash, setCash] = useState<CashRow[]>([]);
  const [cur, setCur] = useState<VoucherRow[]>([]);
  const [prev, setPrev] = useState<VoucherRow[]>([]);
  const [shut, setShut] = useState<Record<string, boolean>>({});

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
    const cols = "id,voucher_date,kind,store_id,reference,total";
    const [arRes, apRes, cashRes, curRes, prevRes] = await Promise.all([
      supabase.from("fin_receivables").select("*"),
      supabase.from("fin_payables").select("*"),
      supabase.from("fin_cash_balances").select("*"),
      supabase.from("fin_vouchers").select(cols).gte("voucher_date", from).lte("voucher_date", to).neq("status", "cancelled"),
      supabase.from("fin_vouchers").select(cols).gte("voucher_date", shift(from, -span)).lte("voucher_date", shift(from, -1)).neq("status", "cancelled"),
    ]);
    setAr((arRes.data as Ageing[]) || []);
    setAp((apRes.data as Ageing[]) || []);
    setCash((cashRes.data as CashRow[]) || []);
    setCur((curRes.data as VoucherRow[]) || []);
    setPrev((prevRes.data as VoucherRow[]) || []);
  }

  function pickRange(key: string) {
    const r = RANGES.find((x) => x.key === key);
    if (!r) return;
    const [f, t2] = r.span();
    setRange(key);
    setFrom(f);
    setTo(t2);
  }

  const sum = (rows: Ageing[]) => rows.reduce((s, r) => s + n(r.balance), 0);
  const vsum = (rows: VoucherRow[]) => rows.reduce((s, r) => s + n(r.total), 0);
  const sales = (rows: VoucherRow[]) => vsum(rows.filter((r) => r.kind === "sale"));
  const spend = (rows: VoucherRow[]) => vsum(rows.filter((r) => r.kind === "expense"));

  const arTotal = useMemo(() => sum(ar), [ar]);
  const apTotal = useMemo(() => sum(ap), [ap]);
  const wallets = useMemo(
    () => cash.filter((c) => (c.is_cash || c.is_bank) && n(c.balance) !== 0),
    [cash]
  );
  const walletTotal = useMemo(() => wallets.reduce((s, c) => s + n(c.balance), 0), [wallets]);

  const curSale = useMemo(() => sales(cur), [cur]);
  const prevSale = useMemo(() => sales(prev), [prev]);
  const curExp = useMemo(() => spend(cur), [cur]);
  const prevExp = useMemo(() => spend(prev), [prev]);

  // Store down the side, channel across the top — the shape a pivot would give.
  const pivot = useMemo(() => {
    const chans = new Set<string>();
    const rows: Record<string, Record<string, number>> = {};
    for (const v of cur) {
      if (v.kind !== "sale") continue;
      const c = channelOf(v);
      const s = v.store_id || "-";
      chans.add(c);
      rows[s] = rows[s] || {};
      rows[s][c] = (rows[s][c] || 0) + n(v.total);
    }
    const cols = Array.from(chans).sort();
    const keys = Object.keys(rows).sort(
      (a, b) => Object.values(rows[b]).reduce((x, y) => x + y, 0) - Object.values(rows[a]).reduce((x, y) => x + y, 0)
    );
    return { cols, keys, rows };
  }, [cur]);

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

  function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    const closed = !!shut[id];
    return (
      <div className="mb-5">
        <button onClick={() => setShut({ ...shut, [id]: !closed })}
          className="flex items-center gap-2 font-semibold mb-2">
          <span className="text-slate-400 text-xs">{closed ? "▶" : "▼"}</span>
          {title}
        </button>
        {!closed && children}
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
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => pickRange(r.key)}
                className={"px-3 py-2 rounded-lg text-sm font-medium border " +
                  (range === r.key ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 hover:bg-slate-50")}>
                {r.label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-slate-500">{t("fin_from")}</label>
            <input type="date" value={from} onChange={(e) => { setRange(""); setFrom(e.target.value); }}
              className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t("fin_to")}</label>
            <input type="date" value={to} onChange={(e) => { setRange(""); setTo(e.target.value); }}
              className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card label="Sales" value={curSale} extra={<Delta now={curSale} before={prevSale} />} />
        <Card label="Expenses" value={curExp} tone="text-orange-700" extra={<Delta now={curExp} before={prevExp} />} />
        <Card label="Net" value={curSale - curExp} tone={curSale - curExp >= 0 ? "text-green-700" : "text-red-600"} />
        <Card label={t("fin_arTotal")} value={arTotal}
          extra={<span className="text-xs text-slate-500">{t("fin_apTotal")}: {fmtMMK(apTotal)}</span>} />
      </div>

      <Section id="cash" title="Where the money sits">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
            {wallets.map((c) => (
              <div key={c.id} className="flex justify-between text-sm">
                <span className="text-slate-600">{accName(c)}</span>
                <span className="font-medium">{fmtMMK(n(c.balance))}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-slate-100 mt-3 pt-3 font-semibold">
            <span>{t("fin_total")}</span>
            <span className="text-green-700">{fmtMMK(walletTotal)}</span>
          </div>
        </div>
      </Section>

      <Section id="pivot" title="Sales by store and channel">
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">{t("fin_store")}</th>
                {pivot.cols.map((c) => (<th key={c} className="text-right px-3 py-2">{c}</th>))}
                <th className="text-right px-3 py-2">{t("fin_total")}</th>
              </tr>
            </thead>
            <tbody>
              {pivot.keys.map((k) => {
                const row = pivot.rows[k];
                const tot = Object.values(row).reduce((x, y) => x + y, 0);
                return (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="px-3 py-2">{storeName(k)}</td>
                    {pivot.cols.map((c) => (
                      <td key={c} className="px-3 py-2 text-right">{row[c] ? fmtMMK(row[c]) : "-"}</td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium">{fmtMMK(tot)}</td>
                  </tr>
                );
              })}
              {pivot.keys.length === 0 && (
                <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={pivot.cols.length + 2}>{t("fin_empty")}</td></tr>
              )}
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-2">{t("fin_total")}</td>
                {pivot.cols.map((c) => (
                  <td key={c} className="px-3 py-2 text-right">
                    {fmtMMK(pivot.keys.reduce((s, k) => s + (pivot.rows[k][c] || 0), 0))}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">{fmtMMK(curSale)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <div className="flex flex-wrap gap-2">
        {QUICK_LINKS.filter((l) => hasPermission(profile, l.key)).map((l) => (
          <Link key={l.key} href={l.href}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-50">
            {t(l.labelKey)}
          </Link>
        ))}
      </div>
    </div>
  );
}
