-- Schéma Supabase pour « Notre centre de loisirs ».
-- À exécuter une fois dans Supabase > SQL Editor.
--
-- Une seule table « entries » stocke tout ce que les parents publient :
--   kind = 'review'   avis sur le centre (étoiles + critères), un par votant et par centre
--   kind = 'activity' activité proposée au vote (sortie, atelier…)
--   kind = 'event'    événement signalé (super moment, info, problème)
--   kind = 'vote'     vote sur une activité (+1 / -1) ou « moi aussi » sur un événement
-- « target » rend chaque ligne unique : '' pour un avis, l'id visé pour un vote,
-- l'id de l'élément lui-même pour une activité ou un événement.

create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  centre_id  text not null,
  kind       text not null check (kind in ('review', 'activity', 'event', 'vote')),
  voter_id   text not null,
  target     text not null default '',
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (kind, centre_id, voter_id, target)
);

create index if not exists entries_centre_idx on public.entries (centre_id);
create index if not exists entries_kind_idx on public.entries (kind);

alter table public.entries enable row level security;

-- Lecture publique, écriture anonyme (le site est statique, sans compte).
drop policy if exists "lecture publique" on public.entries;
create policy "lecture publique" on public.entries for select using (true);

drop policy if exists "ajout anonyme" on public.entries;
create policy "ajout anonyme" on public.entries for insert
  with check (length(payload::text) < 4000);

drop policy if exists "modification de son vote" on public.entries;
create policy "modification de son vote" on public.entries for update
  using (true) with check (length(payload::text) < 4000);
