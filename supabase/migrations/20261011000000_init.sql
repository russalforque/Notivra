-- Notivra cloud schema (optional sync backend).
--
-- Design notes
-- * Every user table carries owner_id and is protected by Row Level Security: users can only
--   see and change their own rows. No table is readable by anon users.
-- * Client timestamps (created_at, updated_at, deleted_at) are epoch milliseconds from the
--   device; server_updated_at is assigned by the server and drives incremental pulls.
-- * rev is the SERVER revision, incremented only by sync_push. Clients send the revision they
--   last saw (base_rev); a mismatch is a conflict and nothing is overwritten.
-- * Deletes are tombstones (deleted_at) so they propagate to every device.
-- * No foreign keys between content tables: devices sync records in any order while offline,
--   so referential integrity is enforced by the app, not by insert order.

create extension if not exists pgcrypto;

-- ───────────── profiles ─────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── shared column set (documentation) ─────────────
-- id uuid pk, owner_id uuid, rev int, created_at bigint, updated_at bigint, deleted_at bigint,
-- server_updated_at timestamptz

create table public.subjects (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  name text not null check (char_length(name) <= 120),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order double precision not null default 0
);

create table public.folders (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  name text not null check (char_length(name) <= 120),
  subject_id uuid,
  parent_id uuid
);

create table public.notebooks (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  title text not null check (char_length(title) <= 120),
  subject_id uuid,
  folder_id uuid,
  color text not null,
  default_template text not null check (default_template in ('blank', 'lined', 'grid', 'dotted')),
  pinned boolean not null default false,
  purged_at bigint
);

create table public.pages (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  notebook_id uuid not null,
  sort_key double precision not null,
  template text not null check (template in ('blank', 'lined', 'grid', 'dotted')),
  width double precision not null,
  height double precision not null,
  strokes jsonb not null default '[]'::jsonb,
  text_blocks jsonb not null default '[]'::jsonb,
  plain_text text not null default '',
  -- ~8 MB of ink per page is far beyond normal use; protects the database from abuse.
  constraint pages_content_size check (pg_column_size(strokes) + pg_column_size(text_blocks) < 8000000)
);

create table public.documents (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  title text not null check (char_length(title) <= 120),
  subject_id uuid,
  folder_id uuid,
  file_name text not null,
  byte_size bigint not null check (byte_size >= 0),
  page_count integer not null check (page_count >= 0),
  file_key text not null,
  sha256 text not null,
  thumbnail text check (thumbnail is null or char_length(thumbnail) < 200000),
  remote_path text,
  purged_at bigint
);

create table public.annotations (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  document_id uuid not null,
  page_index integer not null check (page_index >= 0),
  color text not null,
  opacity real not null check (opacity >= 0 and opacity <= 1),
  shape jsonb not null
);

create table public.study_sets (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  title text not null check (char_length(title) <= 120),
  subject_id uuid,
  description text not null default '',
  summary text,
  origin text not null check (origin in ('manual', 'ai')),
  source jsonb
);

create table public.study_items (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  set_id uuid not null,
  kind text not null check (kind in ('flashcard', 'multiple_choice', 'true_false', 'short_answer')),
  prompt text not null,
  answer text not null,
  choices jsonb not null default '[]'::jsonb,
  accepted_answers jsonb not null default '[]'::jsonb,
  explanation text not null default '',
  source_ref text,
  sort_order double precision not null default 0,
  srs jsonb not null
);

create table public.study_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  set_id uuid not null,
  mode text not null check (mode in ('flashcards', 'quiz')),
  started_at bigint not null,
  completed_at bigint,
  answers jsonb not null default '[]'::jsonb,
  correct_count integer not null default 0,
  total_count integer not null default 0
);

-- XP events are an append-only ledger; the idempotency key is unique per user.
create table public.xp_events (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  key text not null,
  type text not null,
  amount integer not null check (amount > 0 and amount <= 1000),
  subject_id uuid,
  day_key text not null check (day_key ~ '^\d{4}-\d{2}-\d{2}$'),
  occurred_at bigint not null,
  unique (owner_id, key)
);

-- Static catalog (also defined in the app); readable by everyone signed in.
create table public.achievements (
  id text primary key,
  title text not null,
  description text not null,
  metric text not null,
  threshold integer not null
);

create table public.user_achievements (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  rev integer not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  achievement_id text not null,
  unlocked_at bigint not null,
  unique (owner_id, achievement_id)
);

-- ───────────── indexes for incremental pulls and lookups ─────────────
do $$
declare t text;
begin
  foreach t in array array['subjects','folders','notebooks','pages','documents','annotations','study_sets','study_items','study_sessions','xp_events','user_achievements']
  loop
    execute format('create index %I on public.%I (owner_id, server_updated_at)', t || '_pull_idx', t);
  end loop;
end $$;
create index pages_notebook_idx on public.pages (owner_id, notebook_id);
create index annotations_document_idx on public.annotations (owner_id, document_id);
create index study_items_set_idx on public.study_items (owner_id, set_id);

