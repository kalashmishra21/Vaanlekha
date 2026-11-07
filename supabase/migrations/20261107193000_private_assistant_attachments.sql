-- Private, owner-scoped files for saved assistant messages. Unattached upload
-- tickets expire after 24 hours and are removed on the owner's next history
-- load; attached files remain until their conversation is deleted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assistant-attachments', 'assistant-attachments', false, 5000000,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.assistant_message_attachments (
  id uuid primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  message_id uuid references public.assistant_messages(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_size integer not null check (file_size between 1 and 5000000),
  attachment_type text not null check (attachment_type in ('image', 'pdf')),
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  check ((attachment_type = 'pdf' and mime_type = 'application/pdf') or
         (attachment_type = 'image' and mime_type like 'image/%')),
  check (storage_path = shop_id::text || '/' || conversation_id::text || '/' || owner_id::text || '/' || id::text)
);

create index assistant_attachments_unlinked_expiry
  on public.assistant_message_attachments(owner_id, created_at) where message_id is null;
create index assistant_attachments_message on public.assistant_message_attachments(message_id);

alter table public.assistant_message_attachments enable row level security;
revoke all on public.assistant_message_attachments from public, anon;
grant select, insert, update(message_id, uploaded_at), delete on public.assistant_message_attachments to authenticated;

create policy assistant_attachments_owner_select on public.assistant_message_attachments
for select to authenticated using (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.shops s join public.assistant_conversations c on c.shop_id = s.id
    where s.id = assistant_message_attachments.shop_id and s.owner_id = (select auth.uid())
      and c.id = assistant_message_attachments.conversation_id and c.owner_id = (select auth.uid())
  )
);
create policy assistant_attachments_owner_insert on public.assistant_message_attachments
for insert to authenticated with check (
  owner_id = (select auth.uid()) and message_id is null and uploaded_at is null and exists (
    select 1 from public.shops s join public.assistant_conversations c on c.shop_id = s.id
    where s.id = assistant_message_attachments.shop_id and s.owner_id = (select auth.uid())
      and c.id = assistant_message_attachments.conversation_id and c.owner_id = (select auth.uid())
  )
);
create policy assistant_attachments_owner_update on public.assistant_message_attachments
for update to authenticated using (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.shops s join public.assistant_conversations c on c.shop_id = s.id
    where s.id = assistant_message_attachments.shop_id and s.owner_id = (select auth.uid())
      and c.id = assistant_message_attachments.conversation_id and c.owner_id = (select auth.uid())
  )
) with check (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.shops s join public.assistant_conversations c on c.shop_id = s.id
    where s.id = shop_id and s.owner_id = (select auth.uid())
      and c.id = conversation_id and c.owner_id = (select auth.uid())
  ) and (message_id is null or exists (
    select 1 from public.assistant_messages m
    where m.id = assistant_message_attachments.message_id
      and m.conversation_id = assistant_message_attachments.conversation_id
      and m.shop_id = assistant_message_attachments.shop_id
      and m.owner_id = assistant_message_attachments.owner_id and m.role = 'user'
  ))
);
create policy assistant_attachments_owner_delete on public.assistant_message_attachments
for delete to authenticated using (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.shops s join public.assistant_conversations c on c.shop_id = s.id
    where s.id = assistant_message_attachments.shop_id and s.owner_id = (select auth.uid())
      and c.id = assistant_message_attachments.conversation_id and c.owner_id = (select auth.uid())
  )
);

create policy assistant_attachment_objects_owner_select on storage.objects
for select to authenticated using (
  bucket_id = 'assistant-attachments' and exists (
    select 1 from public.assistant_message_attachments a
    where a.storage_path = storage.objects.name and a.shop_id::text = (storage.foldername(storage.objects.name))[1]
      and a.conversation_id::text = (storage.foldername(storage.objects.name))[2]
      and a.owner_id::text = (storage.foldername(storage.objects.name))[3]
      and a.owner_id = (select auth.uid())
  )
);
create policy assistant_attachment_objects_owner_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'assistant-attachments' and exists (
    select 1 from public.assistant_message_attachments a
    where a.storage_path = storage.objects.name and a.shop_id::text = (storage.foldername(storage.objects.name))[1]
      and a.conversation_id::text = (storage.foldername(storage.objects.name))[2]
      and a.owner_id::text = (storage.foldername(storage.objects.name))[3]
      and a.owner_id = (select auth.uid()) and a.uploaded_at is null
  )
);
create policy assistant_attachment_objects_owner_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'assistant-attachments' and exists (
    select 1 from public.assistant_message_attachments a
    where a.storage_path = storage.objects.name and a.owner_id = (select auth.uid())
      and a.shop_id::text = (storage.foldername(storage.objects.name))[1]
      and a.conversation_id::text = (storage.foldername(storage.objects.name))[2]
  )
);
