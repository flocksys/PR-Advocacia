-- Captura diária de comunicações do DJEN pelas OABs dos advogados (banco em São Paulo).
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.djen_pedidos (
  req_id bigint primary key,
  oab text not null,
  pagina int not null default 1,
  inicio date not null,
  fim date not null,
  criado_em timestamptz not null default now(),
  processado_em timestamptz,
  resultado text
);
alter table public.djen_pedidos enable row level security;
drop policy if exists djen_pedidos_equipe on public.djen_pedidos;
create policy djen_pedidos_equipe on public.djen_pedidos for select to authenticated using (public.is_equipe());

-- OABs monitoradas: config/escritorio.advogados[].oabs (monitorar != false); senão, as do Arthur.
create or replace function public.djen_oabs() returns setof text
language sql stable set search_path = public as $$
  with cfg as (select data from docs where collection='config' and id='escritorio'),
  l as (
    select upper(regexp_replace(o, '\s', '', 'g')) o
    from cfg, jsonb_array_elements(coalesce(cfg.data->'advogados','[]')) a,
         jsonb_array_elements_text(coalesce(a->'oabs','[]')) o
    where coalesce((a->>'monitorar')::boolean, true)
  )
  select distinct o from l where o ~ '^\d+/[A-Z]{2}$'
  union
  select x from unnest(array['84706/PR','249430/SP']) x where not exists (select 1 from l)
$$;

create or replace function public.djen_pedir(p_oab text, p_inicio date, p_fim date, p_pagina int default 1)
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  rid := net.http_get(
    'https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=' || split_part(p_oab,'/',1)
    || '&ufOab=' || split_part(p_oab,'/',2)
    || '&dataDisponibilizacaoInicio=' || p_inicio || '&dataDisponibilizacaoFim=' || p_fim
    || '&pagina=' || p_pagina || '&itensPorPagina=100',
    headers := '{"accept":"application/json"}'::jsonb, timeout_milliseconds := 30000);
  insert into djen_pedidos(req_id, oab, pagina, inicio, fim) values (rid, p_oab, p_pagina, p_inicio, p_fim);
  return rid;
end $$;

-- Dispara a consulta dos últimos p_dias para cada OAB.
create or replace function public.djen_disparar(p_dias int default 3)
returns int language plpgsql security definer set search_path = public as $$
declare o text; n int := 0; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for o in select * from djen_oabs() loop
    perform djen_pedir(o, hoje - (p_dias - 1), hoje, 1); n := n + 1;
  end loop;
  return n;
end $$;

-- Lê as respostas que chegaram e grava as comunicações em docs/publicacoes.
create or replace function public.djen_processar()
returns int language plpgsql security definer set search_path = public as $$
declare p record; r record; j jsonb; it jsonb; novos int := 0; total int; tipo text; num text; d text;
begin
  for p in select * from djen_pedidos where processado_em is null order by req_id loop
    select status_code, content, error_msg, timed_out into r from net._http_response where id = p.req_id;
    if not found then
      if p.criado_em < now() - interval '30 minutes' then
        update djen_pedidos set processado_em = now(), resultado = 'sem resposta' where req_id = p.req_id;
      end if;
      continue;
    end if;
    if r.status_code is distinct from 200 then
      update djen_pedidos set processado_em = now(), resultado = 'erro ' || coalesce(r.status_code::text, r.error_msg, '?') where req_id = p.req_id;
      continue;
    end if;
    j := r.content::jsonb; total := coalesce((j->>'count')::int, 0);
    for it in select * from jsonb_array_elements(coalesce(j->'items','[]')) loop
      tipo := coalesce(it->>'tipoComunicacao', '');
      tipo := case when tipo in ('Intimação','Citação','Edital','Despacho','Decisão','Sentença','Acórdão','Pauta') then tipo
                   when tipo ilike '%edital%' then 'Edital' when tipo ilike '%cita%' then 'Citação' else 'Intimação' end;
      d := regexp_replace(coalesce(it->>'numero_processo', it->>'numeroprocessocommascara', ''), '\D', '', 'g');
      num := case when length(d) = 20 then substr(d,1,7)||'-'||substr(d,8,2)||'.'||substr(d,10,4)||'.'||substr(d,14,1)||'.'||substr(d,15,2)||'.'||substr(d,17,4)
                  else coalesce(it->>'numeroprocessocommascara', '') end;
      insert into docs(collection, id, data) values ('publicacoes', 'djen-' || (it->>'id'), jsonb_build_object(
        'disponibilizacao', left(it->>'data_disponibilizacao', 10),
        'tribunal', 'DJEN ' || coalesce(it->>'siglaTribunal', ''),
        'numero', num, 'oab', p.oab, 'tipo', tipo,
        'orgao', coalesce(it->>'nomeOrgao', ''),
        'texto', btrim(regexp_replace(regexp_replace(coalesce(it->>'texto',''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')),
        'link', coalesce(it->>'link', ''),
        'status', 'Nova', 'origem', 'DJEN', 'djenId', it->>'id',
        'capturadaEm', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
      on conflict (collection, id) do nothing;
      if found then novos := novos + 1; end if;
    end loop;
    if total > p.pagina * 100 and p.pagina < 20 then perform djen_pedir(p.oab, p.inicio, p.fim, p.pagina + 1); end if;
    update djen_pedidos set processado_em = now(), resultado = total || ' encontradas' where req_id = p.req_id;
  end loop;
  if novos > 0 then
    update docs set data = data || jsonb_build_object('pubCapturaEm', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'))
    where collection = 'config' and id = 'escritorio';
  end if;
  return novos;
end $$;

revoke execute on function public.djen_pedir(text,date,date,int), public.djen_disparar(int), public.djen_processar() from public, anon, authenticated;

-- Agenda: dispara às 20h20 (Brasília = 23h20 UTC) e processa as respostas a cada 10 minutos.
select cron.unschedule(jobname) from cron.job where jobname in ('djen-disparar','djen-processar');
select cron.schedule('djen-disparar', '20 23 * * *', $$select public.djen_disparar(3)$$);
select cron.schedule('djen-processar', '*/10 * * * *', $$select public.djen_processar()$$);
