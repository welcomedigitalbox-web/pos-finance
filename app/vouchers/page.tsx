"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import type { TranslationKey } from "@/app/i18n";
import {
  fmtMMK,
  fmtNum,
  lineTotal,
  loadAccounts,
  loadParties,
  today,
  voucherTotals,
  STATUS_COLORS,
  type Channel,
  type FinAccount,
  type FinVoucher,
  type FinVoucherItem,
  type PartyOption,
  type PartyType,
  type VoucherKind,
  type VoucherStatus,
  errorText,
} from "@/lib/finance";

const KINDS: VoucherKind[] = ["sale", "purchase", "income", "expense"];
const STATUSES: VoucherStatus[] = ["unpaid", "partial", "paid"];
const CHANNELS: Channel[] = ["showroom", "wholesale", "online", "salesman", "other"];

type Product = { id: string; name: string; sku: string | null; price: number };
type Rep = { id: string; name: string };

type Line = FinVoucherItem & { key: string };

type Draft = {
  id?: string;
  kind: VoucherKind;
  voucher_date: string;
  due_date: string;
  store_id: string;
  channel: Channel;
  sale_rep_id: string;
  party_type: PartyType;
  party_id: string;
  party_name: string;
  trade_discount: number;
  cash_discount_pct: number;
  cash_discount_days: number;
  tax_percent: number;
  note: string;
  items: Line[];
};

function newLine(): Line {
  return {
    key: Math.random().toString(36).slice(2),
    product_id: null,
    description: "",
    qty: 1,
    unit_price: 0,
    trade_discount_pct: 0,
    account_code: "",
  };
}

// Sale/income raise revenue, purchase/expense raise cost - the party side and
// the account list both follow from that one distinction.
function isIncomeSide(kind: VoucherKind) {
  return kind === "sale" || kind === "income";
}

function emptyDraft(storeId: string): Draft {
  return {
    kind: "sale",
    voucher_date: today(),
    due_date: "",
    store_id: storeId,
    channel: "showroom",
    sale_rep_id: "",
    party_type: "customer",
    party_id: "",
    party_name: "",
    trade_discount: 0,
    cash_discount_pct: 0,
    cash_discount_days: 0,
    tax_percent: 0,
    note: "",
    items: [newLine()],
  };
}

const inputCls = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm";
const cellCls = "w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm";

