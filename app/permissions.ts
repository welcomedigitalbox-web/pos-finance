// Page access for the finance app.
//
// Finance keeps its own staff list in `fin_users` - a POS account is not a
// finance account and never sees this app. Roles and the per-user page list
// are managed on this app's own Users screen.

export type PageKey =
  | "fin-dashboard"
  | "fin-sales"
  | "fin-vouchers"
  | "fin-expenses"
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
  | "fin-import"
  | "fin-users";

export type FinanceRole = "fin_admin" | "fin_manager" | "accountant" | "viewer";

export const ROLE_OPTIONS: FinanceRole[] = ["fin_admin", "fin_manager", "accountant", "viewer"];

export type FinanceUserLike = {
  role: FinanceRole | string;
  permissions: string[];
  all_stores?: boolean;
};

// Screens are grouped the way an accountant works: enter the day's
// transactions, chase what is owed, keep the books, then set things up.
export type PageGroup = "entry" | "outstanding" | "books" | "setup";

export const PAGE_OPTIONS: { key: PageKey; href: string; labelKey: string; group: PageGroup }[] = [
  { key: "fin-dashboard", href: "/", labelKey: "nav_finDashboard", group: "entry" },
  { key: "fin-sales", href: "/sales", labelKey: "nav_finSales", group: "entry" },
  { key: "fin-vouchers", href: "/vouchers", labelKey: "nav_finVouchers", group: "entry" },
  { key: "fin-expenses", href: "/expenses", labelKey: "nav_finExpenses", group: "entry" },
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
  { key: "fin-users", href: "/users", labelKey: "nav_finUsers", group: "setup" },
];

export const GROUP_LABELS: Record<PageGroup, string> = {
  entry: "fin_groupEntry",
  outstanding: "fin_groupOutstanding",
  books: "fin_groupBooks",
  setup: "fin_groupSetup",
};

export const ALL_FINANCE_KEYS: PageKey[] = PAGE_OPTIONS.map((p) => p.key);

// fin_admin and fin_manager run the whole department, so they get every
// page without anyone maintaining a list. An accountant gets what their row
// grants; a viewer gets the same pages but the database refuses their writes.
const FULL_ACCESS_ROLES: string[] = ["fin_admin", "fin_manager"];

export function hasPermission(profile: FinanceUserLike | null, key: PageKey): boolean {
  if (!profile) return false;
  if (key === "fin-users") return profile.role === "fin_admin";
  if (FULL_ACCESS_ROLES.includes(profile.role)) return true;
  return profile.permissions?.includes(key) ?? false;
}

// True when the account may open this app at all - the shell shows a plain
// "no access" screen instead of an empty nav.
export function hasAnyFinanceAccess(profile: FinanceUserLike | null): boolean {
  return !!profile && ALL_FINANCE_KEYS.some((k) => hasPermission(profile, k));
}

// Whether every branch is in scope, or only the ones on fin_user_stores.
export function coversAllStores(profile: FinanceUserLike | null): boolean {
  if (!profile) return false;
  return FULL_ACCESS_ROLES.includes(profile.role) || !!profile.all_stores;
}

// A viewer reads the books but posts nothing. The database enforces this
// too (fin_can_write); the flag only keeps write buttons off their screen.
export function canPost(profile: FinanceUserLike | null): boolean {
  return !!profile && profile.role !== "viewer";
}

// Pages an accountant starts with when an administrator creates them.
export const DEFAULT_ACCOUNTANT_PAGES: PageKey[] = [
  "fin-dashboard", "fin-sales", "fin-vouchers", "fin-expenses", "fin-payments", "fin-documents",
  "fin-receivables", "fin-payables", "fin-cashbook", "fin-bank",
  "fin-ledger", "fin-trial-balance",
];
