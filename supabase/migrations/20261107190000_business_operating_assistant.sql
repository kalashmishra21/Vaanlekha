-- Add stable references and auditable, bounded business operations without
-- rewriting or deleting existing sales, khata, supplier, or order records.

create sequence public.customer_reference_seq;
create sequence public.purchase_order_reference_seq;

-- Aggregate in the database so a shop with more than the PostgREST row cap
-- still receives an exact total without loading individual sale records.
create function public.get_shop_sales_summary(p_shop_id uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', coalesce(sum(sales.total_amount), 0),
    'count', count(*)
  )
  from public.sales as sales
  where sales.shop_id = p_shop_id
    and sales.created_at >= p_start
    and sales.created_at < p_end;
$$;
revoke all on function public.get_shop_sales_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_shop_sales_summary(uuid, timestamptz, timestamptz) to authenticated;

create function public.next_customer_reference() returns text
language sql volatile security definer set search_path = '' as $$
  select 'VL-CU-' || lpad(nextval('public.customer_reference_seq')::text, 6, '0');
$$;
revoke execute on function public.next_customer_reference() from public, anon, authenticated;

create function public.assign_customer_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.customer_code := public.next_customer_reference();
  return new;
end;
$$;
revoke execute on function public.assign_customer_reference() from public, anon, authenticated;

create function public.next_purchase_order_reference() returns text
language sql volatile security definer set search_path = '' as $$
  select 'VL-PO-' || to_char(clock_timestamp() at time zone 'Asia/Kolkata', 'YYYY') || '-'
    || lpad(nextval('public.purchase_order_reference_seq')::text, 6, '0');
$$;
revoke execute on function public.next_purchase_order_reference() from public, anon, authenticated;

create function public.assign_purchase_order_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.order_number := public.next_purchase_order_reference();
  return new;
end;
$$;
revoke execute on function public.assign_purchase_order_reference() from public, anon, authenticated;

alter table public.customers add column customer_code text;
-- Customer names are labels, not identities. Remove the per-shop unique-name
-- index so two people with the same name can have distinct customer codes.
drop index if exists public.customers_shop_name_unique;
update public.customers
set customer_code = public.next_customer_reference()
where customer_code is null;
alter table public.customers alter column customer_code set not null;
alter table public.customers add constraint customers_shop_customer_code_key unique (shop_id, customer_code);
create trigger customers_assign_reference
  before insert on public.customers
  for each row execute function public.assign_customer_reference();

alter table public.suppliers add column is_active boolean not null default true;
create index suppliers_shop_active_name_idx on public.suppliers(shop_id, is_active, name);

alter table public.purchase_orders
  add column order_number text,
  add column total_amount numeric(12,2);
create trigger purchase_orders_assign_reference
  before insert on public.purchase_orders
  for each row execute function public.assign_purchase_order_reference();
with ordered_orders as materialized (
  select id, created_at
  from public.purchase_orders
  where order_number is null
  order by created_at, id
), numbered_orders as materialized (
  select id, created_at, public.next_purchase_order_reference() as reference
  from ordered_orders
)
update public.purchase_orders as orders
set order_number = numbered_orders.reference
from numbered_orders
where orders.id = numbered_orders.id;
update public.purchase_orders as orders
set total_amount = coalesce((
  select sum(items.quantity * items.unit_cost)
  from public.purchase_order_items as items
  where items.order_id = orders.id and items.shop_id = orders.shop_id
), 0);
alter table public.purchase_orders alter column order_number set not null;
alter table public.purchase_orders alter column total_amount set default 0;
alter table public.purchase_orders alter column total_amount set not null;
alter table public.purchase_orders add constraint purchase_orders_order_number_key unique (order_number);
alter table public.purchase_orders add constraint purchase_orders_total_amount_check check (total_amount >= 0);

create function public.protect_purchase_order_reference() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.order_number is distinct from new.order_number then
    raise exception 'Purchase-order reference is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger purchase_orders_protect_reference
  before update of order_number on public.purchase_orders
  for each row execute function public.protect_purchase_order_reference();
revoke execute on function public.protect_purchase_order_reference() from public, anon, authenticated;

