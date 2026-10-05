export type PageKey =
  | "cash-close"
  | "pos"
  | "sale-order"
  | "history"
  | "order-lookup"
  | "returns"
  | "cash-drawer"
  | "customers"
  | "birthdays"
  | "sales-reps"
  | "loyalty-tiers"
  | "products"
  | "inventory"
  | "stock-in"
  | "stock-request"
  | "damage"
  | "incoming-transfers"
  | "barcode"
  | "labels"
  | "ledger"
  | "sales-performance"
  | "warehouse"
  | "stock-transfer"
  | "request-approval"
  | "request-inbox"
  | "to-send"
  | "goods-received"
  | "warehouse-history"
  | "dashboard"
  | "sales-report"
  | "settlements"
  | "my-pin"
  | "product-category"
  | "product-variant"
  | "suppliers"
  | "purchase-orders"
  | "promotions"
  | "consignment"
  | "approvals"
  | "gp-report"
  | "product-grid"
  | "product-import"
  | "stock-import"
  | "uom-import"
  | "ai-agent"
  | "profile"
  | "admin";

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
  | "hr_manager"
  | "it_staff"
  | "marketing_executive"
  | "marketing_assistant"
  | "content_writer"
  | "talent"
  | "operation_director"
  | "owner"
  | "admin";

// Groups are what the sidebar shows, so each is kept to what one person does
// in a day. Anything set up once a season lives under "setup" instead.
export type PageGroup =
  | "sale"
  | "customer"
  | "inventory"
  | "warehouse"
  | "merchandising"
  | "reports"
  | "setup"
  | "ai-agent"
  | "profile";

export const PAGE_OPTIONS: { key: PageKey; href: string; labelKey: string; group: PageGroup }[] = [
  { key: "pos", href: "/pos", labelKey: "nav_pos", group: "sale" },
  { key: "cash-close", href: "/cash-close", labelKey: "nav_cashClose", group: "sale" },
  { key: "sale-order", href: "/sale-order", labelKey: "nav_saleOrder", group: "sale" },
  { key: "history", href: "/history", labelKey: "nav_history", group: "sale" },
  { key: "order-lookup", href: "/order-lookup", labelKey: "nav_orderLookup", group: "sale" },
  { key: "returns", href: "/returns", labelKey: "nav_returns", group: "sale" },
  { key: "cash-drawer", href: "/cash-drawer", labelKey: "nav_cashDrawer", group: "sale" },
  { key: "customers", href: "/customers", labelKey: "nav_customers", group: "customer" },
  { key: "birthdays", href: "/birthdays", labelKey: "nav_birthdays", group: "customer" },
  { key: "sales-reps", href: "/sales-reps", labelKey: "nav_salesReps", group: "customer" },
  { key: "loyalty-tiers", href: "/loyalty-tiers", labelKey: "nav_loyaltyTiers", group: "customer" },
  { key: "sales-performance", href: "/ledger", labelKey: "nav_salesPerformance", group: "reports" },
  { key: "products", href: "/products", labelKey: "nav_products", group: "merchandising" },
  { key: "product-grid", href: "/product-grid", labelKey: "nav_productGrid", group: "merchandising" },
  { key: "product-import", href: "/product-import", labelKey: "nav_productImport", group: "setup" },
  { key: "stock-import", href: "/stock-import", labelKey: "nav_stockImport", group: "setup" },
  { key: "inventory", href: "/inventory", labelKey: "nav_inventory", group: "inventory" },
  { key: "stock-in", href: "/stock-in", labelKey: "nav_stockIn", group: "inventory" },
  { key: "stock-request", href: "/stock-request", labelKey: "nav_stockRequest", group: "inventory" },
  { key: "damage", href: "/damage", labelKey: "nav_damage", group: "inventory" },
  { key: "incoming-transfers", href: "/incoming-transfers", labelKey: "nav_incomingTransfers", group: "inventory" },
  { key: "barcode", href: "/barcode", labelKey: "nav_barcode", group: "setup" },
  { key: "warehouse", href: "/warehouse", labelKey: "nav_warehouse", group: "warehouse" },
  { key: "goods-received", href: "/goods-received", labelKey: "nav_goodsReceived", group: "warehouse" },
  // Printing the stickers belongs beside receiving the goods, because
  // that is when they are printed.
  { key: "labels", href: "/labels", labelKey: "nav_labels", group: "warehouse" },
  { key: "request-approval", href: "/request-approval", labelKey: "nav_requestApproval", group: "sale" },
  { key: "request-inbox", href: "/request-inbox", labelKey: "nav_requestInbox", group: "warehouse" },
  { key: "to-send", href: "/to-send", labelKey: "toSend_title", group: "warehouse" },
  { key: "stock-transfer", href: "/stock-transfer", labelKey: "nav_stockTransfer", group: "warehouse" },
  { key: "warehouse-history", href: "/warehouse-history", labelKey: "nav_warehouseHistory", group: "warehouse" },
  { key: "ledger", href: "/stock-ledger", labelKey: "nav_ledger", group: "inventory" },
  { key: "product-category", href: "/product-category", labelKey: "nav_productCategory", group: "merchandising" },
  { key: "product-variant", href: "/product-variant", labelKey: "nav_productVariant", group: "merchandising" },
  { key: "uom-import", href: "/uom-import", labelKey: "nav_uomImport", group: "merchandising" },
  { key: "purchase-orders", href: "/purchase-orders", labelKey: "nav_purchaseOrders", group: "merchandising" },
  { key: "suppliers", href: "/suppliers", labelKey: "nav_suppliers", group: "merchandising" },
  { key: "promotions", href: "/promotions", labelKey: "nav_promotions", group: "merchandising" },
  { key: "consignment", href: "/consignment", labelKey: "nav_consignment", group: "merchandising" },
  // Approvals sits in the reports group because that is the one group every
  // department head already has, so a new manager finds it without anyone
  // granting them a page by hand.
  { key: "approvals", href: "/approvals", labelKey: "nav_approvals", group: "reports" },
  { key: "gp-report", href: "/gp-report", labelKey: "nav_gpReport", group: "reports" },
  { key: "dashboard", href: "/dashboard", labelKey: "nav_dashboard", group: "reports" },
  { key: "sales-report", href: "/sales-report", labelKey: "nav_salesReport", group: "reports" },
  { key: "settlements", href: "/settlements", labelKey: "nav_settlements", group: "reports" },
  { key: "my-pin", href: "/my-pin", labelKey: "nav_myPin", group: "profile" },
  { key: "ai-agent", href: "/ai-agent", labelKey: "nav_aiAgent", group: "ai-agent" },
  { key: "profile", href: "/profile", labelKey: "nav_profile", group: "profile" },
];

