-- One owner/shop-scoped conversation owns its own clarification and messages.
-- Temporary media, provider keys and raw provider responses never enter these tables.
create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (length(title) between 1 and 80),
  pending jsonb check (pending is null or (jsonb_typeof(pending) = 'object' and length(pending::text) <= 8192)),
  pending_request_key uuid,
  in_flight_key uuid,
  in_flight_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, shop_id, owner_id)
);

create index assistant_conversations_owner_recent on public.assistant_conversations(owner_id, shop_id, updated_at desc);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  shop_id uuid not null,
  owner_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (length(text) between 1 and 1000),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and length(result::text) <= 32000)),
  request_key uuid not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, shop_id, owner_id)
    references public.assistant_conversations(id, shop_id, owner_id) on delete cascade,
  unique (conversation_id, request_key, role)
);

create index assistant_messages_thread_time on public.assistant_messages(conversation_id, created_at, id);
create index assistant_messages_shop_id on public.assistant_messages(shop_id);
create index assistant_messages_owner_id on public.assistant_messages(owner_id);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

create policy assistant_conversations_owner on public.assistant_conversations
  for all to authenticated using (
    owner_id = (select auth.uid()) and exists
      (select 1 from public.shops where id = shop_id and owner_id = (select auth.uid()))
  ) with check (
    owner_id = (select auth.uid()) and exists
      (select 1 from public.shops where id = shop_id and owner_id = (select auth.uid()))
  );

create policy assistant_messages_owner on public.assistant_messages
  for select to authenticated using (
    owner_id = (select auth.uid()) and exists
      (select 1 from public.shops where id = shop_id and owner_id = (select auth.uid()))
  );

revoke all on public.assistant_conversations, public.assistant_messages from public, anon;
grant select, delete, update(title) on public.assistant_conversations to authenticated;
grant select on public.assistant_messages to authenticated;

create function public.create_assistant_conversation(p_shop_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid()); v_id uuid;
begin
  if v_owner is null or not exists (select 1 from public.shops where id = p_shop_id and owner_id = v_owner) then
    raise exception 'Not authorized for this shop' using errcode = '42501';
  end if;
  insert into public.assistant_conversations(shop_id, owner_id) values (p_shop_id, v_owner) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_assistant_conversation(uuid) from public, anon;
grant execute on function public.create_assistant_conversation(uuid) to authenticated;

-- Reserve a thread for one request at a time. The lease is bounded so a crashed
-- provider call cannot leave the conversation locked indefinitely.
create function public.reserve_assistant_turn(p_shop_id uuid, p_conversation_id uuid, p_request_key uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid()); v_thread public.assistant_conversations%rowtype; v_reply jsonb; v_original_text text;
begin
  if v_owner is null or not exists (select 1 from public.shops where id = p_shop_id and owner_id = v_owner) then
    raise exception 'Not authorized for this shop' using errcode = '42501';
  end if;
  if p_request_key is null or length(trim(p_text)) not between 1 and 500 then
    raise exception 'Invalid assistant request' using errcode = '22023';
  end if;
  select * into v_thread from public.assistant_conversations
    where id = p_conversation_id and shop_id = p_shop_id and owner_id = v_owner for update;
  if not found then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  select text into v_original_text from public.assistant_messages
    where conversation_id = p_conversation_id and request_key = p_request_key and role = 'user';
  if found and v_original_text is distinct from trim(p_text) then
    raise exception 'Idempotency key was reused with a different request' using errcode = '22023';
  end if;
  select result into v_reply from public.assistant_messages
    where conversation_id = p_conversation_id and request_key = p_request_key and role = 'assistant';
  if found then return jsonb_build_object('status', 'completed', 'result', v_reply); end if;
  if v_thread.in_flight_until > now() then return jsonb_build_object('status', 'busy'); end if;
  insert into public.assistant_messages(conversation_id, shop_id, owner_id, role, text, request_key)
    values (p_conversation_id, p_shop_id, v_owner, 'user', trim(p_text), p_request_key)
    on conflict (conversation_id, request_key, role) do nothing;
  update public.assistant_conversations set in_flight_key = p_request_key,
    in_flight_until = now() + interval '75 seconds', updated_at = now(),
    title = case when title = 'New conversation' then left(trim(p_text), 80) else title end
    where id = p_conversation_id;
  return jsonb_build_object('status', 'reserved', 'pending', v_thread.pending,
    'pendingRequestKey', v_thread.pending_request_key);
end;
$$;

create function public.complete_assistant_turn(p_shop_id uuid, p_conversation_id uuid, p_request_key uuid,
  p_reply text, p_result jsonb, p_pending jsonb, p_pending_request_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid()); v_thread public.assistant_conversations%rowtype;
begin
  if v_owner is null or not exists (select 1 from public.shops where id = p_shop_id and owner_id = v_owner) then
    raise exception 'Not authorized for this shop' using errcode = '42501';
  end if;
  if length(trim(p_reply)) not between 1 and 1000 or p_result is null or jsonb_typeof(p_result) <> 'object'
    or length(p_result::text) > 32000 or (p_pending is not null and
    (jsonb_typeof(p_pending) <> 'object' or length(p_pending::text) > 8192)) then
    raise exception 'Invalid assistant result' using errcode = '22023';
  end if;
  select * into v_thread from public.assistant_conversations where id = p_conversation_id
    and shop_id = p_shop_id and owner_id = v_owner for update;
  if not found then raise exception 'Conversation not found' using errcode = 'P0002'; end if;
  if v_thread.in_flight_key is distinct from p_request_key then
    raise exception 'Assistant request is stale' using errcode = 'P0001';
  end if;
  insert into public.assistant_messages(conversation_id, shop_id, owner_id, role, text, result, request_key)
    values (p_conversation_id, p_shop_id, v_owner, 'assistant', trim(p_reply), p_result, p_request_key)
    on conflict (conversation_id, request_key, role) do nothing;
  update public.assistant_conversations set pending = p_pending, pending_request_key = p_pending_request_key,
    in_flight_key = null, in_flight_until = null, updated_at = now()
    where id = p_conversation_id;
end;
$$;

revoke execute on function public.reserve_assistant_turn(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.complete_assistant_turn(uuid, uuid, uuid, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.reserve_assistant_turn(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.complete_assistant_turn(uuid, uuid, uuid, text, jsonb, jsonb, uuid) to authenticated;
