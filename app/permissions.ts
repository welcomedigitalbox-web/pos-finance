// Page access for the finance app.
//
// The roles and the `profiles.permissions` array are the POS system's own -
// both apps sign in against the same Supabase project, so a user's access is
// granted once, on the POS admin screen, and applies here too. This file only
// lists the pages that exist in THIS app.

export type PageKey =
  | "fin-dashboard"
  | "fin-vouchers"
  | "fin-payments"
  | "fin-receivables"
  | "fin-payables"
  | "fin-cashbook"
  | "fin-bank"
  | "fin-journal"
  | "fin-ledger"
  | "fin-trial-balance"
  | "fin-documents"
  | "fin-accounts"
  | "fin-import";

export type UserRole =
  | "cashier"
  | "online_sale"
  | "wholesale"
  | "sale_manager"
  | "merchandising_staff"
  | "warehouse_staff"
  | "accountant"
  | "merchandising_manager"
  | "warehouse_manager"
  | "finance_manager"
  | "marketing_manager"
  | "operation_director"
  | "owner"
  | "admin";

// Screens are grouped the way an accountant works: enter the day's
// transactions, chase what is owed, keep the books, then set things up.
export type PageGroup = "entry" | "outstanding" | "books" | "setup";

export const PAGE_OPTIONS: { key: PageKey; href: string; labelKey: string; group: PageGroup }[] = [
  { key: "fin-dashboard", href: "/", labelKey: "nav_finDashboard", group: "entry" },
  { key: "fin-vouchers", href: "/vouchers", labelKey: "nav_finVouchers", group: "entry" },
  { key: "fin-payments", href: "/payments", labelKey: "nav_finPayments", group: "entry" },
  { key: "fin-documents", href: "/documents", labelKey: "nav_finDocuments", group: "entry" },
  { key: "fin-receivables", href: "/receivables", labelKey: "nav_finReceivables", group: "outstanding" },
  { key: "fin-payables", href: "/payables", labelKey: "nav_finPayables", group: "outstanding" },
  { key: "fin-cashbook", href: "/cashbook", labelKey: "nav_finCashbook", group: "books" },
  { key: "fin-bank", href: "/bank", labelKey: "nav_finBank", group: "books" },
  { key: "fin-journal", href: "/journal", labelKey: "nav_finJournal", group: "books" },
  { key: "fin-ledger", href: "/general-ledger", labelKey: "nav_finLedger", group: "books" },
  { key: "fin-trial-balance", href: "/trial-balance", labelKey: "nav_finTrialBalance", group: "books" },
  { key: "fin-accounts", href: "/accounts", labelKey: "nav_finAccounts", group: "setup" },
  { key: "fin-import", href: "/import", labelKey: "nav_finImport", group: "setup" },
];

export const GROUP_LABELS: Record<PageGroup, string> = {
  entry: "fin_groupEntry",
  outstanding: "fin_groupOutstanding",
  books: "fin_groupBooks",
  setup: "fin_groupSetup",
};

export const ALL_FINANCE_KEYS: PageKey[] = PAGE_OPTIONS.map((p) => p.key);

// Roles that are finance by definition. Anyone else needs the pages granted
// on their profile from the POS admin screen.
const FINANCE_ROLES: string[] = [
  "admin", "owner", "operation_director", "finance_manager", "accountant",
];

export function hasPermission(
  profile: { role: string; permissions: string[] } | null,
  key: PageKey
): boolean {
  if (!profile) return false;
  if (FINANCE_ROLES.includes(profile.role)) return true;
  return profile.permissions?.includes(key) ?? false;
}

// True when the account may open this app at all - used by the shell to show
// a plain "no access" screen instead of an empty nav.
export function hasAnyFinanceAccess(
  profile: { role: string; permissions: string[] } | null
): boolean {
  return !!profile && ALL_FINANCE_KEYS.some((k) => hasPermission(profile, k));
}
