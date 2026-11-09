-- 003: recursos do app (tempo real, arquivos, equipe e portal) + dados migrados.

-- Atualização em tempo real das telas
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Sócio: quem administra a equipe
create or replace function public.is_socio() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.equipe where user_id = auth.uid() and papel = 'socio') $$;

-- Quem sou eu no sistema
create or replace function public.meu_acesso() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', auth.uid(), 'email', (select email from auth.users where id = auth.uid()),
    'equipe', exists(select 1 from equipe where user_id = auth.uid()),
    'socio', exists(select 1 from equipe where user_id = auth.uid() and papel = 'socio'),
    'nome', (select nome from equipe where user_id = auth.uid()))
$$;

-- Pessoas com conta (para ligar o portal do cliente) — só a equipe pode buscar
create or replace function public.buscar_usuarios(q text default '') returns table(id uuid, nome text, email text, equipe boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(e.nome, u.raw_user_meta_data->>'nome', split_part(u.email,'@',1)), u.email, e.user_id is not null
  from auth.users u left join equipe e on e.user_id = u.id
  where public.is_equipe() and (q = '' or u.email ilike '%'||q||'%' or coalesce(e.nome, u.raw_user_meta_data->>'nome','') ilike '%'||q||'%')
  order by 2 limit 50
$$;

create or replace function public.perfis(ids uuid[]) returns table(id uuid, nome text, email text)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(e.nome, u.raw_user_meta_data->>'nome', split_part(u.email,'@',1)), u.email
  from auth.users u left join equipe e on e.user_id = u.id
  where public.is_equipe() and u.id = any(ids)
$$;

-- Gestão da equipe pelo sócio
create or replace function public.equipe_adicionar(p_email text, p_nome text, p_papel text default 'membro') returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_socio() then raise exception 'Somente sócios podem alterar a equipe'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return 'sem_conta'; end if;
  insert into equipe(user_id, nome, papel) values (uid, nullif(trim(p_nome),''), coalesce(nullif(p_papel,''),'membro'))
  on conflict (user_id) do update set nome = coalesce(excluded.nome, equipe.nome), papel = excluded.papel;
  return 'ok';
end $$;

create or replace function public.equipe_remover(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_socio() then raise exception 'Somente sócios podem alterar a equipe'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode remover a si mesmo'; end if;
  delete from equipe where user_id = p_user;
end $$;

create or replace function public.equipe_listar() returns table(user_id uuid, nome text, email text, papel text)
language sql stable security definer set search_path = public as $$
  select e.user_id, e.nome, u.email, e.papel from equipe e join auth.users u on u.id = e.user_id
  where public.is_equipe() order by e.papel desc, e.nome
$$;

-- Primeira conta criada vira sócia automaticamente (só enquanto a equipe estiver vazia)
create or replace function public.primeiro_socio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.equipe) then
    insert into public.equipe(user_id, nome, papel) values (new.id, new.raw_user_meta_data->>'nome', 'socio');
  end if;
  return new;
end $$;
drop trigger if exists primeiro_socio on auth.users;
create trigger primeiro_socio after insert on auth.users for each row execute function public.primeiro_socio();

revoke execute on function public.equipe_adicionar(text,text,text), public.equipe_remover(uuid) from anon;

-- Arquivos (documentos, contratos, autos): pasta privada só da equipe
insert into storage.buckets (id, name, public) values ('arquivos', 'arquivos', false) on conflict (id) do nothing;
drop policy if exists arquivos_equipe on storage.objects;
create policy arquivos_equipe on storage.objects for all to authenticated
  using (bucket_id = 'arquivos' and public.is_equipe()) with check (bucket_id = 'arquivos' and public.is_equipe());
