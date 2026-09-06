-- =====================================================================
-- 20260907000004: Keep payment methods and their accounts in step
-- Repo path: supabase/migrations/20260907000004_method_sync.sql
--
-- Two lists were drifting apart. The POS owns which methods a till may
-- take (public.payment_methods, managed in POS admin); finance owns
-- which account each one settles into (fin_method_accounts). A method
-- added on one side was invisible on the other, and an unmapped method
-- quietly fell back to Bank - which is how KBZPay and cash end up in the
-- same pot without anyone noticing.
--
-- After this:
--   * a method added in POS admin gets a finance mapping immediately,
--     with a sensible default the accountant can re-point
--   * finance can add a method that the till will actually offer
--   * fin_method_coverage lists every method either side knows about,
--     including ones only seen in historic sales, and flags the
--     unmapped ones
--
-- Idempotent - safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A new POS payment method gets an account straight away
--
-- The default is deliberately dull: cash-like methods to the default cash
-- account, everything else to Bank. It exists so nothing is unmapped, not
-- to guess where a new wallet belongs - and it never overwrites a mapping
-- finance has already made.
-- ---------------------------------------------------------------------
create or replace function public.fin_sync_method_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid;
begin
  v_account := case
    when new.is_cash or new.is_cod then public.fin_setting_account('cash_account')
    else public.fin_setting_account('bank_account')
  end;

  if v_account is null then
    return new;                       -- finance schema not seeded yet
  end if;

  insert into public.fin_method_accounts (method_code, account_id, label)
  values (lower(trim(new.code)), v_account, new.name)
  on conflict (method_code) do update
    set label = coalesce(public.fin_method_accounts.label, excluded.label);

  return new;
end;
$$;

drop trigger if exists payment_methods_fin_sync on public.payment_methods;
create trigger payment_methods_fin_sync
  after insert or update of code, name, is_cash, is_cod on public.payment_methods
  for each row execute function public.fin_sync_method_account();

-- Backfill what the POS already has, plus anything historic sales and PO
-- payments actually used - a method can predate the payment_methods table.
insert into public.fin_method_accounts (method_code, account_id, label)
select m.code, m.account_id, m.label
from (
  select lower(trim(pm.code)) as code,
         case when pm.is_cash or pm.is_cod
              then public.fin_setting_account('cash_account')
              else public.fin_setting_account('bank_account') end as account_id,
         pm.name as label
  from public.payment_methods pm
  where pm.code is not null and trim(pm.code) <> ''

  union

  select lower(trim(s.payment_method)),
         case when lower(trim(s.payment_method)) in ('cash','cod','cash_on_delivery')
              then public.fin_setting_account('cash_account')
              else public.fin_setting_account('bank_account') end,
         null
  from public.sales s
  where s.payment_method is not null and trim(s.payment_method) <> ''

  union

  select lower(trim(p.method)),
         case when lower(trim(p.method)) in ('cash','cod','cash_on_delivery')
              then public.fin_setting_account('cash_account')
              else public.fin_setting_account('bank_account') end,
         null
  from public.po_payments p
  where p.method is not null and trim(p.method) <> ''
) m
where m.account_id is not null
on conflict (method_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Finance may add a method the till will offer
--
-- Read access already existed; this adds write, limited to a finance
-- administrator. The POS keeps its own admin screen - this is so a method
-- created while setting up the books does not have to be typed twice.
-- ---------------------------------------------------------------------
drop policy if exists "finance write payment_methods" on public.payment_methods;
create policy "finance write payment_methods" on public.payment_methods
  for all to authenticated
  using (public.fin_is_admin()) with check (public.fin_is_admin());

-- ---------------------------------------------------------------------
-- 3. What is mapped, what is not, and what is actually being used
--
-- `in_pos` says the till offers it; `used_count` is how many sales and PO
-- payments carry it. A row with no account_code is the one to look at.
-- ---------------------------------------------------------------------
create or replace view public.fin_method_coverage as
with methods as (
  select lower(trim(pm.code)) as method_code, pm.name, true as in_pos, pm.is_active
  from public.payment_methods pm
  where pm.code is not null and trim(pm.code) <> ''

  union all

  select lower(trim(s.payment_method)), null, false, null
  from public.sales s
  where s.payment_method is not null and trim(s.payment_method) <> ''

  union all

  select lower(trim(p.method)), null, false, null
  from public.po_payments p
  where p.method is not null and trim(p.method) <> ''
),
rolled as (
  select method_code,
         max(name) as pos_name,
         bool_or(in_pos) as in_pos,
         bool_or(coalesce(is_active, false)) as is_active,
         count(*) filter (where not in_pos) as used_count
  from methods
  group by method_code
)
select r.method_code,
       coalesce(r.pos_name, ma.label) as label,
       r.in_pos,
       r.is_active,
       r.used_count,
       a.code as account_code,
       a.name as account_name
from rolled r
left join public.fin_method_accounts ma on ma.method_code = r.method_code
left join public.fin_accounts a on a.id = ma.account_id
order by (a.code is null) desc, r.used_count desc, r.method_code;

grant select on public.fin_method_coverage to authenticated;