-- ───────────── server_updated_at maintenance ─────────────
create or replace function public.touch_server_updated_at() returns trigger
language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['subjects','folders','notebooks','pages','documents','annotations','study_sets','study_items','study_sessions','xp_events','user_achievements']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.touch_server_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ───────────── Row Level Security ─────────────
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.achievements enable row level security;
create policy "catalog readable" on public.achievements for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['subjects','folders','notebooks','pages','documents','annotations','study_sets','study_items','study_sessions','xp_events','user_achievements']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows select" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows update" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    -- No delete policy: deletion is a tombstone, so hard deletes are not allowed from clients.
  end loop;
end $$;

-- ───────────── sync_push: revision-checked upsert ─────────────
-- Runs as the caller (SECURITY INVOKER), so RLS applies to every statement.
-- Returns {"status":"ok","rev":n} or {"status":"conflict","remote":{...row...}}.
create or replace function public.sync_push(p_table text, p_id uuid, p_base_rev integer, p_record jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  allowed constant text[] := array['subjects','folders','notebooks','pages','documents','annotations','study_sets','study_items','study_sessions','xp_events','user_achievements'];
  uid uuid := auth.uid();
  current jsonb;
  cols text;
  payload jsonb;
  new_rev integer;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (p_table = any (allowed)) then raise exception 'table not syncable: %', p_table using errcode = '22023'; end if;
  if (p_record ->> 'id')::uuid is distinct from p_id then raise exception 'id mismatch' using errcode = '22023'; end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', p_table) into current using p_id;

  -- Server-managed fields are never taken from the client.
  payload := p_record - 'owner_id' - 'rev' - 'server_updated_at';

  if current is null then
    payload := payload || jsonb_build_object('owner_id', uid, 'rev', 1);
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', p_table, p_table) using payload;
    return jsonb_build_object('status', 'ok', 'rev', 1);
  end if;

  if p_base_rev is null or (current ->> 'rev')::int <> p_base_rev then
    return jsonb_build_object('status', 'conflict', 'remote', current);
  end if;

  new_rev := (current ->> 'rev')::int + 1;
  select string_agg(format('%I', column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table
    and column_name not in ('id', 'owner_id', 'rev', 'server_updated_at');

  execute format(
    'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)), rev = $2 where id = $3',
    p_table, cols, cols, p_table
  ) using payload, new_rev, p_id;

  return jsonb_build_object('status', 'ok', 'rev', new_rev);
end $$;

revoke all on function public.sync_push(text, uuid, integer, jsonb) from public, anon;
grant execute on function public.sync_push(text, uuid, integer, jsonb) to authenticated;

-- ───────────── private document storage ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- Objects live at "<user id>/<file key>.pdf"; users can only touch their own folder.
create policy "own documents read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own documents write" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own documents update" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own documents delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ───────────── AI usage limits (business rules, editable without a deploy) ─────────────
create table public.ai_plan_limits (
  plan text primary key,
  daily_requests integer not null check (daily_requests >= 0),
  max_input_chars integer not null check (max_input_chars > 0)
);
insert into public.ai_plan_limits (plan, daily_requests, max_input_chars) values
  ('free', 10, 30000),
  ('plus', 100, 60000);

create table public.ai_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null references public.ai_plan_limits (plan),
  updated_at timestamptz not null default now()
);

create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_chars bigint not null default 0,
  primary key (user_id, day)
);

alter table public.ai_plan_limits enable row level security;
alter table public.ai_entitlements enable row level security;
alter table public.ai_usage enable row level security;
create policy "read own entitlement" on public.ai_entitlements for select to authenticated using (user_id = (select auth.uid()));
create policy "read own usage" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));
create policy "read plans" on public.ai_plan_limits for select to authenticated using (true);
-- No client write policies: only the service role (edge function) changes usage.

-- Atomically checks the plan and records one request. Called by the ai-generate function
-- with the service role key.
create or replace function public.consume_ai_quota(p_user_id uuid, p_input_chars integer)
returns table (allowed boolean, reason text, remaining integer, daily_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  lim public.ai_plan_limits;
  used integer;
begin
  select l.* into lim
  from public.ai_plan_limits l
  where l.plan = coalesce((select e.plan from public.ai_entitlements e where e.user_id = p_user_id), 'free');

  if p_input_chars > lim.max_input_chars then
    return query select false, 'input_too_large'::text, null::integer, lim.daily_requests;
    return;
  end if;

  insert into public.ai_usage (user_id, day, requests, input_chars)
  values (p_user_id, current_date, 0, 0)
  on conflict (user_id, day) do nothing;

  select u.requests into used from public.ai_usage u where u.user_id = p_user_id and u.day = current_date for update;
  if used >= lim.daily_requests then
    return query select false, 'daily_limit'::text, 0, lim.daily_requests;
    return;
  end if;

  update public.ai_usage set requests = requests + 1, input_chars = input_chars + p_input_chars
  where user_id = p_user_id and day = current_date;
  return query select true, null::text, lim.daily_requests - used - 1, lim.daily_requests;
end $$;

revoke all on function public.consume_ai_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, integer) to service_role;
