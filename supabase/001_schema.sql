-- Banco do sistema Pontes Rodrigues: mesmas "coleções" do artefato, num formato de documentos.
create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);
create index if not exists docs_collection_idx on public.docs (collection);

-- Equipe: só quem estiver nesta lista acessa os dados internos.
create table if not exists public.equipe (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  papel text not null default 'membro' check (papel in ('socio','membro')),
  criado_em timestamptz not null default now()
);

create or replace function public.is_equipe() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.equipe where user_id = auth.uid()) $$;

create or replace function public.docs_bump() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists docs_bump on public.docs;
create trigger docs_bump before insert or update on public.docs
for each row execute function public.docs_bump();

alter table public.docs enable row level security;
alter table public.equipe enable row level security;

drop policy if exists docs_equipe on public.docs;
create policy docs_equipe on public.docs for all to authenticated
  using (public.is_equipe()) with check (public.is_equipe());

-- Portal do cliente: cada cliente lê só o próprio documento portal/<seu id>.
drop policy if exists docs_portal on public.docs;
create policy docs_portal on public.docs for select to authenticated
  using (collection = 'portal' and id = auth.uid()::text);

drop policy if exists equipe_ver on public.equipe;
create policy equipe_ver on public.equipe for select to authenticated using (public.is_equipe());

-- Permite ao banco (em São Paulo) fazer chamadas HTTP, usado no teste e na captura do DJEN.
create extension if not exists pg_net;
