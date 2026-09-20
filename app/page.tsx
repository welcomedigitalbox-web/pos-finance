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

type CashRow = { id: string; balance: number; is_cash: boolean; is_bank: boolean };

type VoucherRow = {
  id: string;
  voucher_date: string;
  kind: string;
  store_id: string | null;
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

const n = (v: unknown) => Number(v || 0);

export default function FinanceDashboardPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const { t } = useLanguage();
  const router = useRouter();

  const [ar, setAr] = useState<Ageing[]>([]);
  const [ap, setAp] = useState<Ageing[]>([]);
  const [cash, setCash] = useState<CashRow[]>([]);
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);

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
  }, []);

  if (profile && !hasAnyFinanceAccess(profile)) {
    return <div className="pt-16 text-center text-slate-500 text-sm">{t("fin_noAccess")}</div>;
  }

  if (!profile || !hasPermission(profile, "fin-dashboard")) return null;

  async function load() {
    // The month so far is what anyone opening this page wants to know.
    const [arRes, apRes, cashRes, vRes] = await Promise.all([
      supabase.from("fin_receivables").select("*"),
      supabase.from("fin_payables").select("*"),
      supabase.from("fin_cash_balances").select("id,balance,is_cash,is_bank"),
      supabase.from("fin_vouchers").select("id,voucher_date,kind,store_id,total")
        .gte("voucher_date", monthStart()).neq("status", "cancelled"),
    ]);
    setAr((arRes.data as Ageing[]) || []);
    setAp((apRes.data as Ageing[]) || []);
    setCash((cashRes.data as CashRow[]) || []);
    setVouchers((vRes.data as VoucherRow[]) || []);
  }

  const sum = (rows: Ageing[]) => rows.reduce((s, r) => s + n(r.balance), 0);

  const arTotal = useMemo(() => sum(ar), [ar]);
  const apTotal = useMemo(() => sum(ap), [ap]);
  const arOverdue = useMemo(() => sum(ar.filter((r) => n(r.days_overdue) > 0)), [ar]);
  const apOverdue = useMemo(() => sum(ap.filter((r) => n(r.days_overdue) > 0)), [ap]);
  const cashTotal = useMemo(() => cash.filter((c) => c.is_cash).reduce((s, c) => s + n(c.balance), 0), [cash]);
  const bankTotal = useMemo(() => cash.filter((c) => c.is_bank).reduce((s, c) => s + n(c.balance), 0), [cash]);

  const vsum = (rows: VoucherRow[]) => rows.reduce((s, r) => s + n(r.total), 0);
  const monthSale = useMemo(() => vsum(vouchers.filter((v) => v.kind === "sale")), [vouchers]);
  const monthExp = useMemo(() => vsum(vouchers.filter((v) => v.kind === "expense")), [vouchers]);
  const todaySale = useMemo(
    () => vsum(vouchers.filter((v) => v.kind === "sale" && v.voucher_date === today())),
    [vouchers]
  );

  const byStore = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of vouchers) if (v.kind === "sale") {
      const k = v.store_id || "-";
      m[k] = (m[k] || 0) + n(v.total);
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [vouchers]);

  const topDebtors = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of ar) {
      const k = r.party_name || "-";
      m[k] = (m[k] || 0) + n(r.balance);
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [ar]);

  const storeName = (id: string) => (id === "-" ? "-" : stores.find((s) => s.id === id)?.name || id);

  const Card = ({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={"text-lg font-bold mt-1 " + (tone || "")}>{fmtMMK(value)}</div>
      {sub && <div className="text-xs text-orange-600 mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-4">{t("fin_dashTitle")}</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Card label={t("fin_arTotal")} value={arTotal} sub={t("fin_overdue") + ": " + fmtMMK(arOverdue)} />
        <Card label={t("fin_apTotal")} value={apTotal} sub={t("fin_overdue") + ": " + fmtMMK(apOverdue)} />
        <Card label={t("fin_cashTotal")} value={cashTotal} tone="text-green-700" />
        <Card label={t("fin_bankTotal")} value={bankTotal} tone="text-green-700" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card label="Sales today" value={todaySale} />
        <Card label="Sales this month" value={monthSale} />
        <Card label="Expenses this month" value={monthExp} tone="text-orange-700" />
        <Card label="Net this month" value={monthSale - monthExp}
          tone={monthSale - monthExp >= 0 ? "text-green-700" : "text-red-600"} />
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
        <div>
          <h3 className="font-semibold mb-2">Sales this month by store</h3>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {byStore.map(([id, amt]) => (
                  <tr key={id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2">{storeName(id)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtMMK(amt)}</td>
                  </tr>
                ))}
                {byStore.length === 0 && (
                  <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={2}>{t("fin_empty")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Who owes the most</h3>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {topDebtors.map(([name, amt]) => (
                  <tr key={name} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2">{name}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtMMK(amt)}</td>
                  </tr>
                ))}
                {topDebtors.length === 0 && (
                  <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={2}>{t("fin_empty")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Link href="/receivables" className="text-blue-600 text-sm font-medium inline-block mt-2">
            {t("nav_finReceivables")} →
          </Link>
        </div>
      </div>
    </div>
  );
}
