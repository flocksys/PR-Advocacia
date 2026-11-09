-- Índices econômicos oficiais (Banco Central, SGS) para a ferramenta de cálculos.
-- Busca diária pelo próprio banco (pg_net) e grava em docs/indices: { nome, serie, valores: {"AAAA-MM": % do mês} }.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.indices_pedidos (
  req_id bigint primary key,
  chave text not null,
  criado_em timestamptz not null default now(),
  processado_em timestamptz,
  resultado text
);
alter table public.indices_pedidos enable row level security;

create or replace function public.indices_series() returns table(chave text, serie int, nome text)
language sql immutable as $$
  values ('ipca', 433, 'IPCA (IBGE)'),
         ('inpc', 188, 'INPC (IBGE)'),
         ('igpm', 189, 'IGP-M (FGV)'),
         ('igpdi', 190, 'IGP-DI (FGV)'),
         ('ipcae', 10764, 'IPCA-E (IBGE)'),
         ('selic', 4390, 'SELIC acumulada no mês')
$$;

create or replace function public.indices_disparar()
returns int language plpgsql security definer set search_path = public as $$
declare s record; rid bigint; n int := 0;
begin
  for s in select * from indices_series() loop
    rid := net.http_get(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' || s.serie || '/dados?formato=json&dataInicial=01/01/1994',
      headers := '{"accept":"application/json"}'::jsonb, timeout_milliseconds := 60000);
    insert into indices_pedidos(req_id, chave) values (rid, s.chave);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.indices_processar()
returns int language plpgsql security definer set search_path = public as $$
declare p record; r record; s record; v jsonb; n int := 0;
begin
  for p in select * from indices_pedidos where processado_em is null order by req_id loop
    select status_code, content, error_msg into r from net._http_response where id = p.req_id;
    if not found then
      if p.criado_em < now() - interval '30 minutes' then
        update indices_pedidos set processado_em = now(), resultado = 'sem resposta' where req_id = p.req_id;
      end if;
      continue;
    end if;
    if r.status_code is distinct from 200 then
      update indices_pedidos set processado_em = now(), resultado = 'erro ' || coalesce(r.status_code::text, r.error_msg, '?') where req_id = p.req_id;
      continue;
    end if;
    select * into s from indices_series() x where x.chave = p.chave;
    -- [{ "data": "01/01/2024", "valor": "0.42" }, ...] -> { "2024-01": 0.42 }
    select coalesce(jsonb_object_agg(substr(e->>'data', 7, 4) || '-' || substr(e->>'data', 4, 2), (replace(e->>'valor', ',', '.'))::numeric), '{}'::jsonb)
      into v from jsonb_array_elements(r.content::jsonb) e
      where e->>'valor' ~ '^-?[0-9]+([.,][0-9]+)?$';
    if v <> '{}'::jsonb then
      insert into docs(collection, id, data) values ('indices', p.chave, jsonb_build_object(
        'nome', s.nome, 'serie', s.serie, 'fonte', 'Banco Central do Brasil (SGS ' || s.serie || ')',
        'valores', v, 'atualizadoEm', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI')))
      on conflict (collection, id) do update set data = excluded.data;
      n := n + 1;
    end if;
    update indices_pedidos set processado_em = now(), resultado = jsonb_object_length(v)::text || ' meses' where req_id = p.req_id;
  end loop;
  delete from indices_pedidos where criado_em < now() - interval '30 days';
  return n;
end $$;

-- jsonb_object_length não existe em todas as versões: função auxiliar
create or replace function public.jsonb_object_length(j jsonb) returns int language sql immutable as $$
  select count(*)::int from jsonb_object_keys(j)
$$;

revoke execute on function public.indices_disparar(), public.indices_processar() from public, anon, authenticated;

-- Atualiza todo dia às 6h (Brasília = 9h UTC) e processa as respostas a cada 10 minutos.
select cron.unschedule(jobname) from cron.job where jobname in ('indices-disparar','indices-processar');
select cron.schedule('indices-disparar', '0 9 * * *', $$select public.indices_disparar()$$);
select cron.schedule('indices-processar', '*/10 * * * *', $$select public.indices_processar()$$);

-- Primeira carga agora (os dados aparecem no sistema em até 10 minutos)
select public.indices_disparar();
