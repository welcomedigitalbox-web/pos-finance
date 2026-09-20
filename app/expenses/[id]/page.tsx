"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK } from "@/lib/finance";

type Voucher = {
  id: string; voucher_no: string; voucher_date: string; store_id: string | null;
  party_name: string | null; total: number; paid_amount: number; balance: number;
  status: string; note: string | null; created_by: string | null;
};
type Item = { id: string; description: string; qty: number; unit_price: number; line_total: number };
type Pay = { id: string; payment_no: string; payment_date: string; amount: number; method: string | null };

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useLanguage();

  const [v, setV] = useState<Voucher | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: row } = await supabase.from("fin_vouchers").select("*").eq("id", id).maybeSingle();
      setV((row as Voucher) || null);
      const { data: li } = await supabase.from("fin_voucher_items").select("*")
        .eq("voucher_id", id).order("line_no");
      setItems((li as Item[]) || []);
      const { data: al } = await supabase.from("fin_payment_allocations")
        .select("payment_id, amount, fin_payments(payment_no, payment_date, method)")
        .eq("voucher_id", id);
      setPays((((al as unknown) as { payment_id: string; amount: number;
        fin_payments: { payment_no: string; payment_date: string; method: string | null } | null }[]) || [])
        .map((r) => ({
          id: r.payment_id,
          payment_no: r.fin_payments?.payment_no || "-",
          payment_date: r.fin_payments?.payment_date || "-",
          amount: r.amount,
          method: r.fin_payments?.method || null,
        })));
      setLoading(false);
    })();
  }, [id]);

  if (!profile || !hasPermission(profile, "fin-expenses")) return null;
  if (loading) return <div className="pt-16 text-center text-sm text-slate-400">...</div>;
  if (!v) return <div className="pt-16 text-center text-sm text-slate-400">{t("fin_empty")}</div>;

  return (
    <div className="pt-4 max-w-3xl">
      <button onClick={() => router.push("/expenses")} className="text-blue-600 text-sm font-medium mb-3">
        ← {t("nav_finExpenses")}
      </button>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-lg">{v.voucher_no}</h2>
          <p className="text-sm text-slate-500">
            {v.voucher_date}{v.store_id ? " · " + v.store_id : ""} · {v.party_name || "-"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{fmtMMK(v.total)}</div>
          <div className={"text-xs " + (Number(v.balance) > 0 ? "text-orange-600" : "text-slate-400")}>
            {Number(v.balance) > 0 ? t("fin_balance") + " " + fmtMMK(v.balance) : v.status}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-5">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_note")}</th>
              <th className="text-right px-3 py-2">{t("fin_amount")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{it.description}</td>
                <td className="px-3 py-2 text-right">{fmtMMK(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 text-xs text-slate-500 uppercase bg-slate-50">{t("fin_paymentsTitle")}</div>
        <table className="w-full text-sm">
          <tbody>
            {pays.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{p.payment_date}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.payment_no}</td>
                <td className="px-3 py-2 text-slate-500">{p.method || "-"}</td>
                <td className="px-3 py-2 text-right">{fmtMMK(p.amount)}</td>
              </tr>
            ))}
            {pays.length === 0 && (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={4}>{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {v.note && <p className="text-sm text-slate-500 mt-4">{v.note}</p>}
    </div>
  );
}
