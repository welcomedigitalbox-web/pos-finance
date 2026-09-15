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
import { fmtMMK, today, type Ageing, errorText } from "@/lib/finance";

type Bucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
const BUCKETS: Bucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

type CashRow = { id: string; balance: number; is_cash: boolean; is_bank: boolean };

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

const BATCH = 500;

export default function FinanceDashboardPage() {
  const { profile } = useAuth();
  const { storeId, stores } = useStore();
  const { t } = useLanguage();
  const router = useRouter();

  const [ar, setAr] = useState<Ageing[]>([]);
  const [ap, setAp] = useState<Ageing[]>([]);
  const [cash, setCash] = useState<CashRow[]>([]);
  const [toast, setToast] = useState("");

  const [pullFrom, setPullFrom] = useState(monthStart());
  const [pullingPo, setPullingPo] = useState(false);
  const [includeOrdered, setIncludeOrdered] = useState(false);
  const [pullAll, setPullAll] = useState(false);
  const [pullTo, setPullTo] = useState(today());
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    // "/" is this app's own dashboard, so a user without it is sent to the
    // first page they can open rather than back here in a loop.
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
    return (
      <div className="pt-16 text-center text-slate-500 text-sm">{t("fin_noAccess")}</div>
    );
  }

  if (!profile || !hasPermission(profile, "fin-dashboard")) return null;

  async function load() {
    const [arRes, apRes, cashRes] = await Promise.all([
      supabase.from("fin_receivables").select("*"),
      supabase.from("fin_payables").select("*"),
      supabase.from("fin_cash_balances").select("id,balance,is_cash,is_bank"),
    ]);

    setAr((arRes.data as Ageing[]) || []);
    setAp((apRes.data as Ageing[]) || []);
    setCash((cashRes.data as CashRow[]) || []);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function pullPo() {
    setPullingPo(true);
    try {
      const { data, error } = await supabase.rpc("fin_pull_purchase_orders", {
        p_store: storeId,
        p_from: pullAll ? null : pullFrom,
        p_to: pullAll ? null : pullTo,
        p_include_ordered: includeOrdered,
        p_limit: BATCH,
      });
      if (error) throw error;
      const res = (data || {}) as { vouchers?: number; payments?: number };
      const v = res.vouchers ?? 0;
      showToast(
        t("fin_pullPoDone")
          .replace("{v}", String(v))
          .replace("{p}", String(res.payments ?? 0)) +
          (v >= BATCH ? " · " + t("fin_pullMore") : "")
      );
      await load();
    } catch (err) {
      showToast("❌ " + errorText(err));
    } finally {
      setPullingPo(false);
    }
  }

  async function pullPos() {
    setPulling(true);
    try {
      const { data, error } = await supabase.rpc("fin_pull_pos_sales", {
        p_store: storeId,
        p_from: pullAll ? null : pullFrom,
        p_to: pullAll ? null : pullTo,
        p_limit: BATCH,
      });
      if (error) throw error;
      const n = Number(data) || 0;
      showToast(
        t("fin_pullPosDone").replace("{n}", String(n)) +
          (n >= BATCH ? " · " + t("fin_pullMore") : "")
      );
      await load();
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setPulling(false);
    }
  }

  const sum = (rows: Ageing[]) => rows.reduce((s, r) => s + Number(r.balance || 0), 0);

  const arTotal = useMemo(() => sum(ar), [ar]);
  const apTotal = useMemo(() => sum(ap), [ap]);
  const arOverdue = useMemo(() => sum(ar.filter((r) => Number(r.days_overdue) > 0)), [ar]);
  const apOverdue = useMemo(() => sum(ap.filter((r) => Number(r.days_overdue) > 0)), [ap]);
  const cashTotal = useMemo(
    () => cash.filter((c) => c.is_cash).reduce((s, c) => s + Number(c.balance || 0), 0),
    [cash]
  );
  const bankTotal = useMemo(
    () => cash.filter((c) => c.is_bank).reduce((s, c) => s + Number(c.balance || 0), 0),
    [cash]
  );

  const ageing = useMemo(
    () =>
      BUCKETS.map((b) => ({
        bucket: b,
        receivable: sum(ar.filter((r) => r.ageing_bucket === b)),
        payable: sum(ap.filter((r) => r.ageing_bucket === b)),
      })),
    [ar, ap]
  );

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || id : "-");

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-4">{t("fin_dashTitle")}</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_arTotal")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(arTotal)}</div>
          <div className="text-xs text-orange-600 mt-1">
            {t("fin_overdue")}: {fmtMMK(arOverdue)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_apTotal")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(apTotal)}</div>
          <div className="text-xs text-orange-600 mt-1">
            {t("fin_overdue")}: {fmtMMK(apOverdue)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_cashTotal")}</div>
          <div className="text-lg font-bold mt-1 text-green-700">{fmtMMK(cashTotal)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_bankTotal")}</div>
          <div className="text-lg font-bold mt-1 text-green-700">{fmtMMK(bankTotal)}</div>
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

      <h3 className="font-semibold mb-2">{t("fin_ageing")}</h3>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[420px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_ageing")}</th>
              <th className="text-right px-3 py-2">{t("fin_arTotal")}</th>
              <th className="text-right px-3 py-2">{t("fin_apTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {ageing.map((row) => (
              <tr key={row.bucket} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{row.bucket}</td>
                <td className="px-3 py-2 text-right">{fmtMMK(row.receivable)}</td>
                <td className="px-3 py-2 text-right">{fmtMMK(row.payable)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2">{t("fin_total")}</td>
              <td className="px-3 py-2 text-right">{fmtMMK(arTotal)}</td>
              <td className="px-3 py-2 text-right">{fmtMMK(apTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <h3 className="font-semibold mb-1">{t("fin_pullPos")}</h3>
        <p className="text-sm text-slate-500 mb-3">{t("fin_pullPosHint")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-slate-500">{t("fin_from")}</label>
            <input type="date" value={pullFrom} onChange={(e) => setPullFrom(e.target.value)}
              className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t("fin_to")}</label>
            <input type="date" value={pullTo} onChange={(e) => setPullTo(e.target.value)}
              className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t("fin_store")}</label>
            <div className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-slate-50">
              {storeName(storeId)}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 py-2">
            <input type="checkbox" checked={pullAll}
              onChange={(e) => setPullAll(e.target.checked)} />
            {t("fin_pullAll")}
          </label>
          <button onClick={pullPos} disabled={pulling || !storeId}
            className="px-4 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {pulling ? "..." : t("fin_pullPos")}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <h3 className="font-semibold mb-1">{t("fin_pullPo")}</h3>
        <p className="text-sm text-slate-500 mb-3">{t("fin_pullPoHint")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 py-2">
            <input type="checkbox" checked={includeOrdered}
              onChange={(e) => setIncludeOrdered(e.target.checked)} />
            {t("fin_includeOrdered")}
          </label>
          <button onClick={pullPo} disabled={pullingPo || !storeId}
            className="px-4 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {pullingPo ? "..." : t("fin_pullPo")}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          {pullAll ? t("fin_pullAll") : `${t("fin_from")} / ${t("fin_to")}: ${pullFrom} — ${pullTo}`}
        </p>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
