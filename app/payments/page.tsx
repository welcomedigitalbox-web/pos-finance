"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import {
  fmtMMK,
  fmtNum,
  today,
  loadAccounts,
  loadParties,
  accountLabel,
  type FinAccount,
  type PartyOption,
  type Ageing,
} from "@/lib/finance";

type PaymentRow = {
  id: string;
  payment_no: string;
  payment_date: string;
  direction: "in" | "out";
  store_id: string | null;
  account_id: string;
  method: string | null;
  party_type: string;
  party_id: string | null;
  party_name: string | null;
  amount: number;
  discount_amount: number;
  unallocated: number;
  reference: string | null;
  note: string | null;
};

type AllocationRow = {
  id: string;
  voucher_id: string;
  amount: number;
  discount_amount: number;
  fin_vouchers: { voucher_no: string; voucher_date: string; total: number } | null;
};

// One editable line in the modal: the outstanding voucher plus what the
// user is putting against it right now.
type AllocDraft = { voucher: Ageing; amount: string; discount: string };

const METHODS = ["cash", "bank", "kpay", "wave", "cheque", "transfer", "other"];

export default function FinancePaymentsPage() {
  const { storeId, stores } = useStore();
  const { profile } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");
  const [storeFilter, setStoreFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const [detail, setDetail] = useState<PaymentRow | null>(null);
  const [detailAllocs, setDetailAllocs] = useState<AllocationRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modalDir, setModalDir] = useState<"in" | "out" | null>(null);
  const [saving, setSaving] = useState(false);
  const [payDate, setPayDate] = useState(today());
  const [payStore, setPayStore] = useState("");
  const [partyId, setPartyId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [method, setMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [allocs, setAllocs] = useState<AllocDraft[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-payments")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    loadAccounts().then(setAccounts);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirFilter, storeFilter, from, to]);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("fin_payments")
      .select("*")
      .order("payment_date", { ascending: false })
      .order("payment_no", { ascending: false })
      .limit(500);
    if (dirFilter !== "all") q = q.eq("direction", dirFilter);
    if (storeFilter) q = q.eq("store_id", storeFilter);
    if (from) q = q.gte("payment_date", from);
    if (to) q = q.lte("payment_date", to);
    const { data } = await q;
    setRows((data as PaymentRow[]) || []);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function openDetail(row: PaymentRow) {
    setDetail(row);
    setDetailAllocs([]);
    setDetailLoading(true);
    const { data } = await supabase
      .from("fin_payment_allocations")
      .select("id,voucher_id,amount,discount_amount,fin_vouchers(voucher_no,voucher_date,total)")
      .eq("payment_id", row.id);
    setDetailAllocs((data as unknown as AllocationRow[]) || []);
    setDetailLoading(false);
  }

  async function openModal(dir: "in" | "out") {
    setModalDir(dir);
    setPayDate(today());
    setPayStore(storeFilter || storeId || "");
    setPartyId("");
    setPartyName("");
    setMethod("cash");
    setAmount("");
    setDiscount("");
    setReference("");
    setNote("");
    setAllocs([]);
    const cashAcc = accounts.find((a) => a.is_cash) || accounts.find((a) => a.is_bank);
    setAccountId(cashAcc?.id || "");
    setParties(await loadParties(dir === "in" ? "customer" : "supplier"));
  }

  async function pickParty(id: string) {
    setPartyId(id);
    const p = parties.find((x) => x.id === id);
    setPartyName(p?.name || "");
    setAllocs([]);
    if (!id || !modalDir) return;
    setAllocLoading(true);
    const { data } = await supabase
      .from(modalDir === "in" ? "fin_receivables" : "fin_payables")
      .select("*")
      .eq("party_id", id)
      .order("voucher_date", { ascending: true });
    setAllocs(
      ((data as Ageing[]) || []).map((v) => ({ voucher: v, amount: "", discount: "" }))
    );
    setAllocLoading(false);
  }

  // Oldest voucher first, capped at each balance, until the payment runs out.
  function autoAllocate() {
    let left = Number(amount || 0);
    setAllocs((prev) =>
      prev.map((r) => {
        const take = Math.min(left, Number(r.voucher.balance || 0));
        left = Math.round((left - take) * 100) / 100;
        return { ...r, amount: take > 0 ? String(take) : "" };
      })
    );
  }

  function setAllocField(idx: number, field: "amount" | "discount", value: string) {
    setAllocs((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  const allocatedTotal = useMemo(
    () => allocs.reduce((s, r) => s + Number(r.amount || 0) + Number(r.discount || 0), 0),
    [allocs]
  );
  const payAmount = Number(amount || 0) + Number(discount || 0);
  const unallocated = Math.round((payAmount - allocatedTotal) * 100) / 100;
  const overAllocated = allocatedTotal > payAmount + 0.001;

  const cashBankAccounts = useMemo(
    () => accounts.filter((a) => a.is_cash || a.is_bank),
    [accounts]
  );

  async function save() {
    if (!modalDir) return;
    if (!payDate || !partyName.trim() || !accountId || Number(amount || 0) <= 0) {
      showToast(t("fin_required"));
      return;
    }
    if (overAllocated) {
      showToast(t("fin_overAllocated"));
      return;
    }
    setSaving(true);
    try {
      const allocations = allocs
        .filter((r) => Number(r.amount || 0) !== 0 || Number(r.discount || 0) !== 0)
        .map((r) => ({
          voucher_id: r.voucher.id,
          amount: Number(r.amount || 0),
          discount_amount: Number(r.discount || 0),
        }));
      const { error } = await supabase.rpc("fin_record_payment", {
        p: {
          payment_date: payDate,
          direction: modalDir,
          store_id: payStore || null,
          account_id: accountId,
          method,
          party_type: modalDir === "in" ? "customer" : "supplier",
          party_id: partyId || null,
          party_name: partyName.trim(),
          amount: Number(amount || 0),
          discount_amount: Number(discount || 0),
          reference: reference || null,
          note: note || null,
          allocations,
        },
      });
      if (error) throw error;
      showToast(t("fin_saved"));
      setModalDir(null);
      await load();
    } catch (err) {
      showToast("❌ " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  const storeName = (id: string | null) =>
    (id && stores.find((s) => s.id === id)?.name) || "-";
  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? accountLabel(a, lang) : "-";
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.party_name || "").toLowerCase().includes(q) ||
        r.payment_no.toLowerCase().includes(q) ||
        (r.reference || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalIn = visible.filter((r) => r.direction === "in").reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = visible.filter((r) => r.direction === "out").reduce((s, r) => s + Number(r.amount), 0);
  const totalUnallocated = visible.reduce((s, r) => s + Number(r.unallocated || 0), 0);

  if (!profile || !hasPermission(profile, "fin-payments")) return null;

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="font-semibold text-lg">{t("fin_paymentsTitle")}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => openModal("in")}
            className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold"
          >
            + {t("fin_receiptFrom")}
          </button>
          <button
            onClick={() => openModal("out")}
            className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold"
          >
            + {t("fin_payTo")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_moneyIn")}</div>
          <div className="text-lg font-bold mt-1 text-green-600">{fmtMMK(totalIn)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_moneyOut")}</div>
          <div className="text-lg font-bold mt-1 text-red-600">{fmtMMK(totalOut)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_unallocated")}</div>
          <div className="text-lg font-bold mt-1 text-orange-600">{fmtMMK(totalUnallocated)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={dirFilter}
          onChange={(e) => setDirFilter(e.target.value as "all" | "in" | "out")}
        >
          <option value="all">{t("fin_all")}</option>
          <option value="in">{t("fin_dir_in")}</option>
          <option value="out">{t("fin_dir_out")}</option>
        </select>
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
        >
          <option value="">{t("fin_store")} — {t("fin_all")}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          title={t("fin_from")}
        />
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          title={t("fin_to")}
        />
        <input
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]"
          placeholder={t("fin_search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1050px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_kind")}</th>
              <th className="text-left px-3 py-2">{t("fin_party")}</th>
              <th className="text-left px-3 py-2">{t("fin_method")}</th>
              <th className="text-left px-3 py-2">{t("fin_account")}</th>
              <th className="text-right px-3 py-2">{t("fin_amount")}</th>
              <th className="text-right px-3 py-2">{t("fin_cashDiscount")}</th>
              <th className="text-right px-3 py-2">{t("fin_unallocated")}</th>
              <th className="text-left px-3 py-2">{t("fin_reference")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr
                key={r.id}
                onClick={() => openDetail(r)}
                className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
              >
                <td className="px-3 py-2">{r.payment_date}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.payment_no}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    r.direction === "in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}>
                    {r.direction === "in" ? t("fin_dir_in") : t("fin_dir_out")}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">{r.party_name || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.method || "-"}</td>
                <td className="px-3 py-2 text-slate-500 text-xs">{accountName(r.account_id)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtMMK(r.amount)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{fmtNum(r.discount_amount)}</td>
                <td className={`px-3 py-2 text-right ${Number(r.unallocated) > 0 ? "text-orange-600 font-medium" : "text-slate-400"}`}>
                  {fmtNum(r.unallocated)}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">{r.reference || "-"}</td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={10} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold text-lg">{detail.payment_no}</h3>
                <p className="text-sm text-slate-500">
                  {detail.payment_date} · {detail.party_name || "-"} ·{" "}
                  {detail.direction === "in" ? t("fin_dir_in") : t("fin_dir_out")}
                </p>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{fmtMMK(detail.amount)}</div>
                <div className="text-xs text-slate-500">{accountName(detail.account_id)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
              <div>
                <div className="text-xs text-slate-500">{t("fin_method")}</div>
                <div>{detail.method || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t("fin_store")}</div>
                <div>{storeName(detail.store_id)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t("fin_cashDiscount")}</div>
                <div>{fmtNum(detail.discount_amount)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t("fin_unallocated")}</div>
                <div>{fmtNum(detail.unallocated)}</div>
              </div>
            </div>

            {detail.reference && (
              <p className="text-sm text-slate-600 mb-2">
                {t("fin_reference")}: {detail.reference}
              </p>
            )}
            {detail.note && <p className="text-sm text-slate-600 mb-2">{detail.note}</p>}

            <h4 className="font-semibold text-sm mt-4 mb-2">{t("fin_allocate")}</h4>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">{t("fin_no")}</th>
                    <th className="text-left px-3 py-2">{t("fin_date")}</th>
                    <th className="text-right px-3 py-2">{t("fin_amount")}</th>
                    <th className="text-right px-3 py-2">{t("fin_cashDiscount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detailLoading && (
                    <tr><td colSpan={4} className="text-center text-slate-400 py-6">{t("fin_loading")}</td></tr>
                  )}
                  {!detailLoading && detailAllocs.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{a.fin_vouchers?.voucher_no || "-"}</td>
                      <td className="px-3 py-2">{a.fin_vouchers?.voucher_date || "-"}</td>
                      <td className="px-3 py-2 text-right">{fmtMMK(a.amount)}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{fmtNum(a.discount_amount)}</td>
                    </tr>
                  ))}
                  {!detailLoading && detailAllocs.length === 0 && (
                    <tr><td colSpan={4} className="text-center text-slate-400 py-6">{t("fin_empty")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => setDetail(null)}
              className="w-full mt-5 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
            >
              {t("fin_cancel")}
            </button>
          </div>
        </div>
      )}

      {modalDir && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg mb-4">
              {modalDir === "in" ? t("fin_receiptFrom") : t("fin_payTo")}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-sm text-slate-600">{t("fin_date")}</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_store")}</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={payStore}
                  onChange={(e) => setPayStore(e.target.value)}
                >
                  <option value="">-</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_method")}</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-sm text-slate-600">
                  {modalDir === "in" ? t("fin_customer") : t("fin_supplier")}
                </label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={partyId}
                  onChange={(e) => pickParty(e.target.value)}
                >
                  <option value="">-</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_party")}</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-sm text-slate-600">{t("fin_account")}</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">-</option>
                  {cashBankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{accountLabel(a, lang)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_reference")}</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-sm text-slate-600">{t("fin_amount")}</label>
                <input
                  type="number"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_cashDiscount")}</label>
                <input
                  type="number"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">{t("fin_cashDiscountHint")}</p>
              </div>
            </div>

            <div className="mb-3">
              <label className="text-sm text-slate-600">{t("fin_note")}</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-2 mt-5 mb-2">
              <h4 className="font-semibold text-sm">{t("fin_outstanding")}</h4>
              <button
                onClick={autoAllocate}
                disabled={allocs.length === 0}
                className="text-xs font-medium text-blue-600 disabled:text-slate-300"
              >
                {t("fin_autoAllocate")}
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">{t("fin_no")}</th>
                    <th className="text-left px-3 py-2">{t("fin_date")}</th>
                    <th className="text-left px-3 py-2">{t("fin_dueDate")}</th>
                    <th className="text-right px-3 py-2">{t("fin_total")}</th>
                    <th className="text-right px-3 py-2">{t("fin_balance")}</th>
                    <th className="text-right px-3 py-2">{t("fin_allocate")}</th>
                    <th className="text-right px-3 py-2">{t("fin_cashDiscount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {allocLoading && (
                    <tr><td colSpan={7} className="text-center text-slate-400 py-6">{t("fin_loading")}</td></tr>
                  )}
                  {!allocLoading && allocs.map((r, i) => (
                    <tr key={r.voucher.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.voucher.voucher_no}</td>
                      <td className="px-3 py-2">{r.voucher.voucher_date}</td>
                      <td className="px-3 py-2 text-slate-500">{r.voucher.due_date || "-"}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(r.voucher.total)}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmtNum(r.voucher.balance)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="w-28 border border-slate-200 rounded-lg px-2 py-1 text-sm text-right"
                          value={r.amount}
                          onChange={(e) => setAllocField(i, "amount", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm text-right"
                          value={r.discount}
                          onChange={(e) => setAllocField(i, "discount", e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                  {!allocLoading && allocs.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-slate-400 py-6">{t("fin_empty")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-4 mt-3 text-sm">
              <span className="text-slate-500">{t("fin_allocate")}</span>
              <span className="font-medium">{fmtMMK(allocatedTotal)}</span>
              <span className="text-slate-500">{t("fin_unallocated")}</span>
              <span className={`font-bold ${overAllocated ? "text-red-600" : "text-slate-900"}`}>
                {fmtMMK(unallocated)}
              </span>
            </div>
            {overAllocated && (
              <p className="text-xs text-red-600 text-right mt-1">{t("fin_overAllocated")}</p>
            )}

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setModalDir(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {t("fin_cancel")}
              </button>
              <button
                onClick={save}
                disabled={saving || overAllocated}
                className="flex-1 py-2.5 bg-green-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
              >
                {saving ? "..." : t("fin_save")}
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
