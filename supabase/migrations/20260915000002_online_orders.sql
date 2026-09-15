-- =====================================================================
-- 20260915000002: Online orders become receivables
-- Repo path: supabase/migrations/20260915000002_online_orders.sql
--
-- Orders taken in the Messenger CRM never reach the POS `sales` table,
-- so the money owed on them was invisible to the books - at the time of
-- writing, 70 orders and about 11.3m MMK of it.
--
-- An order is only a sale once it is confirmed. Orders still sitting at
-- 'pending' are quotes in all but name, and booking them would overstate
-- revenue, so they are skipped unless asked for.
--
-- Money already collected comes across the same way it does for the POS:
-- each msgr_order_payments row is mirrored once, and an order carrying a
-- deposit with no payment row gets one receipt for it.
--
-- Idempotent - safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Which branch an online shop's orders belong to
--
-- msgr_orders.shop_id is the CRM's own shop id, unrelated to the POS
-- store code, so the two are mapped here. Anything unmapped falls back
-- to fin_settings.online_store, which means a new shop shows up in the
-- books immediately rather than silently going missing.
-- ---------------------------------------------------------------------
create table if not exists public.fin_shop_stores (
  shop_id  uuid primary key,
  store_id text not null references public.stores(id) on delete cascade,
  label    text,
  created_at timestamptz not null default now()
);

alter table public.fin_shop_stores enable row level security;

drop policy if exists "read fin_shop_stores" on public.fin_shop_stores;
create policy "read fin_shop_stores" on public.fin_shop_stores
  for select to authenticated using (public.is_finance());

drop policy if exists "admin write fin_shop_stores" on public.fin_shop_stores;
create policy "admin write fin_shop_stores" on public.fin_shop_stores
  for all to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

grant select, insert, update, delete on public.fin_shop_stores to authenticated;

insert into public.fin_settings (key, value, label)
select 'online_store',
       coalesce((select id from public.stores
                  where is_active and not is_warehouse order by id limit 1), 'SR-BAK'),
       'Branch that unmapped online orders are booked against'
on conflict (key) do nothing;

create or replace function public.fin_shop_store(p_shop_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select store_id from public.fin_shop_stores where shop_id = p_shop_id),
    (select value from public.fin_settings where key = 'online_store'));
$$;

grant execute on function public.fin_shop_store(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Posting one online order
-- ---------------------------------------------------------------------
create or replace function public.fin_post_online_order(
  p_order_id uuid,
  p_include_pending boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o         record;
  v_store   text;
  v_items   jsonb;
  v_voucher uuid;
  v_party   uuid;
  v_paid    numeric;
  v_settled numeric;
  v_delta   numeric;
  v_code    text;
  pay       record;
begin
  perform set_config('fin.system', 'on', true);

  select * into o from public.msgr_orders where id = p_order_id;

  if not found
     or coalesce(o.status, '') in ('cancelled', 'void')
     or (not p_include_pending and coalesce(o.status, 'pending') = 'pending') then
    perform set_config('fin.system', 'off', true);
    return null;
  end if;

  v_store := public.fin_shop_store(o.shop_id);

  -- The CRM contact may already be promoted into a POS customer; if so the
  -- voucher hangs off that customer, so one person's balance is one figure
  -- however the order came in.
  select c.customer_id into v_party
    from public.msgr_contacts c where c.id = o.contact_id;

  select id into v_voucher from public.fin_vouchers
   where source_type = 'msgr_order' and source_id = o.id;

  if v_voucher is null then
    select jsonb_agg(jsonb_build_object(
             'description', coalesce(nullif(i.description, ''), i.barcode, 'Item'),
             'qty', i.qty,
             'unit_price', i.unit_price,
             'account_code', '4020'))
      into v_items
    from public.msgr_order_items i
    where i.order_id = o.id and coalesce(i.qty, 0) > 0;

    -- An order with no lines still owes money; book it as one line so the
    -- receivable is right even when the CRM never itemised it.
    if v_items is null then
      v_items := jsonb_build_array(jsonb_build_object(
        'description', 'Online order #' || coalesce(o.order_no::text, ''),
        'qty', 1,
        'unit_price', coalesce(o.grand_total, 0)
                      + coalesce(o.discount, 0) - coalesce(o.delivery_fee, 0),
        'account_code', '4020'));
    end if;

    -- Delivery is charged to the customer, so it belongs on the invoice as
    -- its own line rather than buried in the goods.
    if coalesce(o.delivery_fee, 0) > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'description', 'Delivery',
        'qty', 1,
        'unit_price', o.delivery_fee,
        'account_code', '4100'));
    end if;

    v_voucher := public.fin_save_voucher(jsonb_build_object(
      'kind', 'sale',
      'voucher_date', coalesce(o.order_date, o.created_at::date)::text,
      'store_id', v_store,
      'channel', 'online',
      'sale_rep_name', o.sales_person_name,
      'party_type', case when v_party is not null then 'customer' else 'other' end,
      'party_id', v_party,
      'party_name', coalesce(nullif(o.customer_name, ''), o.phone, 'Online customer'),
      'trade_discount', coalesce(o.discount, 0),
      'source_type', 'msgr_order',
      'source_id', o.id,
      'note', 'Online order #' || coalesce(o.order_no::text, '') ||
              coalesce(' · ' || nullif(o.order_channel_name, ''), ''),
      'items', v_items
    ));
  end if;

  -- ---- money in ----
  -- Every recorded payment, mirrored once.
  for pay in
    select p.* from public.msgr_order_payments p
    where p.order_id = o.id
      and coalesce(p.amount, 0) > 0
      and not exists (select 1 from public.fin_payments fp
                       where fp.reference = 'msgr_payment:' || p.id::text)
  loop
    select code into v_code from public.fin_accounts
     where id = public.fin_method_account(
                  coalesce(nullif(pay.channel_name, ''), o.payment_method), v_store);

    perform public.fin_record_payment(jsonb_build_object(
      'payment_date', coalesce(pay.paid_at, o.order_date, current_date)::text,
      'direction', 'in',
      'store_id', v_store,
      'account_code', v_code,
      'method', coalesce(nullif(pay.channel_name, ''), o.payment_method),
      'party_type', case when v_party is not null then 'customer' else 'other' end,
      'party_id', v_party,
      'party_name', coalesce(nullif(o.customer_name, ''), o.phone, 'Online customer'),
      'amount', pay.amount,
      'reference', 'msgr_payment:' || pay.id::text,
      'note', pay.note,
      'allocations', jsonb_build_array(jsonb_build_object(
        'voucher_id', v_voucher, 'amount', pay.amount))
    ));
  end loop;

  -- A deposit recorded on the order itself, with no payment row behind it.
  v_paid := greatest(coalesce(o.amount_received, o.advance_payment, 0), 0);

  select paid_amount + discount_taken into v_settled
    from public.fin_vouchers where id = v_voucher;

  v_delta := round(v_paid - coalesce(v_settled, 0), 2);

  if v_delta > 0 then
    select code into v_code from public.fin_accounts
     where id = public.fin_method_account(o.payment_method, v_store);

    perform public.fin_record_payment(jsonb_build_object(
      'payment_date', coalesce(o.order_date, current_date)::text,
      'direction', 'in',
      'store_id', v_store,
      'account_code', v_code,
      'method', o.payment_method,
      'party_type', case when v_party is not null then 'customer' else 'other' end,
      'party_id', v_party,
      'party_name', coalesce(nullif(o.customer_name, ''), o.phone, 'Online customer'),
      'amount', v_delta,
      'reference', 'msgr_order_advance:' || o.id::text,
      'allocations', jsonb_build_array(jsonb_build_object(
        'voucher_id', v_voucher, 'amount', v_delta))
    ));
  end if;

  perform set_config('fin.system', 'off', true);
  return v_voucher;
