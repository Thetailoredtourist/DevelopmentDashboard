-- ============================================================
-- AI response cache. Identical requests inside the window are
-- served from here instead of spending provider tokens again.
-- Safe to run on top of 001. Additive only.
-- ============================================================
create table if not exists ai_cache (
  cache_key   text primary key,
  response    text not null,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ai_cache_created_at on ai_cache (created_at desc);

-- Optional housekeeping: drop cache rows older than a day.
-- Run occasionally, or leave; the lookup already filters by age.
-- delete from ai_cache where created_at < now() - interval '1 day';
