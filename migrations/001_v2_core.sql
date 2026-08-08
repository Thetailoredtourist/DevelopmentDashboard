-- ============================================================
-- EFFY Ambassador Intelligence System  ·  V2 core migration
-- Additive and backwards compatible. Run once in Neon.
-- Existing coaching_store / coaches data is preserved untouched.
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- roles (backwards compatible with is_admin) ----------
alter table if exists coaches add column if not exists role text;
update coaches set role = case when is_admin then 'admin' else 'coach' end
  where role is null;

-- Guarded so the whole script can be re-run safely.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coaches_role_check') then
    alter table coaches
      add constraint coaches_role_check check (role in ('viewer','coach','admin')) not valid;
  end if;
end $$;

-- verify_coach gains a `role` column. Postgres cannot change a function's
-- return type in place, so the old version is dropped first.
drop function if exists verify_coach(text, text);
create function verify_coach(p_email text, p_password text)
returns table(email text, name text, is_admin boolean, role text) as $$
  select c.email, c.name, c.is_admin,
         coalesce(c.role, case when c.is_admin then 'admin' else 'coach' end) as role
  from coaches c
  where c.email = lower(p_email)
    and c.pass_hash = crypt(p_password, c.pass_hash);
$$ language sql;

-- add_coach gains an optional role argument. The old 4-argument version is
-- dropped first, otherwise a 4-argument call would match both versions and
-- Postgres would refuse it as ambiguous.
drop function if exists add_coach(text, text, text, boolean);
drop function if exists add_coach(text, text, text, boolean, text);
create function add_coach(p_email text, p_name text, p_password text,
                          p_admin boolean default false,
                          p_role text default null)
returns void as $$
begin
  insert into coaches(email, name, pass_hash, is_admin, role)
  values (lower(p_email), p_name, crypt(p_password, gen_salt('bf')), p_admin,
          coalesce(p_role, case when p_admin then 'admin' else 'coach' end))
  on conflict (email) do update
    set name = excluded.name, pass_hash = excluded.pass_hash,
        is_admin = excluded.is_admin, role = excluded.role;
end;
$$ language plpgsql;

-- ---------- immutable historical dataset snapshots ----------
create table if not exists dataset_snapshots (
  id              bigserial primary key,
  captured_at     timestamptz not null default now(),
  captured_by     text,
  source_filename text,
  candidate_count integer,
  fleet_count     integer,
  dataset         jsonb not null
);
create index if not exists idx_snapshots_captured_at
  on dataset_snapshots (captured_at desc);

-- ---------- audit log ----------
create table if not exists audit_log (
  id          bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_email text,
  actor_name  text,
  actor_role  text,
  action      text not null,
  target      text,
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists idx_audit_occurred_at on audit_log (occurred_at desc);
create index if not exists idx_audit_action on audit_log (action);

-- ---------- persistent rate limiting / AI usage ----------
-- One table serves login attempts and AI usage; bucket distinguishes them.
create table if not exists usage_events (
  id          bigserial primary key,
  bucket      text not null,        -- 'login' | 'ai' | ...
  identifier  text not null,        -- normalized email, ip, or user key
  occurred_at timestamptz not null default now(),
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists idx_usage_bucket_id_time
  on usage_events (bucket, identifier, occurred_at desc);

-- ---------- coaching intervention linkage ----------
-- Coaching entries live inside coaching_store jsonb. This table records
-- the measurable spine of each intervention so effectiveness can be
-- calculated deterministically against later snapshots.
create table if not exists coaching_interventions (
  id                 bigserial primary key,
  candidate_name     text not null,
  coach_email        text,
  coach_name         text,
  created_at         timestamptz not null default now(),
  source_snapshot_id bigint references dataset_snapshots(id),
  metrics_at_coaching jsonb not null default '{}'::jsonb,
  development_focus  text,
  root_cause         text,
  directive          text,
  field_drill        text,
  powerful_question  text,
  readiness_level    text,
  follow_up_days     integer default 28
);
create index if not exists idx_interventions_candidate
  on coaching_interventions (candidate_name, created_at desc);
