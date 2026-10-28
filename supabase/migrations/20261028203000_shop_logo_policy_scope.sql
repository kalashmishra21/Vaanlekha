-- Qualify the outer storage object path. Unqualified name in the original
-- subquery bound to shops.name, so every owner upload failed its RLS check.
alter policy shop_logos_owner_read on storage.objects
using (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(storage.objects.name))[1]
    and s.owner_id = (select auth.uid())
));

alter policy shop_logos_owner_insert on storage.objects
with check (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(storage.objects.name))[1]
    and s.owner_id = (select auth.uid())
));

alter policy shop_logos_owner_update on storage.objects
using (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(storage.objects.name))[1]
    and s.owner_id = (select auth.uid())
)) with check (bucket_id = 'shop-logos' and exists (
  select 1 from public.shops s
  where s.id::text = (storage.foldername(storage.objects.name))[1]
    and s.owner_id = (select auth.uid())
));
