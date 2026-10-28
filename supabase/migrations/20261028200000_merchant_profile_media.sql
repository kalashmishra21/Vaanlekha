-- Merchant-owned profile details and a private, shop-scoped image bucket.
alter table public.shops
  add column phone text check (phone is null or length(trim(phone)) between 6 and 20),
  add column logo_path text;
alter table public.shops add constraint shops_logo_path_owner_check
  check (logo_path is null or logo_path = id::text || '/logo');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-logos', 'shop-logos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy shop_logos_owner_read on storage.objects for select to authenticated
using (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(name))[1] and s.owner_id = (select auth.uid())
));
create policy shop_logos_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(name))[1] and s.owner_id = (select auth.uid())
));
create policy shop_logos_owner_update on storage.objects for update to authenticated
using (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(name))[1] and s.owner_id = (select auth.uid())
)) with check (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(name))[1] and s.owner_id = (select auth.uid())
));