export const GROUP_LABELS: Record<PageGroup, string> = {
  sale: "dept_sale",
  customer: "dept_customer",
  setup: "dept_setup",
  inventory: "dept_inventory",
  warehouse: "dept_warehouse",
  merchandising: "dept_merchandising",
  reports: "dept_reports",
  "ai-agent": "dept_aiAgent",
  profile: "dept_profile",
};

const ALL_KEYS_EXCEPT_ADMIN: PageKey[] = PAGE_OPTIONS.map((p) => p.key);
const ALL_KEYS: PageKey[] = [...ALL_KEYS_EXCEPT_ADMIN, "admin"];

const COMMON_ALL_ROLES: PageKey[] = ["ai-agent", "profile"];

// Built from PAGE_OPTIONS groups rather than hand-listed keys: a new page
// lands in the right roles automatically, and "sale manager gets everything
// on the sale side" stays true instead of drifting as pages are added.
function pagesIn(...groups: PageGroup[]): PageKey[] {
  return PAGE_OPTIONS.filter((p) => groups.includes(p.group)).map((p) => p.key);
}

export const DEFAULT_PERMISSIONS: Record<Exclude<UserRole, "admin">, PageKey[]> = {
  // Tills work one screen at a time, so these stay an explicit short list.
  cashier: [
    "pos", "history", "returns", "cash-drawer", "customers",
    "inventory", "stock-request", "incoming-transfers", "damage",
    "barcode", "sales-performance",
    ...COMMON_ALL_ROLES,
  ],
  online_sale: [
    "sale-order", "history", "order-lookup", "customers",
    "inventory", "warehouse", "sales-performance",
    ...COMMON_ALL_ROLES,
  ],
  wholesale: [
    "sale-order", "history", "customers", "inventory", "sales-performance",
    ...COMMON_ALL_ROLES,
  ],

  // Whole-department roles: everything in their own area, plus reports.
  sale_manager: [...pagesIn("sale", "customer", "reports"), ...COMMON_ALL_ROLES],

  // Staff do the work; their department head signs it off. None of them are
  // dept heads, so can_approve_for() refuses them by construction.
  merchandising_staff: [
    "products", "product-category", "product-variant",
    "suppliers", "purchase-orders", "consignment", "inventory", "barcode",
    ...COMMON_ALL_ROLES,
  ],
  warehouse_staff: [
    "warehouse", "stock-transfer", "request-inbox", "to-send", "goods-received",
    "warehouse-history", "ledger", "inventory", "stock-in", "barcode",
    "incoming-transfers", "damage",
    ...COMMON_ALL_ROLES,
  ],
  accountant: [
    "dashboard", "sales-report", "settlements",
    "history", "order-lookup", "cash-drawer", "sales-performance", "suppliers",
    ...COMMON_ALL_ROLES,
  ],
  merchandising_manager: [
    ...pagesIn("merchandising", "setup", "reports"),
    "inventory",
    ...COMMON_ALL_ROLES,
  ],
  warehouse_manager: [
    ...pagesIn("warehouse", "inventory", "reports"),
    ...COMMON_ALL_ROLES,
  ],
  finance_manager: [
    ...pagesIn("reports"),
    "history", "order-lookup", "cash-drawer", "sales-performance", "suppliers",
    ...COMMON_ALL_ROLES,
  ],
  hr_manager: [
    ...pagesIn("reports"),
    ...COMMON_ALL_ROLES,
  ],
  // The cameras are not the till. IT sees the system, not the takings.
  it_staff: [
    ...COMMON_ALL_ROLES,
  ],
  marketing_executive: [
    ...pagesIn("reports"),
    "customers", "loyalty-tiers", "products",
    ...COMMON_ALL_ROLES,
  ],
  marketing_assistant: [
    "customers", "products",
    ...COMMON_ALL_ROLES,
  ],
  content_writer: [
    "products",
    ...COMMON_ALL_ROLES,
  ],
  talent: [
    "products",
    ...COMMON_ALL_ROLES,
  ],
  marketing_manager: [
    ...pagesIn("reports"),
    "customers", "loyalty-tiers", "products",
    ...COMMON_ALL_ROLES,
  ],
  // The tier above the department heads: approves anything, sees everything.
  operation_director: ALL_KEYS_EXCEPT_ADMIN,
  owner: ALL_KEYS_EXCEPT_ADMIN,
};

