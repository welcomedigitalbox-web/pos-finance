-- =====================================================================
-- 20260915000001: Post to the ledger as it happens
-- Repo path: supabase/migrations/20260915000001_auto_sync.sql
--
-- The pulls were a button someone had to remember to press, which means
-- the books were only ever as current as the last time somebody thought
-- about them. Both apps write to this same database, so the ledger can
-- simply follow along:
--
--   a sale is rung up          -> a sale voucher, with the paid part
--                                 already settled
--   a customer pays off credit -> the receipt lands against that voucher
--   a PO is received           -> a supplier bill
--   a PO payment is entered    -> the payment lands against that bill
--
-- Two rules this is built on:
--
--   1. A cashier is not a finance user. The posting functions here run
--      as the database owner and skip the permission check the pulls
--      make - they are called by triggers, never by a person.
--
--   2. Nothing in finance may ever stop the till. Every trigger swallows
--      its own failure into fin_sync_errors and lets the sale commit.
--      The pulls stay exactly as they are, so anything that failed is
--      recovered by pressing the button, and neither one double-posts.
--
-- Idempotent - safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Where a failed posting goes
-- ---------------------------------------------------------------------
create table if not exists public.fin_sync_errors (
  id          uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id   uuid,
  message     text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_fin_sync_errors_open
  on public.fin_sync_errors(created_at) where not resolved;

alter table public.fin_sync_errors enable row level security;

drop policy if exists "read fin_sync_errors" on public.fin_sync_errors;
create policy "read fin_sync_errors" on public.fin_sync_errors
  for select to authenticated using (public.is_finance());

drop policy if exists "finance write fin_sync_errors" on public.fin_sync_errors;
create policy "finance write fin_sync_errors" on public.fin_sync_errors
  for all to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

grant select, insert, update, delete on public.fin_sync_errors to authenticated;

-- ---------------------------------------------------------------------
-- 2. Which branch a purchase order belongs to
--
-- purchase_orders carries no branch, and a trigger has nobody to ask, so
-- the branch is a setting. Defaults to the first non-warehouse store.
-- ---------------------------------------------------------------------
insert into public.fin_settings (key, value, label)
select 'po_store',
       coalesce((select id from public.stores
                  where is_active and not is_warehouse order by id limit 1), 'SR-BAK'),
       'Branch that purchase orders are booked against'
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2b. Posting on someone else's behalf
--
-- A trigger runs inside the cashier's session, and a cashier is not a
-- finance user, so fin_can_write() refuses - correctly, for a person.
-- The posting functions below raise a transaction-local flag that the
-- scope helpers honour, and lower it before they return.
--
-- The flag is only reachable from inside these SECURITY DEFINER
-- functions: set_config lives in pg_catalog, which PostgREST does not
-- expose, and the setting dies with the transaction either way.
-- ---------------------------------------------------------------------
create or replace function public.fin_is_system()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('fin.system', true), '') = 'on';
$$;

