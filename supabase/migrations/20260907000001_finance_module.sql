-- =====================================================================
-- 20260907000001: Finance module
-- Repo path: supabase/migrations/20260907000001_finance_module.sql
--
-- Adds a double-entry accounting layer on top of the POS:
--
--   fin_accounts        - chart of accounts (account code -> account head)
--   fin_journals/_lines - every posting, one balanced journal per event
--   fin_vouchers/_items - sale / purchase / income / expense vouchers,
--                         each unpaid, partial or paid
--   fin_payments        - money in / money out, allocated against
--     /_allocations       vouchers, with cash discount handled here
--   fin_documents       - quotation, PO, GDN, invoice, credit / debit
--     /_items             note, remittance advice, receipt, statement
--   fin_settings        - which account code each posting rule uses
--
-- Nothing in the POS tables is altered. Sales already recorded in
-- `sales` can be pulled into a voucher, but the finance side is its own
-- ledger so a correction here never rewrites a till receipt.
--
-- Idempotent - safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Finance users
--
-- Finance keeps its own accounts. They live in the same Supabase project
-- as the POS - and therefore in the same auth.users pool - but the POS
-- `profiles` table plays no part here: a till account with no fin_users
-- row cannot open this app, and a finance account with no profiles row
-- cannot open the POS. The two staff lists never mix.
--
-- Roles:
--   fin_admin   - everything, including finance user administration
--   fin_manager - everything except user administration, all stores
--   accountant  - the pages granted on their row, the stores assigned
--   viewer      - read only, no posting
-- ---------------------------------------------------------------------
create table if not exists public.fin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text,
  role        text not null default 'accountant'
              check (role in ('fin_admin','fin_manager','accountant','viewer')),
  all_stores  boolean not null default false,
  permissions jsonb not null default '[]'::jsonb,
  is_active   boolean not null default true,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- Which branches an accountant may see. Ignored for roles that cover
-- every store.
create table if not exists public.fin_user_stores (
  user_id  uuid not null references public.fin_users(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  primary key (user_id, store_id)
);

-- ---------------------------------------------------------------------
-- 1. Scope helpers
--
-- Every one of these reads fin_users only, so nothing in the finance
-- ledger depends on a POS role.
-- ---------------------------------------------------------------------
create or replace function public.fin_my_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.fin_users where id = auth.uid() and is_active;
$$;

create or replace function public.is_finance()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fin_my_role() is not null;
$$;

create or replace function public.fin_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fin_my_role() = 'fin_admin';
$$;

-- fin_admin and fin_manager cover the whole business; anyone else covers
-- the branches listed on fin_user_stores, unless all_stores is set.
create or replace function public.fin_covers_all_stores()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role in ('fin_admin','fin_manager') or all_stores
       from public.fin_users where id = auth.uid() and is_active),
    false);
$$;