export default function FinanceVouchersPage() {
  const { storeId, stores } = useStore();
  const { profile } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<FinVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [expType, setExpType] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | VoucherKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | VoucherStatus>("all");
  const [storeFilter, setStoreFilter] = useState<"this" | "all">("this");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [payNow, setPayNow] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState("cash");
  const [payAccount, setPayAccount] = useState("");

  const [viewVoucher, setViewVoucher] = useState<FinVoucher | null>(null);
  const [viewItems, setViewItems] = useState<Line[]>([]);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-vouchers")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    loadRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindFilter, statusFilter, storeFilter, from, to, storeId]);

  if (!profile || !hasPermission(profile, "fin-vouchers")) return null;

  async function loadRefs() {
    const [acc, prod, rep, cust, sup] = await Promise.all([
      loadAccounts(),
      supabase.from("products").select("id,name,sku,price").eq("is_active", true).order("name").limit(1000),
      supabase.from("sales_reps").select("id,name"),
      loadParties("customer"),
      loadParties("supplier"),
    ]);
    setAccounts(acc);
    setProducts((prod.data as Product[]) || []);
    setReps((rep.data as Rep[]) || []);
    setCustomers(cust);
    setSuppliers(sup);
  }

  async function load() {
    setLoading(true);
    let q = supabase.from("fin_vouchers").select("*").order("voucher_date", { ascending: false }).limit(500);
    if (kindFilter !== "all") q = q.eq("kind", kindFilter);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (storeFilter === "this" && storeId) q = q.eq("store_id", storeId);
    if (from) q = q.gte("voucher_date", from);
    if (to) q = q.lte("voucher_date", to);
    const { data } = await q;
    setRows((data as FinVoucher[]) || []);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.voucher_no || "").toLowerCase().includes(s) ||
        (r.party_name || "").toLowerCase().includes(s)
    );
  }, [rows, search]);

  const summary = useMemo(() => {
    let total = 0;
    let balance = 0;
    for (const r of visible) {
      total += Number(r.total || 0);
      balance += Number(r.balance || 0);
    }
    return { count: visible.length, total, balance };
  }, [visible]);

  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name || "-";

  const accountLabelOf = (a: FinAccount) => `${a.code} · ${lang === "my" && a.name_my ? a.name_my : a.name}`;

  const cashAccounts = useMemo(() => accounts.filter((a) => a.is_cash || a.is_bank), [accounts]);

  const lineAccounts = useMemo(() => {
    if (!draft) return [];
    const side = accounts.filter((a) =>
      isIncomeSide(draft.kind) ? a.type === "income" : a.type === "expense"
    );
    // Direct or indirect is a property of the account, so choosing one just
    // narrows the list rather than storing a second thing to keep in step.
    if (draft.kind !== "expense" || !expType) return side;
    return side.filter((a) => (a.expense_kind || "indirect") === expType);
  }, [accounts, draft]);

  const parties = useMemo(() => {
    if (!draft) return [];
    return draft.party_type === "supplier" ? suppliers : customers;
  }, [draft, customers, suppliers]);

  const totals = useMemo(
    () =>
      draft
        ? voucherTotals(draft.items, draft.trade_discount, draft.tax_percent)
        : { subtotal: 0, taxable: 0, tax: 0, total: 0 },
    [draft]
  );

  // A settled voucher, or one mirrored from a POS sale, is owned by the ledger -
  // reopening it here would let the two disagree.
  function isReadOnly(v: FinVoucher) {
    return v.status === "paid" || v.source_type === "pos_sale";
  }

  function openNew() {
    const d = emptyDraft(storeId || stores[0]?.id || "");
    setDraft(d);
    setPayNow(false);
    setPayAmount(0);
    setPayMethod("cash");
    setPayAccount(cashAccounts[0]?.code || "");
  }

  async function loadItems(voucherId: string): Promise<Line[]> {
    const { data } = await supabase
      .from("fin_voucher_items")
      .select("id,line_no,product_id,description,qty,unit_price,trade_discount_pct,line_total,account_id,fin_accounts(code)")
      .eq("voucher_id", voucherId)
      .order("line_no");
    type Raw = FinVoucherItem & { fin_accounts: { code: string } | { code: string }[] | null };
    return ((data as Raw[]) || []).map((r) => {
      const acc = Array.isArray(r.fin_accounts) ? r.fin_accounts[0] : r.fin_accounts;
      return {
        key: Math.random().toString(36).slice(2),
        product_id: r.product_id,
        description: r.description,
        qty: Number(r.qty),
        unit_price: Number(r.unit_price),
        trade_discount_pct: Number(r.trade_discount_pct || 0),
        line_total: Number(r.line_total || 0),
        account_id: r.account_id ?? null,
        account_code: acc?.code || "",
      };
    });
  }

  async function openRow(v: FinVoucher) {
    const items = await loadItems(v.id);
    if (isReadOnly(v)) {
      setViewVoucher(v);
      setViewItems(items);
      return;
    }
    setDraft({
      id: v.id,
      kind: v.kind,
      voucher_date: v.voucher_date,
      due_date: v.due_date || "",
      store_id: v.store_id || storeId,
      channel: (v.channel as Channel) || "showroom",
      sale_rep_id: v.sale_rep_id || "",
      party_type: v.party_type,
      party_id: v.party_id || "",
      party_name: v.party_name || "",
      trade_discount: Number(v.trade_discount || 0),
      cash_discount_pct: Number(v.cash_discount_pct || 0),
      cash_discount_days: Number(v.cash_discount_days || 0),
      tax_percent: Number(v.tax_percent || 0),
      note: v.note || "",
      items: items.length ? items : [newLine()],
    });
    setPayNow(false);
    setPayAmount(0);
    setPayMethod("cash");
    setPayAccount(cashAccounts[0]?.code || "");
  }

  function patch(p: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function setKind(kind: VoucherKind) {
    setDraft((d) =>
      d
        ? {
            ...d,
            kind,
            party_type: isIncomeSide(kind) ? "customer" : "supplier",
            party_id: "",
            items: d.items.map((i) => ({ ...i, account_code: "" })),
          }
        : d
    );
  }

  function patchLine(key: string, p: Partial<Line>) {
    setDraft((d) =>
      d ? { ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...p } : i)) } : d
    );
  }

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) {
      patchLine(key, { product_id: null });
      return;
    }
    patchLine(key, { product_id: p.id, description: p.name, unit_price: Number(p.price || 0) });
  }

  async function save() {
    if (!draft) return;
    const items = draft.items.filter((i) => i.description.trim() !== "" || Number(i.qty) !== 0);
    if (!draft.party_name.trim() && !draft.party_id) {
      showToast(t("fin_required"));
      return;
    }
    if (items.length === 0) {
      showToast(t("fin_required"));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        id: draft.id,
        kind: draft.kind,
        voucher_date: draft.voucher_date,
        due_date: draft.due_date || null,
        store_id: draft.store_id || null,
        channel: draft.kind === "sale" ? draft.channel : null,
        sale_rep_id: draft.kind === "sale" && draft.channel === "salesman" ? draft.sale_rep_id || null : null,
        sale_rep_name:
          draft.kind === "sale" && draft.channel === "salesman"
            ? reps.find((r) => r.id === draft.sale_rep_id)?.name || null
            : null,
        party_type: draft.party_type,
        party_id: draft.party_id || null,
        party_name:
          draft.party_name.trim() ||
          parties.find((p) => p.id === draft.party_id)?.name ||
          "",
        trade_discount: Number(draft.trade_discount || 0),
        cash_discount_pct: Number(draft.cash_discount_pct || 0),
        cash_discount_days: Number(draft.cash_discount_days || 0),
        tax_percent: Number(draft.tax_percent || 0),
        note: draft.note || null,
        items: items.map((i) => ({
          description: i.description,
          product_id: i.product_id || null,
          qty: Number(i.qty || 0),
          unit_price: Number(i.unit_price || 0),
          trade_discount_pct: Number(i.trade_discount_pct || 0),
          account_code: i.account_code || null,
        })),
      };
      if (payNow) {
        payload.payment = {
          amount: Number(payAmount || 0),
          method: payMethod,
          account_code: payAccount || null,
          payment_date: draft.voucher_date,
        };
      }
      const { error } = await supabase.rpc("fin_save_voucher", { p: payload });
      if (error) throw error;
      showToast(t("fin_saved"));
      setDraft(null);
      await load();
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pt-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold text-lg">{t("fin_vouchersTitle")}</h2>
        <button
          onClick={openNew}
          className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-semibold"
        >
          + {t("fin_newVoucher")}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_no")}</div>
          <div className="text-xl font-bold mt-1">{summary.count}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_total")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(summary.total)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_outstanding")}</div>
          <div className="text-lg font-bold mt-1 text-orange-600">{fmtMMK(summary.balance)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "all" | VoucherKind)}
        >
          <option value="all">{t("fin_all")}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>{t(`fin_kind_${k}` as TranslationKey)}</option>
          ))}
        </select>
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | VoucherStatus)}
        >
          <option value="all">{t("fin_all")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`fin_status_${s}` as TranslationKey)}</option>
          ))}
        </select>
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value as "this" | "all")}
        >
          <option value="this">{storeName(storeId)}</option>
          <option value="all">{t("fin_all")}</option>
        </select>
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label={t("fin_from")}
        />
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label={t("fin_to")}
        />
        <input
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]"
          placeholder={t("fin_search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_kind")}</th>
              <th className="text-left px-3 py-2">{t("fin_party")}</th>
              <th className="text-left px-3 py-2">{t("fin_channel")}</th>
              <th className="text-right px-3 py-2">{t("fin_total")}</th>
              <th className="text-right px-3 py-2">{t("fin_paid")}</th>
              <th className="text-right px-3 py-2">{t("fin_balance")}</th>
              <th className="text-left px-3 py-2">{t("fin_status")}</th>
              <th className="text-right px-3 py-2">{t("fin_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading && visible.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{v.voucher_date}</td>
                <td className="px-3 py-2 font-mono text-xs">{v.voucher_no}</td>
                <td className="px-3 py-2">
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                    {t(`fin_kind_${v.kind}` as TranslationKey)}
                  </span>
                </td>
                <td className="px-3 py-2">{v.party_name || "-"}</td>
                <td className="px-3 py-2 text-slate-500">
                  {v.channel ? t(`fin_channel_${v.channel}` as TranslationKey) : "-"}
                </td>
                <td className="px-3 py-2 text-right font-medium">{fmtNum(v.total)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(v.paid_amount)}</td>
                <td className="px-3 py-2 text-right font-medium text-orange-600">{fmtNum(v.balance)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[v.status] || ""}`}>
                    {t(`fin_status_${v.status}` as TranslationKey)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openRow(v)} className="text-blue-600 text-xs font-medium">
                    {isReadOnly(v) ? t("fin_view") : t("fin_edit")}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={10} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 bg-black/30 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-5xl shadow-lg my-4 max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
              <h3 className="font-semibold text-lg">
                {draft.id ? t("fin_edit") : t("fin_newVoucher")}
              </h3>
              <button onClick={() => setDraft(null)} className="text-slate-400 text-sm">✕</button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500">{t("fin_kind")}</label>
                  <select className={inputCls} value={draft.kind}
                    onChange={(e) => setKind(e.target.value as VoucherKind)}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{t(`fin_kind_${k}` as TranslationKey)}</option>
                    ))}
                  </select>
                </div>
                {draft.kind === "expense" && (
                  <div>
                    <label className="text-xs text-slate-500">Expense type</label>
                    <select className={inputCls} value={expType}
                      onChange={(e) => setExpType(e.target.value)}>
                      <option value="">All</option>
                      <option value="direct">Direct</option>
                      <option value="indirect">Indirect</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-500">{t("fin_date")}</label>
                  <input type="date" className={inputCls} value={draft.voucher_date}
                    onChange={(e) => patch({ voucher_date: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">{t("fin_dueDate")}</label>
                  <input type="date" className={inputCls} value={draft.due_date}
                    onChange={(e) => patch({ due_date: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">{t("fin_store")}</label>
                  <select className={inputCls} value={draft.store_id}
                    onChange={(e) => patch({ store_id: e.target.value })}>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">{t("fin_party")}</label>
                  <select className={inputCls} value={draft.party_type}
                    onChange={(e) => patch({ party_type: e.target.value as PartyType, party_id: "" })}>
                    <option value="customer">{t("fin_customer")}</option>
                    <option value="supplier">{t("fin_supplier")}</option>
                    <option value="other">{t("fin_all")}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">
                    {draft.party_type === "supplier" ? t("fin_supplier") : t("fin_customer")}
                  </label>
                  <select className={inputCls} value={draft.party_id}
                    onChange={(e) => {
                      const p = parties.find((x) => x.id === e.target.value);
                      patch({ party_id: e.target.value, party_name: p?.name || draft.party_name });
                    }}>
                    <option value="">-</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="text-xs text-slate-500">{t("fin_party")}</label>
                  <input className={inputCls} value={draft.party_name}
                    onChange={(e) => patch({ party_name: e.target.value, party_id: "" })} />
                </div>

                {draft.kind === "sale" && (
                  <>
                    <div>
                      <label className="text-xs text-slate-500">{t("fin_channel")}</label>
                      <select className={inputCls} value={draft.channel}
                        onChange={(e) => patch({ channel: e.target.value as Channel })}>
                        {CHANNELS.map((c) => (
                          <option key={c} value={c}>{t(`fin_channel_${c}` as TranslationKey)}</option>
                        ))}
                      </select>
                    </div>
                    {draft.channel === "salesman" && (
                      <div>
                        <label className="text-xs text-slate-500">{t("fin_salesRep")}</label>
                        <select className={inputCls} value={draft.sale_rep_id}
                          onChange={(e) => patch({ sale_rep_id: e.target.value })}>
                          <option value="">-</option>
                          {reps.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}

                <div className="sm:col-span-3">
                  <label className="text-xs text-slate-500">{t("fin_note")}</label>
                  <input className={inputCls} value={draft.note}
                    onChange={(e) => patch({ note: e.target.value })} />
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-2 py-2 w-[22%]">{t("fin_description")}</th>
                      <th className="text-left px-2 py-2 w-[18%]">{t("nav_products")}</th>
                      <th className="text-left px-2 py-2 w-[18%]">{t("fin_account")}</th>
                      <th className="text-right px-2 py-2">{t("fin_qty")}</th>
                      <th className="text-right px-2 py-2">{t("fin_unitPrice")}</th>
                      <th className="text-right px-2 py-2">%</th>
                      <th className="text-right px-2 py-2">{t("fin_lineTotal")}</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.items.map((it) => (
                      <tr key={it.key} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-2">
                          <input className={cellCls} value={it.description}
                            onChange={(e) => patchLine(it.key, { description: e.target.value })} />
                        </td>
                        <td className="px-2 py-2">
                          <select className={cellCls} value={it.product_id || ""}
                            onChange={(e) => pickProduct(it.key, e.target.value)}>
                            <option value="">-</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>{p.sku ? `${p.sku} · ` : ""}{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select className={cellCls} value={it.account_code || ""}
                            onChange={(e) => patchLine(it.key, { account_code: e.target.value })}>
                            <option value="">-</option>
                            {lineAccounts.map((a) => (
                              <option key={a.id} value={a.code}>{accountLabelOf(a)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" className={`${cellCls} text-right`} value={it.qty}
                            onChange={(e) => patchLine(it.key, { qty: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" className={`${cellCls} text-right`} value={it.unit_price}
                            onChange={(e) => patchLine(it.key, { unit_price: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" className={`${cellCls} text-right`} value={it.trade_discount_pct}
                            onChange={(e) => patchLine(it.key, { trade_discount_pct: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2 text-right font-medium whitespace-nowrap">
                          {fmtNum(lineTotal(it))}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={() =>
                              patch({
                                items:
                                  draft.items.length > 1
                                    ? draft.items.filter((x) => x.key !== it.key)
                                    : [newLine()],
                              })
                            }
                            className="text-red-500 text-xs"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={() => patch({ items: [...draft.items, newLine()] })}
                className="text-blue-600 text-sm font-medium"
              >
                + {t("fin_addLine")}
              </button>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-500">{t("fin_cashDiscount")}</label>
                    <div className="flex gap-2">
                      <input type="number" className={inputCls} value={draft.cash_discount_pct}
                        onChange={(e) => patch({ cash_discount_pct: Number(e.target.value) })} />
                      <input type="number" className={inputCls} value={draft.cash_discount_days}
                        onChange={(e) => patch({ cash_discount_days: Number(e.target.value) })} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{t("fin_cashDiscountHint")}</p>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-3">
                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => setPayNow(false)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                          !payNow ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600"
                        }`}
                      >
                        {t("fin_payLater")}
                      </button>
                      <button
                        onClick={() => {
                          setPayNow(true);
                          setPayAmount(totals.total);
                          if (!payAccount) setPayAccount(cashAccounts[0]?.code || "");
                        }}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                          payNow ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600"
                        }`}
                      >
                        {t("fin_payNow")}
                      </button>
                    </div>
                    {payNow && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-500">{t("fin_amount")}</label>
                          <input type="number" className={inputCls} value={payAmount}
                            onChange={(e) => setPayAmount(Number(e.target.value))} />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">{t("fin_method")}</label>
                          <select className={inputCls} value={payMethod}
                            onChange={(e) => setPayMethod(e.target.value)}>
                            <option value="cash">{t("fin_isCash")}</option>
                            <option value="bank">{t("fin_isBank")}</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">{t("fin_paidVia")}</label>
                          <select className={inputCls} value={payAccount}
                            onChange={(e) => setPayAccount(e.target.value)}>
                            <option value="">-</option>
                            {cashAccounts.map((a) => (
                              <option key={a.id} value={a.code}>{accountLabelOf(a)}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t("fin_subtotal")}</span>
                    <span className="font-medium">{fmtMMK(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-slate-500">{t("fin_tradeDiscount")}</span>
                    <input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-32 text-right"
                      value={draft.trade_discount}
                      onChange={(e) => patch({ trade_discount: Number(e.target.value) })} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t("fin_subtotal")}</span>
                    <span className="font-medium">{fmtMMK(totals.taxable)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-slate-500">{t("fin_tax")} %</span>
                    <input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-32 text-right"
                      value={draft.tax_percent}
                      onChange={(e) => patch({ tax_percent: Number(e.target.value) })} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t("fin_tax")}</span>
                    <span className="font-medium">{fmtMMK(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="font-semibold">{t("fin_total")}</span>
                    <span className="font-bold text-lg">{fmtMMK(totals.total)}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setDraft(null)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                  {t("fin_cancel")}
                </button>
                <button onClick={save} disabled={saving}
                  className="flex-1 py-2.5 bg-green-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
                  {saving ? "..." : t("fin_save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewVoucher && (
        <div className="fixed inset-0 bg-black/30 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-lg my-4 max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">{viewVoucher.voucher_no}</h3>
                <p className="text-xs text-slate-500">
                  {viewVoucher.voucher_date} · {viewVoucher.party_name || "-"} ·{" "}
                  {t(`fin_kind_${viewVoucher.kind}` as TranslationKey)}
                </p>
              </div>
              <button onClick={() => setViewVoucher(null)} className="text-slate-400 text-sm">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">{t("fin_description")}</th>
                      <th className="text-right px-3 py-2">{t("fin_qty")}</th>
                      <th className="text-right px-3 py-2">{t("fin_unitPrice")}</th>
                      <th className="text-right px-3 py-2">{t("fin_lineTotal")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewItems.map((i, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-3 py-2">{i.description}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(i.qty)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(i.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtNum(i.line_total ?? lineTotal(i))}</td>
                      </tr>
                    ))}
                    {viewItems.length === 0 && (
                      <tr><td colSpan={4} className="text-center text-slate-400 py-6">{t("fin_empty")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">{t("fin_subtotal")}</span><span>{fmtMMK(viewVoucher.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("fin_tradeDiscount")}</span><span>{fmtMMK(viewVoucher.trade_discount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("fin_tax")}</span><span>{fmtMMK(viewVoucher.tax_amount)}</span></div>
                <div className="flex justify-between border-t border-slate-200 pt-1"><span className="font-semibold">{t("fin_total")}</span><span className="font-bold">{fmtMMK(viewVoucher.total)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("fin_paid")}</span><span>{fmtMMK(viewVoucher.paid_amount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("fin_balance")}</span><span className="font-medium text-orange-600">{fmtMMK(viewVoucher.balance)}</span></div>
              </div>
              <button onClick={() => setViewVoucher(null)}
                className="w-full py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                {t("fin_cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