end;
$$;

grant execute on function public.fin_post_online_order(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Triggers - an order lands in the books as the CRM saves it
-- ---------------------------------------------------------------------
create or replace function public.fin_msgr_order_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.fin_post_online_order(new.id);
  exception when others then
    perform set_config('fin.system', 'off', true);
    insert into public.fin_sync_errors (source_type, source_id, message)
    values ('msgr_order', new.id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists msgr_orders_fin_sync on public.msgr_orders;
create trigger msgr_orders_fin_sync
  after insert or update of status, amount_received, advance_payment, grand_total,
                            discount, delivery_fee, shop_id
  on public.msgr_orders
  for each row execute function public.fin_msgr_order_sync_trigger();

create or replace function public.fin_msgr_payment_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.fin_post_online_order(new.order_id);
  exception when others then
    perform set_config('fin.system', 'off', true);
    insert into public.fin_sync_errors (source_type, source_id, message)
    values ('msgr_order_payment', new.id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists msgr_order_payments_fin_sync on public.msgr_order_payments;
create trigger msgr_order_payments_fin_sync
  after insert on public.msgr_order_payments
  for each row execute function public.fin_msgr_payment_sync_trigger();

-- ---------------------------------------------------------------------
-- 4. Backfill and catch-up
--
-- Extends the existing sweep so one call still covers everything.
-- ---------------------------------------------------------------------
create or replace function public.fin_sync_online_orders(
  p_limit integer default 500,
  p_include_pending boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_orders integer := 0;
  v_pays   integer := 0;
begin
  for r in
    select o.id from public.msgr_orders o
    where coalesce(o.status, '') not in ('cancelled', 'void')
      and (p_include_pending or coalesce(o.status, 'pending') <> 'pending')
      and not exists (select 1 from public.fin_vouchers v
                       where v.source_type = 'msgr_order' and v.source_id = o.id)
    order by o.order_date
    limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      perform public.fin_post_online_order(r.id, p_include_pending);
      v_orders := v_orders + 1;
    exception when others then
      perform set_config('fin.system', 'off', true);
      insert into public.fin_sync_errors (source_type, source_id, message)
      values ('msgr_order', r.id, sqlerrm);
    end;
  end loop;

  -- Orders already booked whose collected amount has moved on since.
  for r in
    select v.source_id as id from public.fin_vouchers v
    join public.msgr_orders o on o.id = v.source_id
    where v.source_type = 'msgr_order'
      and round(greatest(coalesce(o.amount_received, o.advance_payment, 0), 0), 2)
          > round(v.paid_amount + v.discount_taken, 2)
    limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      perform public.fin_post_online_order(r.id, true);
      v_pays := v_pays + 1;
    exception when others then
      perform set_config('fin.system', 'off', true);
      insert into public.fin_sync_errors (source_type, source_id, message)
      values ('msgr_order', r.id, sqlerrm);
    end;
  end loop;

  perform set_config('fin.system', 'off', true);
  return jsonb_build_object('orders', v_orders, 'payments', v_pays);
end;
$$;

grant execute on function public.fin_sync_online_orders(integer, boolean) to authenticated;