create function public.refresh_purchase_order_total(p_order_id uuid, p_shop_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.purchase_orders as orders
  set total_amount = coalesce((
    select sum(items.quantity * items.unit_cost)
    from public.purchase_order_items as items
    where items.order_id = p_order_id and items.shop_id = p_shop_id
  ), 0)
  where orders.id = p_order_id and orders.shop_id = p_shop_id;
$$;
revoke execute on function public.refresh_purchase_order_total(uuid, uuid) from public, anon, authenticated;

create function public.sync_purchase_order_total_from_items() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (old.order_id, old.shop_id) is distinct from (new.order_id, new.shop_id)) then
    perform public.refresh_purchase_order_total(old.order_id, old.shop_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.refresh_purchase_order_total(new.order_id, new.shop_id);
  end if;
  return null;
end;
$$;
create trigger purchase_order_items_sync_total
  after insert or update or delete on public.purchase_order_items
  for each row execute function public.sync_purchase_order_total_from_items();
revoke execute on function public.sync_purchase_order_total_from_items() from public, anon, authenticated;

create table public.purchase_order_status_history (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid not null,
  from_status text check (from_status is null or from_status in ('draft', 'placed', 'received', 'cancelled')),
  to_status text not null check (to_status in ('draft', 'placed', 'received', 'cancelled')),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (order_id, shop_id) references public.purchase_orders(id, shop_id)
);
alter table public.purchase_order_status_history enable row level security;
create policy purchase_order_status_history_owner_read on public.purchase_order_status_history
  for select to authenticated
  using (shop_id in (select id from public.shops where owner_id = (select auth.uid())));
revoke all on public.purchase_order_status_history from public, anon, authenticated;
grant select on public.purchase_order_status_history to authenticated;
create index purchase_order_status_history_order_idx
  on public.purchase_order_status_history(shop_id, order_id, changed_at);

insert into public.purchase_order_status_history(shop_id, order_id, from_status, to_status, changed_at)
select shop_id, id, null, status, created_at
from public.purchase_orders;

create function public.log_purchase_order_status_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.purchase_order_status_history(shop_id, order_id, from_status, to_status, changed_by)
    values (new.shop_id, new.id, null, new.status, (select auth.uid()));
  elsif old.status is distinct from new.status then
    insert into public.purchase_order_status_history(shop_id, order_id, from_status, to_status, changed_by)
    values (new.shop_id, new.id, old.status, new.status, (select auth.uid()));
  end if;
  return new;
end;
$$;
create trigger purchase_orders_log_status_change
  after insert or update of status on public.purchase_orders
  for each row execute function public.log_purchase_order_status_change();
revoke execute on function public.log_purchase_order_status_change() from public, anon, authenticated;

alter table public.sales add column customer_id uuid;
alter table public.sales add constraint sales_customer_id_shop_id_fkey
  foreign key (customer_id, shop_id) references public.customers(id, shop_id);
alter table public.khata_entries add column sale_id uuid;
alter table public.khata_entries add constraint khata_entries_sale_id_shop_id_fkey
  foreign key (sale_id, shop_id) references public.sales(id, shop_id);
create unique index khata_entries_one_sale_receivable_idx
  on public.khata_entries(sale_id) where sale_id is not null;
create index sales_customer_shop_created_idx on public.sales(shop_id, customer_id, created_at desc);

-- A repayment is serialized against the customer's ledger and cannot take the
-- outstanding amount below zero. The ledger remains append-only and auditable.
create or replace function public.add_khata_entry_idempotent(
  p_shop_id uuid, p_request_key uuid, p_customer_id uuid,
  p_type text, p_amount numeric, p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_id uuid;
  v_payload jsonb;
  v_balance numeric(14,2);
begin
  v_payload := jsonb_build_object('customerId', p_customer_id, 'type', p_type,
    'amount', p_amount, 'note', p_note);
  v_replay := public.claim_business_idempotency(p_shop_id, p_request_key, 'khata.addEntry', v_payload);
  if v_replay is not null then return (v_replay ->> 'id')::uuid; end if;
  if p_type not in ('gave', 'received') or p_amount is null or p_amount <= 0
    or p_amount > 999999999 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid khata entry' using errcode = '22023';
  end if;
  perform 1 from public.customers
  where id = p_customer_id and shop_id = p_shop_id
  for update;
  if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  select coalesce(sum(case when type = 'gave' then amount else -amount end), 0)
  into v_balance
  from public.khata_entries
  where customer_id = p_customer_id and shop_id = p_shop_id;
  if p_type = 'received' and p_amount > greatest(v_balance, 0) then
    raise exception 'Repayment exceeds the outstanding balance' using errcode = '23514';
  end if;
  insert into public.khata_entries(shop_id, customer_id, type, amount, note)
  values (p_shop_id, p_customer_id, p_type, p_amount, nullif(trim(p_note), ''))
  returning id into v_id;
  update public.business_idempotency set response = jsonb_build_object('id', v_id)
  where shop_id = p_shop_id and request_key = p_request_key;
  return v_id;
end;
$$;

alter table public.business_idempotency drop constraint business_idempotency_operation_check;
alter table public.business_idempotency add constraint business_idempotency_operation_check check (operation in (
  'product.create', 'product.adjust', 'customer.create', 'khata.openAccount',
  'khata.addEntry', 'sale.record', 'supplier.create', 'order.createDraft',
  'order.transition', 'order.transition.confirmed', 'sale.record.credit'
));

-- Explicit-credit sales call the existing row-locking sale transaction and
-- create exactly one receivable in that same outer transaction.
create function public.record_credit_sale_idempotent(
  p_shop_id uuid,
  p_request_key uuid,
  p_customer_id uuid,
  p_new_customer_name text,
  p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_replay jsonb;
  v_payload jsonb;
  v_customer_id uuid;
  v_sale_key uuid;
  v_sale jsonb;
  v_sale_id uuid;
  v_total numeric(12,2);
  v_result jsonb;
  v_digest text;
begin
  if (p_customer_id is null) = (nullif(trim(p_new_customer_name), '') is null) then
    raise exception 'Select an existing customer or supply a new customer name' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object('customerId', p_customer_id,
    'newCustomerName', nullif(trim(p_new_customer_name), ''), 'items', p_items);
  v_replay := public.claim_business_idempotency(p_shop_id, p_request_key, 'sale.record.credit', v_payload);
  if v_replay is not null then return v_replay; end if;

  if p_customer_id is not null then
    perform 1 from public.customers where id = p_customer_id and shop_id = p_shop_id for update;
    if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;
    v_customer_id := p_customer_id;
  else
    if length(trim(p_new_customer_name)) not between 1 and 120 then
      raise exception 'Invalid customer name' using errcode = '22023';
    end if;
    insert into public.customers(shop_id, name)
    values (p_shop_id, trim(p_new_customer_name))
    returning id into v_customer_id;
  end if;

  v_digest := md5(p_request_key::text || ':credit-sale');
  v_sale_key := (substr(v_digest, 1, 8) || '-' || substr(v_digest, 9, 4) || '-4' || substr(v_digest, 14, 3)
    || '-8' || substr(v_digest, 18, 3) || '-' || substr(v_digest, 21, 12))::uuid;
  v_sale := public.record_sale_decimal_idempotent(p_shop_id, v_sale_key, p_items, null);
  v_sale_id := (v_sale ->> 'saleId')::uuid;
  v_total := (v_sale ->> 'total')::numeric;
  update public.sales set customer_id = v_customer_id
  where id = v_sale_id and shop_id = p_shop_id;
  if not found then raise exception 'Credit sale could not be linked to its customer' using errcode = 'P0001'; end if;
  insert into public.khata_entries(shop_id, customer_id, type, amount, note, sale_id)
  values (p_shop_id, v_customer_id, 'gave', v_total, 'Credit sale ' || v_sale_id::text, v_sale_id);
  v_result := jsonb_build_object('saleId', v_sale_id, 'customerId', v_customer_id, 'total', v_total);
  update public.business_idempotency set response = v_result
  where shop_id = p_shop_id and request_key = p_request_key;
  return v_result;
end;
$$;
revoke execute on function public.record_credit_sale_idempotent(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.record_credit_sale_idempotent(uuid, uuid, uuid, text, jsonb) to authenticated;
