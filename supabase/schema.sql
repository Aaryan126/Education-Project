create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null default 'main',
  title text not null default 'Learning session',
  target_language text not null default 'en',
  source_language text not null default 'auto',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_key text not null default 'main',
  name text not null,
  mime_type text not null,
  storage_bucket text,
  storage_path text,
  learning_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_key text not null default 'main',
  client_id text,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_checks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_key text not null default 'main',
  material_id uuid references public.materials(id) on delete set null,
  material_name text not null default 'Current material',
  concept text not null default 'Current concept',
  question text not null,
  answer text not null default '',
  status text not null check (status in ('unanswered', 'checking', 'got-it', 'needs-practice', 'confused')),
  feedback text not null default '',
  confidence double precision,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  next_review_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.concept_mastery (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_key text not null default 'main',
  material_id uuid references public.materials(id) on delete set null,
  concept text not null,
  attempts integer not null default 0,
  correct_count integer not null default 0,
  mastery_score double precision not null default 0,
  last_status text not null check (last_status in ('got-it', 'needs-practice', 'confused')),
  next_review_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.session_memories (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  owner_key text not null default 'main',
  learning_memory jsonb not null default '{}'::jsonb,
  learner_profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tts_usage_months (
  owner_key text not null default 'main',
  usage_month text not null,
  provider text not null check (provider in ('google', 'openai')),
  character_count integer not null default 0,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_key, usage_month, provider)
);

create index if not exists sessions_owner_updated_idx on public.sessions(owner_key, updated_at desc);
create index if not exists materials_owner_session_idx on public.materials(owner_key, session_id);
create index if not exists messages_owner_session_created_idx on public.messages(owner_key, session_id, created_at);
create index if not exists learning_checks_owner_session_created_idx on public.learning_checks(owner_key, session_id, created_at desc);
create index if not exists learning_checks_owner_next_review_idx on public.learning_checks(owner_key, next_review_at);
create index if not exists concept_mastery_owner_session_review_idx on public.concept_mastery(owner_key, session_id, next_review_at);
create unique index if not exists concept_mastery_owner_session_material_concept_idx
  on public.concept_mastery(
    owner_key,
    session_id,
    coalesce(material_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(concept)
  );
create index if not exists session_memories_owner_idx on public.session_memories(owner_key, updated_at desc);

drop function if exists public.increment_tts_usage_month(text, text, text, integer);

create or replace function public.increment_tts_usage_month(
  p_owner_key text,
  p_usage_month text,
  p_provider text,
  p_character_count integer
)
returns table (
  usage_month text,
  provider text,
  character_count integer,
  request_count integer,
  updated_at timestamptz
)
language plpgsql
as $$
begin
  insert into public.tts_usage_months (
    owner_key,
    usage_month,
    provider,
    character_count,
    request_count,
    updated_at
  )
  values (
    p_owner_key,
    p_usage_month,
    p_provider,
    greatest(p_character_count, 0),
    case when p_character_count > 0 then 1 else 0 end,
    now()
  )
  on conflict (owner_key, usage_month, provider)
  do update set
    character_count = public.tts_usage_months.character_count + greatest(excluded.character_count, 0),
    request_count = public.tts_usage_months.request_count + excluded.request_count,
    updated_at = now();

  return query
  select t.usage_month, t.provider, t.character_count, t.request_count, t.updated_at
  from public.tts_usage_months t
  where t.owner_key = p_owner_key
    and t.usage_month = p_usage_month
    and t.provider = p_provider;
end;
$$;