create or replace function public.fin_can_read(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fin_is_system()
     or (public.is_finance()
         and (
           public.fin_covers_all_stores()
           or p_store_id is null
           or exists (select 1 from public.fin_user_stores
                       where user_id = auth.uid() and store_id = p_store_id)
           or (not exists (select 1 from public.fin_users
                            where id = auth.uid() and is_active)
               and public.covers_store(p_store_id))
         ));
$$;

create or replace function public.fin_can_write(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fin_is_system()
     or (public.fin_can_read(p_store_id)
         and coalesce(public.fin_my_role() <> 'viewer', false));
$$;

grant execute on function public.fin_is_system() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Posting one sale
--
-- Creates the voucher the first time it sees the sale, then keeps the
-- settled amount in step: a customer paying off their balance later adds
-- a receipt for the difference rather than rewriting anything.
-- ---------------------------------------------------------------------
create or replace function public.fin_post_pos_sale(p_sale_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s          record;
  v_voucher  uuid;
  v_channel  text;
  v_paid_now numeric;
  v_settled  numeric;
  v_delta    numeric;
  v_code     text;
begin
  perform set_config('fin.system', 'on', true);

  select * into s from public.sales where id = p_sale_id;
  if not found or s.order_status = 'cancelled' then
    perform set_config('fin.system', 'off', true);
    return null;
  end if;

  select id into v_voucher from public.fin_vouchers
   where source_type = 'pos_sale' and source_id = s.id;

  v_channel := case
    when s.order_type = 'wholesale' then 'wholesale'
    when s.order_type in ('online','delivery') then 'online'
    when s.sale_rep_id is not null then 'salesman'
    else 'showroom' end;

  v_paid_now := greatest(coalesce(s.total, 0) - coalesce(s.balance_due, 0), 0);

  select code into v_code from public.fin_accounts
   where id = public.fin_method_account(s.payment_method, s.store_id);

  if v_voucher is null then
    v_voucher := public.fin_save_voucher(jsonb_build_object(
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
          else '4000' end)),
      'payment', case when v_paid_now > 0 then jsonb_build_object(
        'amount', v_paid_now,
        'method', s.payment_method,
        'account_code', v_code) else null end
    ));
    perform set_config('fin.system', 'off', true);
    return v_voucher;
  end if;

  -- Already booked: settle whatever has been paid since.
  select paid_amount + discount_taken into v_settled
    from public.fin_vouchers where id = v_voucher;

  v_delta := round(v_paid_now - coalesce(v_settled, 0), 2);

  if v_delta > 0 then
    perform public.fin_record_payment(jsonb_build_object(
      'payment_date', current_date::text,
      'direction', 'in',
      'store_id', s.store_id,
      'account_code', v_code,
      'method', s.payment_method,
      'party_type', case when s.customer_id is not null then 'customer' else 'other' end,
      'party_id', s.customer_id,
      'party_name', coalesce(s.customer_name, 'Walk-in'),
      'amount', v_delta,
      'reference', 'pos_sale:' || s.id::text,
      'allocations', jsonb_build_array(jsonb_build_object(
        'voucher_id', v_voucher, 'amount', v_delta))
    ));
  end if;

  perform set_config('fin.system', 'off', true);
  return v_voucher;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Posting one purchase order, and one PO payment
-- ---------------------------------------------------------------------
create or replace function public.fin_post_purchase_order(p_po_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  po       record;
  v_items  jsonb;
  v_store  text;
  v_result uuid;
begin
  perform set_config('fin.system', 'on', true);

  select o.*, s.name as supplier_name
    into po
    from public.purchase_orders o
    left join public.suppliers s on s.id = o.supplier_id
   where o.id = p_po_id;

  if not found or po.status not in ('received','partial') then
    perform set_config('fin.system', 'off', true);
    return null;
  end if;

  if exists (select 1 from public.fin_vouchers
              where source_type = 'pos_po' and source_id = po.id) then
    perform set_config('fin.system', 'off', true);
    return null;
  end if;

  select value into v_store from public.fin_settings where key = 'po_store';

  select jsonb_agg(jsonb_build_object(
           'description', coalesce(pr.name, 'Item'),
           'product_id', i.product_id,
           'qty', i.billed_qty,
           'unit_price', i.unit_cost,
           'account_code', '5100'))
    into v_items
  from (
    select poi.product_id, poi.unit_cost,
           case when coalesce(poi.received_qty, 0) > 0 then poi.received_qty else poi.qty end
             as billed_qty
    from public.purchase_order_items poi
    where poi.po_id = po.id
  ) i
  left join public.products pr on pr.id = i.product_id
  where i.billed_qty > 0;

  if v_items is null then
    perform set_config('fin.system', 'off', true);
    return null;
  end if;

  v_result := public.fin_save_voucher(jsonb_build_object(
    'kind', 'purchase',
    'voucher_date', po.order_date::text,
    'due_date', po.expected_date::text,
    'store_id', v_store,
    'party_type', 'supplier',
    'party_id', po.supplier_id,
    'party_name', coalesce(po.supplier_name, 'Unknown supplier'),
    'source_type', 'pos_po',
    'source_id', po.id,
    'note', 'PO ' || coalesce(po.po_number, ''),
    'items', v_items
  ));

  perform set_config('fin.system', 'off', true);
  return v_result;
end;
$$;

create or replace function public.fin_post_po_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay     record;
  v       record;
  v_code  text;
  v_result uuid;
begin
  perform set_config('fin.system', 'on', true);

  select * into pay from public.po_payments where id = p_payment_id;
  if not found then
    perform set_config('fin.system', 'off', true);
    return null;
  end if;

  if exists (select 1 from public.fin_payments
              where reference = 'po_payment:' || pay.id::text) then
    perform set_config('fin.system', 'off', true);
    return null;
  end if;

  select * into v from public.fin_vouchers
   where source_type = 'pos_po' and source_id = pay.po_id;

  -- A payment can arrive before the goods do; the bill is posted when the
  -- PO is received, and the sweep picks the payment up then.
  if not found then
    perform public.fin_post_purchase_order(pay.po_id);
    perform set_config('fin.system', 'on', true);
    select * into v from public.fin_vouchers
     where source_type = 'pos_po' and source_id = pay.po_id;
    if not found then
      perform set_config('fin.system', 'off', true);
      return null;
    end if;
  end if;

  select code into v_code from public.fin_accounts
   where id = public.fin_method_account(pay.method, v.store_id);

  v_result := public.fin_record_payment(jsonb_build_object(
    'payment_date', pay.paid_at::text,
    'direction', 'out',
    'store_id', v.store_id,
    'account_code', v_code,
    'method', pay.method,
    'party_type', 'supplier',
    'party_id', v.party_id,
    'party_name', v.party_name,
    'amount', pay.amount,
    'reference', 'po_payment:' || pay.id::text,
    'note', pay.note,
    'allocations', jsonb_build_array(jsonb_build_object(
      'voucher_id', v.id, 'amount', pay.amount))
  ));

  perform set_config('fin.system', 'off', true);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The triggers
--
-- Each one swallows its own failure. A bug in the ledger must never cost
-- a customer their receipt, so the error is filed and the sale commits.
-- ---------------------------------------------------------------------
create or replace function public.fin_sales_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.fin_post_pos_sale(new.id);
  exception when others then
    perform set_config('fin.system', 'off', true);
    insert into public.fin_sync_errors (source_type, source_id, message)
    values ('sale', new.id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists sales_fin_sync on public.sales;
create trigger sales_fin_sync
  after insert or update of balance_due, total, order_status, payment_method
  on public.sales
  for each row execute function public.fin_sales_sync_trigger();

create or replace function public.fin_po_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.fin_post_purchase_order(new.id);
  exception when others then
    perform set_config('fin.system', 'off', true);
    insert into public.fin_sync_errors (source_type, source_id, message)
    values ('purchase_order', new.id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists purchase_orders_fin_sync on public.purchase_orders;
create trigger purchase_orders_fin_sync
  after insert or update of status on public.purchase_orders
  for each row execute function public.fin_po_sync_trigger();

create or replace function public.fin_po_payment_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.fin_post_po_payment(new.id);
  exception when others then
    perform set_config('fin.system', 'off', true);
    insert into public.fin_sync_errors (source_type, source_id, message)
    values ('po_payment', new.id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists po_payments_fin_sync on public.po_payments;
create trigger po_payments_fin_sync
  after insert on public.po_payments
  for each row execute function public.fin_po_payment_sync_trigger();

-- ---------------------------------------------------------------------
-- 6. The safety net
--
-- Triggers cover what happens from now on. This catches anything they
-- missed - a failure, a row written while the trigger was being replaced,
-- or the whole back catalogue on the day this goes live - and is safe to
-- run as often as you like. Run it by hand, or on a schedule if pg_cron
-- is enabled (Dashboard -> Database -> Extensions):
--
--   select cron.schedule('finance-sweep', '*/15 * * * *',
--                        $$select public.fin_sync_sweep()$$);
--
-- Returns what it posted.
-- ---------------------------------------------------------------------
create or replace function public.fin_sync_sweep(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          record;
  v_sales    integer := 0;
  v_pos      integer := 0;
  v_payments integer := 0;
begin
  for r in
    select s.id from public.sales s
    where s.order_status <> 'cancelled'
      and not exists (select 1 from public.fin_vouchers v
                       where v.source_type = 'pos_sale' and v.source_id = s.id)
    order by s.created_at
    limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      perform public.fin_post_pos_sale(r.id);
      v_sales := v_sales + 1;
    exception when others then
      insert into public.fin_sync_errors (source_type, source_id, message)
      values ('sale', r.id, sqlerrm);
    end;
  end loop;

  for r in
    select o.id from public.purchase_orders o
    where o.status in ('received','partial')
      and not exists (select 1 from public.fin_vouchers v
                       where v.source_type = 'pos_po' and v.source_id = o.id)
    order by o.order_date
    limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      perform public.fin_post_purchase_order(r.id);
      v_pos := v_pos + 1;
    exception when others then
      insert into public.fin_sync_errors (source_type, source_id, message)
      values ('purchase_order', r.id, sqlerrm);
    end;
  end loop;

  for r in
    select p.id from public.po_payments p
    where not exists (select 1 from public.fin_payments fp
                       where fp.reference = 'po_payment:' || p.id::text)
    order by p.paid_at
    limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      perform public.fin_post_po_payment(r.id);
      v_payments := v_payments + 1;
    exception when others then
      insert into public.fin_sync_errors (source_type, source_id, message)
      values ('po_payment', r.id, sqlerrm);
    end;
  end loop;

  -- A sale settled after it was booked: bring the receipts up to date.
  for r in
    select v.source_id as id from public.fin_vouchers v
    join public.sales s on s.id = v.source_id
    where v.source_type = 'pos_sale'
      and round(greatest(coalesce(s.total,0) - coalesce(s.balance_due,0), 0), 2)
          > round(v.paid_amount + v.discount_taken, 2)
    limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      perform public.fin_post_pos_sale(r.id);
      v_payments := v_payments + 1;
    exception when others then
      insert into public.fin_sync_errors (source_type, source_id, message)
      values ('sale', r.id, sqlerrm);
    end;
  end loop;

  perform set_config('fin.system', 'off', true);
  return jsonb_build_object('sales', v_sales, 'purchase_orders', v_pos, 'payments', v_payments);
end;
$$;

grant execute on function public.fin_sync_sweep(integer) to authenticated;