export const ROLE_OPTIONS: UserRole[] = [
  "cashier",
  "online_sale",
  "wholesale",
  "sale_manager",
  "merchandising_staff",
  "warehouse_staff",
  "accountant",
  "merchandising_manager",
  "warehouse_manager",
  "finance_manager",
  "marketing_manager",
  "hr_manager",
  "it_staff",
  "marketing_executive",
  "marketing_assistant",
  "content_writer",
  "talent",
  "operation_director",
  "owner",
  "admin",
];

// Pages a role opens on its own, loaded once at sign-in. A person keeps
// whatever they were given one by one; the role only adds to it.
const ROLE_PAGES = new Set<string>();
export function applyRolePages(keys: string[]) {
  ROLE_PAGES.clear();
  for (const k of keys) ROLE_PAGES.add(k);
}

export function hasPermission(
  profile: { role: string; permissions: string[] } | null,
  key: PageKey
): boolean {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  if (ROLE_PAGES.has(key)) return true;
  return profile.permissions?.includes(key) ?? false;
}


// Department heads and above. Pages use this instead of listing role names,
// so adding a role does not mean revisiting every screen.
export const MANAGER_TIER: UserRole[] = [
  "sale_manager", "merchandising_manager", "warehouse_manager",
  "finance_manager", "marketing_manager",
  "operation_director", "owner", "admin",
];

export function isManagerTier(role?: string | null): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

// Who may hold an approval PIN.
export const APPROVER_ROLES: string[] = MANAGER_TIER;


// Which roles exist inside each department. The admin form asks for the
// department first and offers only these, so a warehouse hire cannot be
// saved as a cashier by a slip of the mouse.
export const DEPARTMENT_ROLES: Record<string, UserRole[]> = {
  sale: ["cashier", "online_sale", "wholesale", "sale_manager"],
  merchandising: ["merchandising_staff", "merchandising_manager"],
  warehouse: ["warehouse_staff", "warehouse_manager"],
  finance: ["accountant", "finance_manager"],
  office_support: ["it_staff", "hr_manager"],
  marketing: ["talent", "content_writer", "marketing_assistant", "marketing_executive", "marketing_manager"],
};

// Company-wide posts that sit outside any one department.
export const COMPANY_ROLES: UserRole[] = ["operation_director", "owner", "admin"];
