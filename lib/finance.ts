// Shared types and helpers for the finance module.
//
// Everything that writes to the ledger goes through an RPC in
// supabase/migrations/20260907000001_finance_module.sql, so a page never
// composes a journal itself - it hands the RPC a payload and the database
// decides which accounts are hit.

import { supabase } from "./supabase";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type VoucherKind = "sale" | "purchase" | "income" | "expense";
export type VoucherStatus = "draft" | "unpaid" | "partial" | "paid" | "void";
export type Channel = "showroom" | "wholesale" | "online" | "salesman" | "other";
export type PartyType = "customer" | "supplier" | "staff" | "other";
export type DocType =
  | "quotation" | "purchase_order" | "gdn" | "invoice" | "credit_note"
  | "debit_note" | "remittance_advice" | "receipt" | "statement";

export type FinAccount = {
  id: string;
  code: string;
  name: string;
  name_my: string | null;
  type: AccountType;
  parent_code: string | null;
  is_cash: boolean;
  is_bank: boolean;
  is_control: boolean;
  store_id: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  opening_balance: number;
  is_active: boolean;
  sort_order: number;
  note: string | null;
};

export type FinVoucher = {
  id: string;
  voucher_no: string;
  kind: VoucherKind;
  voucher_date: string;
  due_date: string | null;
  store_id: string | null;
  channel: Channel | null;
  sale_rep_id: string | null;
  sale_rep_name: string | null;
  party_type: PartyType;
  party_id: string | null;
  party_name: string | null;
  subtotal: number;
  trade_discount: number;
  cash_discount_pct: number;
  cash_discount_days: number | null;
  tax_percent: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  discount_taken: number;
  balance: number;
  status: VoucherStatus;
  source_type: string | null;
  source_id: string | null;
  journal_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type FinVoucherItem = {
  id?: string;
  line_no?: number;
  product_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  trade_discount_pct: number;
  line_total?: number;
  account_id?: string | null;
  account_code?: string | null;
};

export type FinPayment = {
  id: string;
  payment_no: string;
  payment_date: string;
  direction: "in" | "out";
  store_id: string | null;
  account_id: string;
  method: string | null;
  party_type: PartyType;
  party_id: string | null;
  party_name: string | null;
  amount: number;
  discount_amount: number;
  unallocated: number;
  reference: string | null;
  note: string | null;
  journal_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type FinJournal = {
  id: string;
  journal_no: string;
  journal_date: string;
  journal_type: string;
  store_id: string | null;
  memo: string | null;
  source_type: string | null;
  source_id: string | null;
  is_posted: boolean;
  is_reversed: boolean;
  created_by: string | null;
  created_at: string;
};

export type FinDocument = {
  id: string;
  doc_type: DocType;
  doc_no: string;
  doc_date: string;
  store_id: string | null;
  party_type: PartyType;
  party_id: string | null;
  party_name: string | null;
  party_address: string | null;
  ref_doc_id: string | null;
  voucher_id: string | null;
  payment_id: string | null;
  status: "draft" | "issued" | "checked" | "cancelled";
  checked_by: string | null;
  checked_at: string | null;
  subtotal: number;
  discount: number;
  tax_amount: number;
  total: number;
  valid_until: string | null;
  terms: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type Ageing = { id: string; voucher_no: string; voucher_date: string; due_date: string | null;
  store_id: string | null; channel: Channel | null; party_id: string | null; party_name: string | null;
  sale_rep_name?: string | null; total: number; paid_amount: number; discount_taken: number;
  balance: number; status: VoucherStatus; days_overdue: number; ageing_bucket: string };

export type TrialBalanceRow = {
  account_id: string; code: string; name: string; name_my: string | null;
  type: AccountType; debit: number; credit: number; balance: number;
};

export type LedgerRow = {
  journal_id: string; journal_no: string; journal_date: string; journal_type: string;
  store_id: string | null; memo: string | null; party_name: string | null;
  debit: number; credit: number; running_balance: number;
};

// --------------------------------------------------------------------
// Formatting
// --------------------------------------------------------------------
export function fmtMMK(n: number | string | null | undefined): string {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " MMK";
}

export function fmtNum(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return v === 0 ? "-" : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function accountLabel(a: Pick<FinAccount, "code" | "name" | "name_my">, lang?: string): string {
  const name = lang === "my" && a.name_my ? a.name_my : a.name;
  return `${a.code} · ${name}`;
}

// A voucher line's value after its own trade discount.
export function lineTotal(item: Pick<FinVoucherItem, "qty" | "unit_price" | "trade_discount_pct">): number {
  return (
    Math.round(
      Number(item.qty || 0) * Number(item.unit_price || 0) *
        (1 - Number(item.trade_discount_pct || 0) / 100) * 100
    ) / 100
  );
}

// Voucher arithmetic, kept identical to fin_save_voucher() so the screen
// and the ledger never show different totals.
export function voucherTotals(
  items: FinVoucherItem[],
  tradeDiscount: number,
  taxPercent: number
) {
  const subtotal = items.reduce((s, i) => s + lineTotal(i), 0);
  const taxable = subtotal - Number(tradeDiscount || 0);
  const tax = Math.round((taxable * Number(taxPercent || 0)) / 100 * 100) / 100;
  return { subtotal, taxable, tax, total: taxable + tax };
}

export const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  unpaid: "bg-orange-100 text-orange-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-slate-100 text-slate-400",
  issued: "bg-blue-100 text-blue-700",
  checked: "bg-green-100 text-green-700",
  cancelled: "bg-slate-100 text-slate-400",
};

export const DOC_TYPES: DocType[] = [
  "quotation", "purchase_order", "gdn", "invoice", "credit_note",
  "debit_note", "remittance_advice", "receipt", "statement",
];

// Which document a given one is normally raised from - drives the
// "convert to" action on the documents screen.
export const DOC_FLOW: Partial<Record<DocType, DocType[]>> = {
  quotation: ["purchase_order", "invoice"],
  purchase_order: ["gdn", "invoice"],
  gdn: ["invoice"],
  invoice: ["credit_note", "debit_note", "receipt"],
  remittance_advice: ["receipt"],
};

// --------------------------------------------------------------------
// Loaders shared by several screens
// --------------------------------------------------------------------
export async function loadAccounts(): Promise<FinAccount[]> {
  const { data } = await supabase
    .from("fin_accounts")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .order("code");
  return (data as FinAccount[]) || [];
}

export async function loadSettings(): Promise<Record<string, string>> {
  const { data } = await supabase.from("fin_settings").select("key,value");
  const out: Record<string, string> = {};
  for (const r of (data as { key: string; value: string }[]) || []) out[r.key] = r.value;
  return out;
}

export type PartyOption = { id: string; name: string; type: PartyType };

export async function loadParties(type: "customer" | "supplier"): Promise<PartyOption[]> {
  const table = type === "customer" ? "customers" : "suppliers";
  const { data } = await supabase.from(table).select("id,name").order("name").limit(1000);
  return ((data as { id: string; name: string }[]) || []).map((r) => ({ ...r, type }));
}

// CSV parser used by the import screen. Handles quoted fields and commas
// inside quotes, which is what Excel produces on "Save as CSV".
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