create or replace function public.fin_can_read(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_finance()
     and (public.fin_covers_all_stores()
          or p_store_id is null
          or exists (select 1 from public.fin_user_stores
                      where user_id = auth.uid() and store_id = p_store_id));
$$;

-- A viewer reads the books but never posts to them.
create or replace function public.fin_can_write(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fin_can_read(p_store_id)
     and coalesce(public.fin_my_role() <> 'viewer', false);
$$;

revoke all on function public.fin_my_role() from public, anon;
revoke all on function public.is_finance() from public, anon;
revoke all on function public.fin_is_admin() from public, anon;
revoke all on function public.fin_covers_all_stores() from public, anon;
revoke all on function public.fin_can_read(text) from public, anon;
revoke all on function public.fin_can_write(text) from public, anon;
grant execute on function public.fin_my_role() to authenticated;
grant execute on function public.is_finance() to authenticated;
grant execute on function public.fin_is_admin() to authenticated;
grant execute on function public.fin_covers_all_stores() to authenticated;
grant execute on function public.fin_can_read(text) to authenticated;
grant execute on function public.fin_can_write(text) to authenticated;

-- Role and permissions are an administrator's to set. RLS already limits
-- writes to fin_admin; this stops a stolen service key or a future policy
-- slip from turning an accountant into an administrator quietly.
create or replace function public.fin_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;                      -- server-side/bootstrap write
  end if;
  if public.fin_is_admin() then
    return new;
  end if;
  if new.role <> old.role
     or new.permissions is distinct from old.permissions
     or new.all_stores <> old.all_stores
     or new.is_active <> old.is_active then
    raise exception 'Only a finance administrator may change role, access or status';
  end if;
  return new;
end;
$$;

drop trigger if exists fin_users_guard on public.fin_users;
create trigger fin_users_guard
  before update on public.fin_users
  for each row execute function public.fin_guard_privileged_columns();

-- ---------------------------------------------------------------------
-- 2. Chart of accounts
-- ---------------------------------------------------------------------
create table if not exists public.fin_accounts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  name_my     text,
  type        text not null check (type in ('asset','liability','equity','income','expense')),
  parent_code text,
  is_cash     boolean not null default false,
  is_bank     boolean not null default false,
  is_control  boolean not null default false,   -- AR / AP: posted to only via vouchers
  store_id    text references public.stores(id) on delete set null, -- null = all stores
  bank_name   text,
  bank_account_no text,
  opening_balance numeric not null default 0,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_fin_accounts_type on public.fin_accounts(type, code);
create index if not exists idx_fin_accounts_store on public.fin_accounts(store_id);

-- ---------------------------------------------------------------------
-- 3. Posting rules - which code each automatic entry hits
-- ---------------------------------------------------------------------
create table if not exists public.fin_settings (
  key        text primary key,
  value      text not null,
  label      text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Document / voucher numbering
-- ---------------------------------------------------------------------
create table if not exists public.fin_counters (
  scope text not null,
  year  integer not null,
  seq   integer not null default 0,
  primary key (scope, year)
);

create or replace function public.next_fin_no(p_kind text, p_store_id text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_year   integer := extract(year from current_date)::int;
  v_scope  text;
  v_seq    integer;
begin
  v_prefix := case p_kind
    when 'sale'             then 'SV'
    when 'purchase'         then 'PV'
    when 'income'           then 'IV'
    when 'expense'          then 'EV'
    when 'receipt'          then 'RC'
    when 'payment'          then 'PY'
    when 'journal'          then 'JV'
    when 'cashbook'         then 'CB'
    when 'bank'             then 'BK'
    when 'quotation'        then 'QT'
    when 'purchase_order'   then 'PO'
    when 'gdn'              then 'GDN'
    when 'invoice'          then 'INV'
    when 'credit_note'      then 'CN'
    when 'debit_note'       then 'DN'
    when 'remittance_advice' then 'RA'
    when 'statement'        then 'ST'
    else upper(left(p_kind, 3))
  end;

  v_scope := v_prefix || coalesce('-' || p_store_id, '');

  insert into public.fin_counters (scope, year, seq)
  values (v_scope, v_year, 1)
  on conflict (scope, year) do update set seq = public.fin_counters.seq + 1
  returning seq into v_seq;

  return v_prefix
      || coalesce('-' || p_store_id, '')
      || '-' || v_year::text
      || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

revoke all on function public.next_fin_no(text, text) from public, anon;
grant execute on function public.next_fin_no(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Journals - the general ledger itself
-- ---------------------------------------------------------------------
create table if not exists public.fin_journals (
  id           uuid primary key default gen_random_uuid(),
  journal_no   text not null unique,
  journal_date date not null default current_date,
  journal_type text not null check (journal_type in
    ('sale','purchase','receipt','payment','cashbook','bank','journal','opening','contra')),
  store_id     text references public.stores(id) on delete set null,
  memo         text,
  source_type  text,          -- 'voucher' | 'payment' | 'sale' | 'manual'
  source_id    uuid,
  is_posted    boolean not null default true,
  is_reversed  boolean not null default false,
  reversal_of  uuid references public.fin_journals(id) on delete set null,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_fin_journals_date on public.fin_journals(journal_date, store_id);
create index if not exists idx_fin_journals_source on public.fin_journals(source_type, source_id);

create table if not exists public.fin_journal_lines (
  id         uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.fin_journals(id) on delete cascade,
  line_no    integer not null default 1,
  account_id uuid not null references public.fin_accounts(id),
  debit      numeric not null default 0 check (debit >= 0),
  credit     numeric not null default 0 check (credit >= 0),
  party_type text,
  party_id   uuid,
  party_name text,
  memo       text,
  created_at timestamptz not null default now(),
  constraint fin_journal_lines_one_side check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0) or (debit = 0 and credit = 0)
  )
);

create index if not exists idx_fin_journal_lines_journal on public.fin_journal_lines(journal_id);
create index if not exists idx_fin_journal_lines_account on public.fin_journal_lines(account_id);

-- A journal that does not balance is a bug, not a state to store.
create or replace function public.fin_assert_balanced(p_journal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dr numeric;
  v_cr numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_dr, v_cr
  from public.fin_journal_lines where journal_id = p_journal_id;

  if round(v_dr, 2) <> round(v_cr, 2) then
    raise exception 'Journal % is out of balance: debit % vs credit %',
      p_journal_id, v_dr, v_cr;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Vouchers - sale / purchase / income / expense, paid or unpaid
-- ---------------------------------------------------------------------
create table if not exists public.fin_vouchers (
  id           uuid primary key default gen_random_uuid(),
  voucher_no   text not null unique,
  kind         text not null check (kind in ('sale','purchase','income','expense')),
  voucher_date date not null default current_date,
  due_date     date,
  store_id     text references public.stores(id) on delete set null,
  channel      text check (channel in ('showroom','wholesale','online','salesman','other')),
  sale_rep_id  uuid references public.sales_reps(id) on delete set null,
  sale_rep_name text,
  party_type   text not null default 'other' check (party_type in ('customer','supplier','staff','other')),
  party_id     uuid,
  party_name   text,
  subtotal        numeric not null default 0,
  trade_discount  numeric not null default 0,   -- deducted on the invoice
  cash_discount_pct numeric not null default 0, -- offered for early settlement
  cash_discount_days integer,
  tax_percent     numeric not null default 0,
  tax_amount      numeric not null default 0,
  total           numeric not null default 0,
  paid_amount     numeric not null default 0,
  discount_taken  numeric not null default 0,   -- cash discount actually given/taken
  balance numeric generated always as (total - paid_amount - discount_taken) stored,
  status       text not null default 'unpaid' check (status in ('draft','unpaid','partial','paid','void')),
  source_type  text,      -- 'pos_sale' when pulled from `sales`
  source_id    uuid,
  journal_id   uuid references public.fin_journals(id) on delete set null,
  note         text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_fin_vouchers_kind on public.fin_vouchers(kind, status, voucher_date);
create index if not exists idx_fin_vouchers_store on public.fin_vouchers(store_id, voucher_date);
create index if not exists idx_fin_vouchers_party on public.fin_vouchers(party_type, party_id);
create unique index if not exists idx_fin_vouchers_source
  on public.fin_vouchers(source_type, source_id) where source_id is not null;

create table if not exists public.fin_voucher_items (
  id          uuid primary key default gen_random_uuid(),
  voucher_id  uuid not null references public.fin_vouchers(id) on delete cascade,
  line_no     integer not null default 1,
  product_id  uuid references public.products(id) on delete set null,
  description text not null,
  qty         numeric not null default 1,
  unit_price  numeric not null default 0,
  trade_discount_pct numeric not null default 0,
  line_total  numeric not null default 0,
  account_id  uuid references public.fin_accounts(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_fin_voucher_items_voucher on public.fin_voucher_items(voucher_id);

-- ---------------------------------------------------------------------
-- 7. Payments and their allocation to vouchers
-- ---------------------------------------------------------------------
create table if not exists public.fin_payments (
  id           uuid primary key default gen_random_uuid(),
  payment_no   text not null unique,
  payment_date date not null default current_date,
  direction    text not null check (direction in ('in','out')),
  store_id     text references public.stores(id) on delete set null,
  account_id   uuid not null references public.fin_accounts(id),  -- cash or bank
  method       text,
  party_type   text not null default 'other' check (party_type in ('customer','supplier','staff','other')),
  party_id     uuid,
  party_name   text,
  amount           numeric not null default 0,
  discount_amount  numeric not null default 0,   -- cash discount on settlement
  unallocated      numeric not null default 0,   -- advance / on account
  reference    text,
  note         text,
  journal_id   uuid references public.fin_journals(id) on delete set null,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_fin_payments_date on public.fin_payments(payment_date, store_id);
create index if not exists idx_fin_payments_party on public.fin_payments(party_type, party_id);

create table if not exists public.fin_payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references public.fin_payments(id) on delete cascade,
  voucher_id      uuid not null references public.fin_vouchers(id) on delete cascade,
  amount          numeric not null default 0,
  discount_amount numeric not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_fin_alloc_payment on public.fin_payment_allocations(payment_id);
create index if not exists idx_fin_alloc_voucher on public.fin_payment_allocations(voucher_id);

-- ---------------------------------------------------------------------
-- 8. Accounting documents (quotation -> ... -> statement)
-- ---------------------------------------------------------------------
create table if not exists public.fin_documents (
  id         uuid primary key default gen_random_uuid(),
  doc_type   text not null check (doc_type in
    ('quotation','purchase_order','gdn','invoice','credit_note','debit_note',
     'remittance_advice','receipt','statement')),
  doc_no     text not null unique,
  doc_date   date not null default current_date,
  store_id   text references public.stores(id) on delete set null,
  party_type text not null default 'customer' check (party_type in ('customer','supplier','staff','other')),
  party_id   uuid,
  party_name text,
  party_address text,
  ref_doc_id uuid references public.fin_documents(id) on delete set null,  -- the document it came from
  voucher_id uuid references public.fin_vouchers(id) on delete set null,
  payment_id uuid references public.fin_payments(id) on delete set null,
  status     text not null default 'draft' check (status in ('draft','issued','checked','cancelled')),
  checked_by text,
  checked_at timestamptz,
  subtotal   numeric not null default 0,
  discount   numeric not null default 0,
  tax_amount numeric not null default 0,
  total      numeric not null default 0,
  valid_until date,
  terms      text,
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fin_documents_type on public.fin_documents(doc_type, doc_date);
create index if not exists idx_fin_documents_party on public.fin_documents(party_type, party_id);

create table if not exists public.fin_document_items (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references public.fin_documents(id) on delete cascade,
  line_no     integer not null default 1,
  product_id  uuid references public.products(id) on delete set null,
  description text not null,
  qty         numeric not null default 1,
  unit_price  numeric not null default 0,
  discount_pct numeric not null default 0,
  line_total  numeric not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_fin_document_items_doc on public.fin_document_items(doc_id);

-- =====================================================================
-- 9. Seed chart of accounts + posting rules (only when empty)
-- =====================================================================
insert into public.fin_accounts (code, name, name_my, type, parent_code, is_cash, is_bank, is_control, sort_order)
values
  ('1000','Cash in Hand',        'လက်ကျန်ငွေသား',        'asset',     null, true,  false, false, 10),
  ('1010','Petty Cash',          'အသေးစား ငွေသား',        'asset',     '1000', true, false, false, 11),
  ('1100','Bank',                'ဘဏ်',                  'asset',     null, false, true,  false, 20),
  ('1200','Accounts Receivable', 'ရရန်ရှိငွေ',            'asset',     null, false, false, true,  30),
  ('1300','Inventory',           'ကုန်ပစ္စည်း လက်ကျန်',    'asset',     null, false, false, false, 40),
  ('1400','Fixed Assets',        'ပုံသေပိုင်ဆိုင်မှု',      'asset',     null, false, false, false, 50),
  ('2000','Accounts Payable',    'ပေးရန်ရှိငွေ',          'liability', null, false, false, true,  60),
  ('2100','Tax Payable',         'အခွန် ပေးရန်',          'liability', null, false, false, false, 70),
  ('2200','Accrued Expenses',    'မပေးရသေးသော ကုန်ကျစရိတ်','liability', null, false, false, false, 80),
  ('3000','Owner Capital',       'ရင်းနှီးမြှုပ်နှံမှု',    'equity',    null, false, false, false, 90),
  ('3100','Retained Earnings',   'သိမ်းဆည်းအမြတ်',        'equity',    null, false, false, false, 100),
  ('4000','Sales Revenue',       'ရောင်းရငွေ',            'income',    null, false, false, false, 110),
  ('4010','Wholesale Sales',     'လက်ကား ရောင်းရငွေ',      'income',    '4000', false, false, false, 111),
  ('4020','Online Sales',        'အွန်လိုင်း ရောင်းရငွေ',   'income',    '4000', false, false, false, 112),
  ('4100','Other Income',        'အခြား ဝင်ငွေ',          'income',    null, false, false, false, 120),
  ('4200','Discount Received',   'ရရှိသော လျှော့ငွေ',      'income',    null, false, false, false, 130),
  ('5000','Cost of Goods Sold',  'ကုန်ကျစရိတ် (COGS)',    'expense',   null, false, false, false, 140),
  ('5100','Purchases',           'ဝယ်ယူမှု',              'expense',   null, false, false, false, 150),
  ('5200','Discount Allowed',    'ပေးလိုက်သော လျှော့ငွေ',  'expense',   null, false, false, false, 160),
  ('5300','Salaries & Wages',    'လစာ',                   'expense',   null, false, false, false, 170),
  ('5400','Rent',                'အငှားခ',                'expense',   null, false, false, false, 180),
  ('5500','Utilities',           'မီး/ရေ/ဖုန်း',           'expense',   null, false, false, false, 190),
  ('5600','Transport & Delivery','သယ်ယူပို့ဆောင်ခ',        'expense',   null, false, false, false, 200),
  ('5700','Marketing',           'ကြော်ငြာ',              'expense',   null, false, false, false, 210),
  ('5900','Other Expenses',      'အခြား ကုန်ကျစရိတ်',      'expense',   null, false, false, false, 220)
on conflict (code) do nothing;

insert into public.fin_settings (key, value, label) values
  ('ar_account',        '1200', 'Accounts Receivable control'),
  ('ap_account',        '2000', 'Accounts Payable control'),
  ('sales_account',     '4000', 'Default sales income'),
  ('purchase_account',  '5100', 'Default purchase expense'),
  ('tax_account',       '2100', 'Tax payable'),
  ('discount_allowed',  '5200', 'Cash discount given to customers'),
  ('discount_received', '4200', 'Cash discount taken from suppliers'),
  ('cash_account',      '1000', 'Default cash account'),
  ('bank_account',      '1100', 'Default bank account')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 10. Small resolvers
-- ---------------------------------------------------------------------
create or replace function public.fin_setting_account(p_key text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id
  from public.fin_settings s
  join public.fin_accounts a on a.code = s.value
  where s.key = p_key;
$$;

create or replace function public.fin_account_by_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.fin_accounts where code = p_code;
$$;

-- Cash account for a store: a store-specific cash account if one exists,
-- otherwise the shared default. Each showroom keeps its own cashbook.
create or replace function public.fin_store_cash_account(p_store_id text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select id from public.fin_accounts
      where is_cash and is_active and store_id = p_store_id
      order by sort_order, code limit 1),
    public.fin_setting_account('cash_account')
  );
$$;

grant execute on function public.fin_setting_account(text) to authenticated;
grant execute on function public.fin_account_by_code(text) to authenticated;
grant execute on function public.fin_store_cash_account(text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Voucher status, recomputed from what has actually been allocated
-- ---------------------------------------------------------------------
create or replace function public.fin_refresh_voucher(p_voucher_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paid numeric;
  v_disc numeric;
  v_total numeric;
  v_status text;
begin
  select coalesce(sum(amount), 0), coalesce(sum(discount_amount), 0)
    into v_paid, v_disc
  from public.fin_payment_allocations where voucher_id = p_voucher_id;

  select total into v_total from public.fin_vouchers where id = p_voucher_id;

  v_status := case
    when v_paid + v_disc <= 0 then 'unpaid'
    when round(v_paid + v_disc, 2) >= round(v_total, 2) then 'paid'
    else 'partial'
  end;

  update public.fin_vouchers
     set paid_amount = v_paid,
         discount_taken = v_disc,
         status = case when status in ('draft','void') then status else v_status end,
         updated_at = now()
   where id = p_voucher_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Save a voucher (insert or replace) and post its journal
--
-- Payload:
--   { id?, kind, voucher_date, due_date, store_id, channel, sale_rep_id,
--     sale_rep_name, party_type, party_id, party_name, trade_discount,
--     cash_discount_pct, cash_discount_days, tax_percent, note, status?,
--     items: [ { description, product_id, qty, unit_price,
--                trade_discount_pct, account_code } ],
--     payment?: { amount, account_code, method, payment_date } }
-- ---------------------------------------------------------------------
create or replace function public.fin_save_voucher(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id        uuid := nullif(p->>'id','')::uuid;
  v_kind      text := p->>'kind';
  v_store     text := nullif(p->>'store_id','');
  v_date      date := coalesce((p->>'voucher_date')::date, current_date);
  v_trade     numeric := coalesce((p->>'trade_discount')::numeric, 0);
  v_taxpct    numeric := coalesce((p->>'tax_percent')::numeric, 0);
  v_subtotal  numeric := 0;
  v_taxable   numeric;
  v_tax       numeric;
  v_total     numeric;
  v_no        text;
  v_journal   uuid;
  v_line      jsonb;
  v_i         integer := 0;
  v_email     text := coalesce((select email from public.profiles where id = auth.uid()), 'system');
  v_ctrl      uuid;
  v_default   uuid;
  v_acct      uuid;
  v_amount    numeric;
begin
  if v_kind not in ('sale','purchase','income','expense') then
    raise exception 'Unknown voucher kind %', v_kind;
  end if;
  if not public.fin_can_write(v_store) then
    raise exception 'Not allowed to write finance rows for store %', v_store;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    v_subtotal := v_subtotal
      + round(coalesce((v_line->>'qty')::numeric,0)
            * coalesce((v_line->>'unit_price')::numeric,0)
            * (1 - coalesce((v_line->>'trade_discount_pct')::numeric,0) / 100), 2);
  end loop;

  v_taxable := v_subtotal - v_trade;
  v_tax     := round(v_taxable * v_taxpct / 100, 2);
  v_total   := v_taxable + v_tax;

  if v_id is null then
    v_no := public.next_fin_no(v_kind, v_store);
    insert into public.fin_vouchers (
      voucher_no, kind, voucher_date, due_date, store_id, channel,
      sale_rep_id, sale_rep_name, party_type, party_id, party_name,
      subtotal, trade_discount, cash_discount_pct, cash_discount_days,
      tax_percent, tax_amount, total, status, source_type, source_id,
      note, created_by
    ) values (
      v_no, v_kind, v_date, nullif(p->>'due_date','')::date, v_store,
      nullif(p->>'channel',''), nullif(p->>'sale_rep_id','')::uuid,
      nullif(p->>'sale_rep_name',''),
      coalesce(nullif(p->>'party_type',''),'other'), nullif(p->>'party_id','')::uuid,
      nullif(p->>'party_name',''),
      v_subtotal, v_trade, coalesce((p->>'cash_discount_pct')::numeric,0),
      nullif(p->>'cash_discount_days','')::int,
      v_taxpct, v_tax, v_total, coalesce(nullif(p->>'status',''),'unpaid'),
      nullif(p->>'source_type',''), nullif(p->>'source_id','')::uuid,
      nullif(p->>'note',''), v_email
    ) returning id into v_id;
  else
    -- Editing a voucher rewrites its lines and its journal; allocations
    -- already made against it are left alone and re-checked at the end.
    update public.fin_vouchers set
      voucher_date = v_date,
      due_date     = nullif(p->>'due_date','')::date,
      store_id     = v_store,
      channel      = nullif(p->>'channel',''),
      sale_rep_id  = nullif(p->>'sale_rep_id','')::uuid,
      sale_rep_name= nullif(p->>'sale_rep_name',''),
      party_type   = coalesce(nullif(p->>'party_type',''),'other'),
      party_id     = nullif(p->>'party_id','')::uuid,
      party_name   = nullif(p->>'party_name',''),
      subtotal     = v_subtotal,
      trade_discount = v_trade,
      cash_discount_pct = coalesce((p->>'cash_discount_pct')::numeric,0),
      cash_discount_days = nullif(p->>'cash_discount_days','')::int,
      tax_percent  = v_taxpct,
      tax_amount   = v_tax,
      total        = v_total,
      note         = nullif(p->>'note',''),
      updated_at   = now()
    where id = v_id;

    delete from public.fin_voucher_items where voucher_id = v_id;
    delete from public.fin_journals
      where source_type = 'voucher' and source_id = v_id;
  end if;

  v_default := case v_kind
    when 'sale'     then public.fin_setting_account('sales_account')
    when 'income'   then public.fin_account_by_code('4100')
    when 'purchase' then public.fin_setting_account('purchase_account')
    else public.fin_account_by_code('5900')
  end;

  for v_line in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.fin_voucher_items (
      voucher_id, line_no, product_id, description, qty, unit_price,
      trade_discount_pct, line_total, account_id
    ) values (
      v_id, v_i, nullif(v_line->>'product_id','')::uuid,
      coalesce(nullif(v_line->>'description',''),'-'),
      coalesce((v_line->>'qty')::numeric,0),
      coalesce((v_line->>'unit_price')::numeric,0),
      coalesce((v_line->>'trade_discount_pct')::numeric,0),
      round(coalesce((v_line->>'qty')::numeric,0)
          * coalesce((v_line->>'unit_price')::numeric,0)
          * (1 - coalesce((v_line->>'trade_discount_pct')::numeric,0)/100), 2),
      coalesce(public.fin_account_by_code(nullif(v_line->>'account_code','')), v_default)
    );
  end loop;

  -- ---------------- journal ----------------
  if coalesce(p->>'status','unpaid') <> 'draft' then
    insert into public.fin_journals (
      journal_no, journal_date, journal_type, store_id, memo,
      source_type, source_id, created_by
    ) values (
      public.next_fin_no('journal', v_store), v_date,
      case when v_kind in ('sale','income') then 'sale' else 'purchase' end,
      v_store,
      coalesce(nullif(p->>'party_name',''),'') || ' · ' ||
        (select voucher_no from public.fin_vouchers where id = v_id),
      'voucher', v_id, v_email
    ) returning id into v_journal;

    v_ctrl := case when v_kind in ('sale','income')
                   then public.fin_setting_account('ar_account')
                   else public.fin_setting_account('ap_account') end;

    if v_kind in ('sale','income') then
      -- Dr receivable, Cr income, Cr tax; trade discount is netted off
      insert into public.fin_journal_lines
        (journal_id, line_no, account_id, debit, credit, party_type, party_id, party_name, memo)
      values (v_journal, 1, v_ctrl, v_total, 0,
              p->>'party_type', nullif(p->>'party_id','')::uuid, p->>'party_name', 'Invoice');

      v_i := 1;
      for v_acct, v_amount in
        select account_id, sum(line_total) from public.fin_voucher_items
        where voucher_id = v_id group by account_id
      loop
        v_i := v_i + 1;
        insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
        values (v_journal, v_i, v_acct, 0,
                round(v_amount * (case when v_subtotal > 0
                                       then (v_subtotal - v_trade) / v_subtotal else 1 end), 2),
                'Revenue');
      end loop;

      if v_tax > 0 then
        insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
        values (v_journal, v_i + 1, public.fin_setting_account('tax_account'), 0, v_tax, 'Tax');
      end if;
    else
      -- Dr expense/purchase, Dr tax, Cr payable
      v_i := 0;
      for v_acct, v_amount in
        select account_id, sum(line_total) from public.fin_voucher_items
        where voucher_id = v_id group by account_id
      loop
        v_i := v_i + 1;
        insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
        values (v_journal, v_i, v_acct,
                round(v_amount * (case when v_subtotal > 0
                                       then (v_subtotal - v_trade) / v_subtotal else 1 end), 2),
                0, 'Purchase');
      end loop;

      if v_tax > 0 then
        v_i := v_i + 1;
        insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
        values (v_journal, v_i, public.fin_setting_account('tax_account'), v_tax, 0, 'Tax');
      end if;

      insert into public.fin_journal_lines
        (journal_id, line_no, account_id, debit, credit, party_type, party_id, party_name, memo)
      values (v_journal, v_i + 1, v_ctrl, 0, v_total,
              p->>'party_type', nullif(p->>'party_id','')::uuid, p->>'party_name', 'Bill');
    end if;

    perform public.fin_assert_balanced(v_journal);
    update public.fin_vouchers set journal_id = v_journal where id = v_id;
  end if;

  -- ---------------- paid on the spot ----------------
  if coalesce((p->'payment'->>'amount')::numeric, 0) > 0 then
    perform public.fin_record_payment(jsonb_build_object(
      'payment_date', coalesce(p->'payment'->>'payment_date', v_date::text),
      'direction',    case when v_kind in ('sale','income') then 'in' else 'out' end,
      'store_id',     v_store,
      'account_code', coalesce(p->'payment'->>'account_code', '1000'),
      'method',       p->'payment'->>'method',
      'party_type',   p->>'party_type',
      'party_id',     p->>'party_id',
      'party_name',   p->>'party_name',
      'amount',       (p->'payment'->>'amount')::numeric,
      'allocations',  jsonb_build_array(jsonb_build_object(
                        'voucher_id', v_id,
                        'amount', (p->'payment'->>'amount')::numeric))
    ));
  end if;

  perform public.fin_refresh_voucher(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. Record a payment / receipt and allocate it
--
-- Payload:
--   { payment_date, direction:'in'|'out', store_id, account_code | account_id,
--     method, party_type, party_id, party_name, amount, discount_amount,
--     reference, note,
--     allocations: [ { voucher_id, amount, discount_amount } ] }
-- ---------------------------------------------------------------------
create or replace function public.fin_record_payment(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_store    text := nullif(p->>'store_id','');
  v_dir      text := p->>'direction';
  v_date     date := coalesce((p->>'payment_date')::date, current_date);
  v_amount   numeric := coalesce((p->>'amount')::numeric, 0);
  v_disc     numeric := coalesce((p->>'discount_amount')::numeric, 0);
  v_account  uuid := coalesce(nullif(p->>'account_id','')::uuid,
                              public.fin_account_by_code(nullif(p->>'account_code','')),
                              public.fin_store_cash_account(v_store));
  v_alloc    jsonb;
  v_alloc_sum numeric := 0;
  v_disc_sum  numeric := 0;
  v_journal  uuid;
  v_ctrl     uuid;
  v_email    text := coalesce((select email from public.profiles where id = auth.uid()), 'system');
  v_i        integer := 0;
  v_vid      uuid;
begin
  if v_dir not in ('in','out') then
    raise exception 'direction must be in or out';
  end if;
  if not public.fin_can_write(v_store) then
    raise exception 'Not allowed to write finance rows for store %', v_store;
  end if;
  if v_amount <= 0 and v_disc <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  insert into public.fin_payments (
    payment_no, payment_date, direction, store_id, account_id, method,
    party_type, party_id, party_name, amount, discount_amount,
    reference, note, created_by
  ) values (
    public.next_fin_no(case when v_dir = 'in' then 'receipt' else 'payment' end, v_store),
    v_date, v_dir, v_store, v_account, nullif(p->>'method',''),
    coalesce(nullif(p->>'party_type',''),'other'), nullif(p->>'party_id','')::uuid,
    nullif(p->>'party_name',''), v_amount, v_disc,
    nullif(p->>'reference',''), nullif(p->>'note',''), v_email
  ) returning id into v_id;

  for v_alloc in select * from jsonb_array_elements(coalesce(p->'allocations','[]'::jsonb)) loop
    v_vid := (v_alloc->>'voucher_id')::uuid;
    insert into public.fin_payment_allocations (payment_id, voucher_id, amount, discount_amount)
    values (v_id, v_vid,
            coalesce((v_alloc->>'amount')::numeric, 0),
            coalesce((v_alloc->>'discount_amount')::numeric, 0));
    v_alloc_sum := v_alloc_sum + coalesce((v_alloc->>'amount')::numeric, 0);
    v_disc_sum  := v_disc_sum  + coalesce((v_alloc->>'discount_amount')::numeric, 0);
  end loop;

  if round(v_alloc_sum, 2) > round(v_amount, 2) then
    raise exception 'Allocated % is more than the payment amount %', v_alloc_sum, v_amount;
  end if;

  v_disc := greatest(v_disc, v_disc_sum);
  update public.fin_payments
     set unallocated = v_amount - v_alloc_sum, discount_amount = v_disc
   where id = v_id;

  -- ---------------- journal ----------------
  insert into public.fin_journals (
    journal_no, journal_date, journal_type, store_id, memo,
    source_type, source_id, created_by
  ) values (
    public.next_fin_no('journal', v_store), v_date,
    case when v_dir = 'in' then 'receipt' else 'payment' end,
    v_store,
    coalesce(nullif(p->>'party_name',''),'') || ' · ' ||
      (select payment_no from public.fin_payments where id = v_id),
    'payment', v_id, v_email
  ) returning id into v_journal;

  v_ctrl := case when v_dir = 'in'
                 then public.fin_setting_account('ar_account')
                 else public.fin_setting_account('ap_account') end;

  if v_dir = 'in' then
    -- Dr cash/bank, Dr discount allowed, Cr receivable
    insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
    values (v_journal, 1, v_account, v_amount, 0, 'Receipt');
    v_i := 1;
    if v_disc > 0 then
      v_i := v_i + 1;
      insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
      values (v_journal, v_i, public.fin_setting_account('discount_allowed'), v_disc, 0, 'Cash discount');
    end if;
    insert into public.fin_journal_lines
      (journal_id, line_no, account_id, debit, credit, party_type, party_id, party_name, memo)
    values (v_journal, v_i + 1, v_ctrl, 0, v_amount + v_disc,
            p->>'party_type', nullif(p->>'party_id','')::uuid, p->>'party_name', 'Settlement');
  else
    -- Dr payable, Cr cash/bank, Cr discount received
    insert into public.fin_journal_lines
      (journal_id, line_no, account_id, debit, credit, party_type, party_id, party_name, memo)
    values (v_journal, 1, v_ctrl, v_amount + v_disc, 0,
            p->>'party_type', nullif(p->>'party_id','')::uuid, p->>'party_name', 'Settlement');
    insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
    values (v_journal, 2, v_account, 0, v_amount, 'Payment');
    if v_disc > 0 then
      insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
      values (v_journal, 3, public.fin_setting_account('discount_received'), 0, v_disc, 'Cash discount');
    end if;
  end if;

  perform public.fin_assert_balanced(v_journal);
  update public.fin_payments set journal_id = v_journal where id = v_id;

  for v_vid in select voucher_id from public.fin_payment_allocations where payment_id = v_id loop
    perform public.fin_refresh_voucher(v_vid);
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. Cashbook / bank book entry - one contra account, two lines
--
-- Payload: { entry_date, store_id, book:'cashbook'|'bank', direction:'in'|'out',
--            account_id (cash/bank), contra_code, amount, memo, reference }
-- ---------------------------------------------------------------------
create or replace function public.fin_save_cash_entry(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store   text := nullif(p->>'store_id','');
  v_date    date := coalesce((p->>'entry_date')::date, current_date);
  v_amount  numeric := coalesce((p->>'amount')::numeric, 0);
  v_book    text := coalesce(nullif(p->>'book',''), 'cashbook');
  v_dir     text := p->>'direction';
  v_cash    uuid := coalesce(nullif(p->>'account_id','')::uuid,
                             public.fin_store_cash_account(v_store));
  v_contra  uuid := public.fin_account_by_code(p->>'contra_code');
  v_journal uuid;
  v_email   text := coalesce((select email from public.profiles where id = auth.uid()), 'system');
begin
  if not public.fin_can_write(v_store) then
    raise exception 'Not allowed to write finance rows for store %', v_store;
  end if;
  if v_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if v_contra is null then raise exception 'Contra account not found'; end if;
  if v_dir not in ('in','out') then raise exception 'direction must be in or out'; end if;

  insert into public.fin_journals (
    journal_no, journal_date, journal_type, store_id, memo,
    source_type, source_id, created_by
  ) values (
    public.next_fin_no(case when v_book = 'bank' then 'bank' else 'cashbook' end, v_store),
    v_date, v_book, v_store, nullif(p->>'memo',''), 'manual', null, v_email
  ) returning id into v_journal;

  if v_dir = 'in' then
    insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
    values (v_journal, 1, v_cash,   v_amount, 0, nullif(p->>'memo','')),
           (v_journal, 2, v_contra, 0, v_amount, nullif(p->>'memo',''));
  else
    insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
    values (v_journal, 1, v_contra, v_amount, 0, nullif(p->>'memo','')),
           (v_journal, 2, v_cash,   0, v_amount, nullif(p->>'memo',''));
  end if;

  perform public.fin_assert_balanced(v_journal);
  return v_journal;
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Free-form journal voucher
--
-- Payload: { journal_date, store_id, memo,
--            lines: [ { account_code, debit, credit, memo } ] }
-- ---------------------------------------------------------------------
create or replace function public.fin_save_journal(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store   text := nullif(p->>'store_id','');
  v_journal uuid;
  v_line    jsonb;
  v_i       integer := 0;
  v_email   text := coalesce((select email from public.profiles where id = auth.uid()), 'system');
begin
  if not public.fin_can_write(v_store) then
    raise exception 'Not allowed to write finance rows for store %', v_store;
  end if;

  insert into public.fin_journals (
    journal_no, journal_date, journal_type, store_id, memo,
    source_type, source_id, created_by
  ) values (
    public.next_fin_no('journal', v_store),
    coalesce((p->>'journal_date')::date, current_date),
    'journal', v_store, nullif(p->>'memo',''), 'manual', null, v_email
  ) returning id into v_journal;

  for v_line in select * from jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.fin_journal_lines (journal_id, line_no, account_id, debit, credit, memo)
    values (
      v_journal, v_i,
      coalesce(nullif(v_line->>'account_id','')::uuid,
               public.fin_account_by_code(v_line->>'account_code')),
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      nullif(v_line->>'memo','')
    );
  end loop;

  perform public.fin_assert_balanced(v_journal);
  return v_journal;
end;
$$;

-- ---------------------------------------------------------------------
-- 16. Reverse a posted journal instead of deleting it
-- ---------------------------------------------------------------------
create or replace function public.fin_reverse_journal(p_journal_id uuid, p_memo text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src public.fin_journals%rowtype;
  v_new uuid;
  v_email text := coalesce((select email from public.profiles where id = auth.uid()), 'system');
begin
  select * into v_src from public.fin_journals where id = p_journal_id;
  if not found then raise exception 'Journal not found'; end if;
  if not public.fin_can_write(v_src.store_id) then
    raise exception 'Not allowed to reverse a journal for store %', v_src.store_id;
  end if;
  if v_src.is_reversed then raise exception 'Journal already reversed'; end if;

  insert into public.fin_journals (
    journal_no, journal_date, journal_type, store_id, memo,
    source_type, source_id, reversal_of, created_by
  ) values (
    public.next_fin_no('journal', v_src.store_id), current_date, v_src.journal_type,
    v_src.store_id, coalesce(p_memo, 'Reversal of ' || v_src.journal_no),
    v_src.source_type, v_src.source_id, v_src.id, v_email
  ) returning id into v_new;

  insert into public.fin_journal_lines
    (journal_id, line_no, account_id, debit, credit, party_type, party_id, party_name, memo)
  select v_new, line_no, account_id, credit, debit, party_type, party_id, party_name,
         'Reversal'
  from public.fin_journal_lines where journal_id = p_journal_id;

  update public.fin_journals set is_reversed = true where id = p_journal_id;
  perform public.fin_assert_balanced(v_new);
  return v_new;
end;
$$;

grant execute on function public.fin_save_voucher(jsonb) to authenticated;
grant execute on function public.fin_record_payment(jsonb) to authenticated;
grant execute on function public.fin_save_cash_entry(jsonb) to authenticated;
grant execute on function public.fin_save_journal(jsonb) to authenticated;
grant execute on function public.fin_reverse_journal(uuid, text) to authenticated;
grant execute on function public.fin_refresh_voucher(uuid) to authenticated;

-- =====================================================================
-- 17. Reports
-- =====================================================================

-- Balance of every account over a period (opening balance included).
create or replace function public.fin_trial_balance(
  p_from date default null,
  p_to   date default null,
  p_store text default null
)
returns table (
  account_id uuid, code text, name text, name_my text, type text,
  debit numeric, credit numeric, balance numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.code, a.name, a.name_my, a.type,
         coalesce(sum(l.debit), 0)  as debit,
         coalesce(sum(l.credit), 0) as credit,
         case when a.type in ('asset','expense')
              then a.opening_balance + coalesce(sum(l.debit - l.credit), 0)
              else a.opening_balance + coalesce(sum(l.credit - l.debit), 0)
         end as balance
  from public.fin_accounts a
  left join public.fin_journal_lines l on l.account_id = a.id
  left join public.fin_journals j on j.id = l.journal_id
   and (p_from is null or j.journal_date >= p_from)
   and (p_to   is null or j.journal_date <= p_to)
   and (p_store is null or j.store_id = p_store)
   and j.is_posted
  where a.is_active
    and (public.is_finance() or public.fin_can_read(a.store_id) or a.store_id is null)
  group by a.id, a.code, a.name, a.name_my, a.type, a.opening_balance
  order by a.code;
$$;

-- Every movement on one account, with a running balance.
create or replace function public.fin_general_ledger(
  p_account_id uuid,
  p_from date default null,
  p_to   date default null,
  p_store text default null
)
returns table (
  journal_id uuid, journal_no text, journal_date date, journal_type text,
  store_id text, memo text, party_name text,
  debit numeric, credit numeric, running_balance numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with acct as (
    select id, type, opening_balance from public.fin_accounts where id = p_account_id
  ),
  rows as (
    select j.id, j.journal_no, j.journal_date, j.journal_type, j.store_id,
           coalesce(l.memo, j.memo) as memo, l.party_name,
           l.debit, l.credit, l.created_at
    from public.fin_journal_lines l
    join public.fin_journals j on j.id = l.journal_id
    where l.account_id = p_account_id
      and j.is_posted
      and (p_from is null or j.journal_date >= p_from)
      and (p_to   is null or j.journal_date <= p_to)
      and (p_store is null or j.store_id = p_store)
  )
  select r.id, r.journal_no, r.journal_date, r.journal_type, r.store_id,
         r.memo, r.party_name, r.debit, r.credit,
         (select opening_balance from acct) +
         sum(case when (select type from acct) in ('asset','expense')
                  then r.debit - r.credit else r.credit - r.debit end)
           over (order by r.journal_date, r.created_at
                 rows between unbounded preceding and current row) as running_balance
  from rows r
  order by r.journal_date, r.created_at;
$$;

grant execute on function public.fin_trial_balance(date, date, text) to authenticated;
grant execute on function public.fin_general_ledger(uuid, date, date, text) to authenticated;

-- Outstanding customer invoices, with ageing.
create or replace view public.fin_receivables as
select v.id, v.voucher_no, v.voucher_date, v.due_date, v.store_id, v.channel,
       v.party_id, v.party_name, v.sale_rep_name,
       v.total, v.paid_amount, v.discount_taken, v.balance, v.status,
       (current_date - coalesce(v.due_date, v.voucher_date)) as days_overdue,
       case
         when current_date - coalesce(v.due_date, v.voucher_date) <= 0  then 'current'
         when current_date - coalesce(v.due_date, v.voucher_date) <= 30 then '1-30'
         when current_date - coalesce(v.due_date, v.voucher_date) <= 60 then '31-60'
         when current_date - coalesce(v.due_date, v.voucher_date) <= 90 then '61-90'
         else '90+'
       end as ageing_bucket
from public.fin_vouchers v
where v.kind in ('sale','income')
  and v.status in ('unpaid','partial')
  and v.balance > 0;

-- Outstanding supplier bills, same shape.
create or replace view public.fin_payables as
select v.id, v.voucher_no, v.voucher_date, v.due_date, v.store_id, v.channel,
       v.party_id, v.party_name,
       v.total, v.paid_amount, v.discount_taken, v.balance, v.status,
       (current_date - coalesce(v.due_date, v.voucher_date)) as days_overdue,
       case
         when current_date - coalesce(v.due_date, v.voucher_date) <= 0  then 'current'
         when current_date - coalesce(v.due_date, v.voucher_date) <= 30 then '1-30'
         when current_date - coalesce(v.due_date, v.voucher_date) <= 60 then '31-60'
         when current_date - coalesce(v.due_date, v.voucher_date) <= 90 then '61-90'
         else '90+'
       end as ageing_bucket
from public.fin_vouchers v
where v.kind in ('purchase','expense')
  and v.status in ('unpaid','partial')
  and v.balance > 0;

-- Cash and bank balances, one row per account.
create or replace view public.fin_cash_balances as
select a.id, a.code, a.name, a.name_my, a.store_id, a.is_cash, a.is_bank,
       a.bank_name, a.bank_account_no,
       a.opening_balance + coalesce(sum(l.debit - l.credit), 0) as balance
from public.fin_accounts a
left join public.fin_journal_lines l on l.account_id = a.id
left join public.fin_journals j on j.id = l.journal_id and j.is_posted
where (a.is_cash or a.is_bank) and a.is_active
group by a.id, a.code, a.name, a.name_my, a.store_id, a.is_cash, a.is_bank,
         a.bank_name, a.bank_account_no, a.opening_balance;

grant select on public.fin_receivables, public.fin_payables, public.fin_cash_balances to authenticated;

-- ---------------------------------------------------------------------
-- 18. Pull POS sales into the finance ledger
--
-- Till receipts stay where they are; this creates the matching sale
-- voucher once, so the ledger and the POS never diverge. Runs per store
-- and date range, skips anything already pulled.
-- ---------------------------------------------------------------------
create or replace function public.fin_pull_pos_sales(
  p_store text,
  p_from  date,
  p_to    date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
  v_count integer := 0;
  v_channel text;
  v_paid numeric;
begin
  if not public.fin_can_write(p_store) then
    raise exception 'Not allowed to write finance rows for store %', p_store;
  end if;

  for s in
    select * from public.sales
    where store_id = p_store
      and created_at::date between p_from and p_to
      and order_status <> 'cancelled'
      and not exists (
        select 1 from public.fin_vouchers v
        where v.source_type = 'pos_sale' and v.source_id = s.id)
  loop
    v_channel := case
      when s.order_type = 'wholesale' then 'wholesale'
      when s.order_type in ('online','delivery') then 'online'
      when s.sale_rep_id is not null then 'salesman'
      else 'showroom' end;

    v_paid := greatest(coalesce(s.total, 0) - coalesce(s.balance_due, 0), 0);

    perform public.fin_save_voucher(jsonb_build_object(
      'kind', 'sale',
      'voucher_date', s.created_at::date::text,
      'store_id', s.store_id,
      'channel', v_channel,
      'sale_rep_id', s.sale_rep_id,
      'sale_rep_name', s.sale_rep_name,
      'party_type', case when s.customer_id is not null then 'customer' else 'other' end,
      'party_id', s.customer_id,
      'party_name', coalesce(s.customer_name, 'Walk-in'),
      'trade_discount', coalesce(s.discount_amount, 0),
      'tax_percent', coalesce(s.vat_percent, 0),
      'source_type', 'pos_sale',
      'source_id', s.id,
      'note', 'POS ' || coalesce(s.sale_ref, ''),
      'items', jsonb_build_array(jsonb_build_object(
        'description', 'POS sale ' || coalesce(s.sale_ref, ''),
        'qty', 1,
        'unit_price', coalesce(s.subtotal, s.total),
        'account_code', case v_channel
          when 'wholesale' then '4010'
          when 'online'    then '4020'
          else '4000' end
      )),
      'payment', case when v_paid > 0 then jsonb_build_object(
        'amount', v_paid,
        'method', s.payment_method,
        'account_code', case when s.payment_method = 'cash' then '1000' else '1100' end
      ) else null end
    ));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.fin_pull_pos_sales(text, date, date) to authenticated;

-- =====================================================================
-- 19. Row level security
--
-- Chart of accounts and posting rules are configuration: everyone in
-- finance reads, only finance/admin writes. Transactions are store
-- scoped through fin_can_read / fin_can_write.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'fin_accounts','fin_settings','fin_counters','fin_journals','fin_journal_lines',
    'fin_vouchers','fin_voucher_items','fin_payments','fin_payment_allocations',
    'fin_documents','fin_document_items','fin_users','fin_user_stores'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reference tier
drop policy if exists "read fin_accounts" on public.fin_accounts;
create policy "read fin_accounts" on public.fin_accounts
  for select to authenticated using (public.is_finance());
drop policy if exists "finance write fin_accounts" on public.fin_accounts;
create policy "finance write fin_accounts" on public.fin_accounts
  for all to authenticated
  using (public.fin_can_write(store_id)) with check (public.fin_can_write(store_id));

drop policy if exists "read fin_settings" on public.fin_settings;
create policy "read fin_settings" on public.fin_settings
  for select to authenticated using (public.is_finance());
drop policy if exists "finance write fin_settings" on public.fin_settings;
create policy "finance write fin_settings" on public.fin_settings
  for all to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

drop policy if exists "read fin_users" on public.fin_users;
create policy "read fin_users" on public.fin_users
  for select to authenticated using (id = auth.uid() or public.is_finance());
drop policy if exists "admin write fin_users" on public.fin_users;
create policy "admin write fin_users" on public.fin_users
  for all to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

drop policy if exists "read fin_user_stores" on public.fin_user_stores;
create policy "read fin_user_stores" on public.fin_user_stores
  for select to authenticated using (user_id = auth.uid() or public.is_finance());
drop policy if exists "admin write fin_user_stores" on public.fin_user_stores;
create policy "admin write fin_user_stores" on public.fin_user_stores
  for all to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

drop policy if exists "read fin_counters" on public.fin_counters;
create policy "read fin_counters" on public.fin_counters
  for select to authenticated using (public.is_finance());

-- Store-scoped transaction tier
drop policy if exists "read fin_journals" on public.fin_journals;
create policy "read fin_journals" on public.fin_journals
  for select to authenticated using (public.fin_can_read(store_id));
drop policy if exists "write fin_journals" on public.fin_journals;
create policy "write fin_journals" on public.fin_journals
  for all to authenticated
  using (public.fin_can_write(store_id)) with check (public.fin_can_write(store_id));

drop policy if exists "read fin_vouchers" on public.fin_vouchers;
create policy "read fin_vouchers" on public.fin_vouchers
  for select to authenticated using (public.fin_can_read(store_id));
drop policy if exists "write fin_vouchers" on public.fin_vouchers;
create policy "write fin_vouchers" on public.fin_vouchers
  for all to authenticated
  using (public.fin_can_write(store_id)) with check (public.fin_can_write(store_id));

drop policy if exists "read fin_payments" on public.fin_payments;
create policy "read fin_payments" on public.fin_payments
  for select to authenticated using (public.fin_can_read(store_id));
drop policy if exists "write fin_payments" on public.fin_payments;
create policy "write fin_payments" on public.fin_payments
  for all to authenticated
  using (public.fin_can_write(store_id)) with check (public.fin_can_write(store_id));

drop policy if exists "read fin_documents" on public.fin_documents;
create policy "read fin_documents" on public.fin_documents
  for select to authenticated using (public.fin_can_read(store_id));
drop policy if exists "write fin_documents" on public.fin_documents;
create policy "write fin_documents" on public.fin_documents
  for all to authenticated
  using (public.fin_can_write(store_id)) with check (public.fin_can_write(store_id));

-- Child rows follow their parent
drop policy if exists "read fin_journal_lines" on public.fin_journal_lines;
create policy "read fin_journal_lines" on public.fin_journal_lines
  for select to authenticated using (exists (
    select 1 from public.fin_journals j
    where j.id = journal_id and public.fin_can_read(j.store_id)));
drop policy if exists "write fin_journal_lines" on public.fin_journal_lines;
create policy "write fin_journal_lines" on public.fin_journal_lines
  for all to authenticated using (exists (
    select 1 from public.fin_journals j
    where j.id = journal_id and public.fin_can_write(j.store_id)))
  with check (exists (
    select 1 from public.fin_journals j
    where j.id = journal_id and public.fin_can_write(j.store_id)));

drop policy if exists "read fin_voucher_items" on public.fin_voucher_items;
create policy "read fin_voucher_items" on public.fin_voucher_items
  for select to authenticated using (exists (
    select 1 from public.fin_vouchers v
    where v.id = voucher_id and public.fin_can_read(v.store_id)));
drop policy if exists "write fin_voucher_items" on public.fin_voucher_items;
create policy "write fin_voucher_items" on public.fin_voucher_items
  for all to authenticated using (exists (
    select 1 from public.fin_vouchers v
    where v.id = voucher_id and public.fin_can_write(v.store_id)))
  with check (exists (
    select 1 from public.fin_vouchers v
    where v.id = voucher_id and public.fin_can_write(v.store_id)));

drop policy if exists "read fin_payment_allocations" on public.fin_payment_allocations;
create policy "read fin_payment_allocations" on public.fin_payment_allocations
  for select to authenticated using (exists (
    select 1 from public.fin_payments pm
    where pm.id = payment_id and public.fin_can_read(pm.store_id)));
drop policy if exists "write fin_payment_allocations" on public.fin_payment_allocations;
create policy "write fin_payment_allocations" on public.fin_payment_allocations
  for all to authenticated using (exists (
    select 1 from public.fin_payments pm
    where pm.id = payment_id and public.fin_can_write(pm.store_id)))
  with check (exists (
    select 1 from public.fin_payments pm
    where pm.id = payment_id and public.fin_can_write(pm.store_id)));

drop policy if exists "read fin_document_items" on public.fin_document_items;
create policy "read fin_document_items" on public.fin_document_items
  for select to authenticated using (exists (
    select 1 from public.fin_documents d
    where d.id = doc_id and public.fin_can_read(d.store_id)));
drop policy if exists "write fin_document_items" on public.fin_document_items;
create policy "write fin_document_items" on public.fin_document_items
  for all to authenticated using (exists (
    select 1 from public.fin_documents d
    where d.id = doc_id and public.fin_can_write(d.store_id)))
  with check (exists (
    select 1 from public.fin_documents d
    where d.id = doc_id and public.fin_can_write(d.store_id)));

-- ---------------------------------------------------------------------
-- 19b. Table privileges
--
-- RLS decides which rows; these decide that the API role may reach the
-- tables at all. Supabase grants this by default for tables created
-- through its dashboard - stating it here keeps the migration correct on
-- a project where that default was changed.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'fin_accounts','fin_settings','fin_journals','fin_journal_lines',
    'fin_vouchers','fin_voucher_items','fin_payments','fin_payment_allocations',
    'fin_documents','fin_document_items','fin_users','fin_user_stores'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  execute 'grant select on public.fin_counters to authenticated';
  execute 'grant select on public.fin_receivables, public.fin_payables, public.fin_cash_balances to authenticated';
end $$;

-- =====================================================================
-- 20. What finance may read from the POS side
--
-- The finance app reads a handful of POS tables - branches, products and
-- the two party lists - and posts nothing back to them. Finance accounts
-- have no `profiles` row, so the POS policies never match them; these
-- add read-only access, store-scoped exactly like the ledger itself.
-- Everything else in the POS stays invisible to a finance login.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['stores','products','product_variants','product_categories',
                           'suppliers','sales_reps','payment_methods'] loop
    execute format('drop policy if exists "finance read %s" on public.%I', t, t);
    execute format(
      'create policy "finance read %s" on public.%I '
      'for select to authenticated using (public.is_finance())', t, t);
  end loop;
end $$;

-- Customers carry phone numbers and addresses, so they follow the same
-- branch scope as the vouchers raised against them.
drop policy if exists "finance read customers" on public.customers;
create policy "finance read customers" on public.customers
  for select to authenticated using (public.fin_can_read(store_id));

-- Sales are read through fin_pull_pos_sales(), which runs as the function
-- owner; a finance login still gets its own scoped read for reconciling a
-- voucher against the receipt it came from.
drop policy if exists "finance read sales" on public.sales;
create policy "finance read sales" on public.sales
  for select to authenticated using (public.fin_can_read(store_id));

drop policy if exists "finance read sale_items" on public.sale_items;
create policy "finance read sale_items" on public.sale_items
  for select to authenticated using (exists (
    select 1 from public.sales s
    where s.id = sale_id and public.fin_can_read(s.store_id)));

-- ---------------------------------------------------------------------
-- 21. Bootstrap
--
-- Creates the first finance administrator from an existing auth user, so
-- there is a way in before the user screen exists. Run it once:
--
--   select public.fin_bootstrap_admin('finance@yourcompany.com');
--
-- The email must already exist in Supabase Auth (Authentication -> Users
-- -> Add user). After that, every other finance account is created from
-- the app's own Users page.
-- ---------------------------------------------------------------------
create or replace function public.fin_bootstrap_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then
    raise exception 'No auth user with email % - create it in Supabase Auth first', p_email;
  end if;

  insert into public.fin_users (id, email, name, role, all_stores, is_active, created_by)
  values (v_id, lower(p_email), split_part(p_email, '@', 1), 'fin_admin', true, true, 'bootstrap')
  on conflict (id) do update
    set role = 'fin_admin', all_stores = true, is_active = true;

  return v_id;
end;
$$;

revoke all on function public.fin_bootstrap_admin(text) from public, anon, authenticated;
