create function public.enforce_indian_mobile_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is not null and new.phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Phone must be a 10-digit Indian mobile number.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger shops_indian_mobile_phone
before insert or update of phone on public.shops
for each row execute function public.enforce_indian_mobile_phone();

create trigger customers_indian_mobile_phone
before insert or update of phone on public.customers
for each row execute function public.enforce_indian_mobile_phone();

create trigger suppliers_indian_mobile_phone
before insert or update of phone on public.suppliers
for each row execute function public.enforce_indian_mobile_phone();
