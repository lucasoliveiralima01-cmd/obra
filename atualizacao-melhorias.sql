-- =====================================================================
-- Atualização: lixeira, comentários, plantas das pendências, versões do
-- modelo IFC, espaço usado, avisos de concreto, backup e limpeza.
-- Rode UMA vez em: Supabase > SQL Editor (depois do atualizacao-admin2.sql).
-- Pode rodar de novo sem problema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Lixeira: obras e pendências excluídas ficam 30 dias antes de sumir
-- ---------------------------------------------------------------------
alter table public.obras      add column if not exists excluida_em  timestamptz;
alter table public.obras      add column if not exists excluida_por text;
alter table public.pendencias add column if not exists excluida_em  timestamptz;
alter table public.pendencias add column if not exists excluida_por text;

drop policy if exists "membros leem obras" on public.obras;
create policy "membros leem obras" on public.obras for select to authenticated
  using (public.papel_atual() is not null and excluida_em is null);
drop policy if exists "ve pendencias" on public.pendencias;
create policy "ve pendencias" on public.pendencias for select to authenticated
  using (excluida_em is null and public.pend_visivel(seguranca, disciplina));

create or replace function public.obra_excluir(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.papel_atual(), '') <> 'editor' or not public.ve_mapas() then
    raise exception 'Só quem edita pode excluir obras.' using errcode = '42501';
  end if;
  update public.obras set excluida_em = now(), excluida_por = lower(auth.jwt() ->> 'email') where id = p_id and excluida_em is null;
  insert into public.admin_log (por, alvo, acao, detalhe) values (lower(auth.jwt() ->> 'email'), p_id, 'lixeira', 'obra enviada para a lixeira');
end $$;

-- o histórico não registra "editada" quando a pendência só vai/volta da lixeira
create or replace function public.pend_depois_alterar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status and new.excluida_em is not distinct from old.excluida_em then
    insert into public.pendencia_eventos (pendencia, por, acao, de, para)
    values (new.id, new.atualizado_por, 'editada', old.status, new.status);
  end if;
  return null;
end $$;

create or replace function public.pendencia_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pendencias;
begin
  select * into p from public.pendencias where id = p_id;
  if not found then return; end if;
  if not public.pend_editor(p.seguranca) then raise exception 'Você não pode excluir esta pendência.' using errcode = '42501'; end if;
  update public.pendencias set excluida_em = now(), excluida_por = lower(auth.jwt() ->> 'email') where id = p_id;
  insert into public.pendencia_eventos (pendencia, por, acao, comentario) values (p_id, lower(auth.jwt() ->> 'email'), 'excluida', 'enviada para a lixeira');
end $$;

create or replace function public.admin_lixeira()
returns table (tipo text, id text, obra text, titulo text, excluida_em timestamptz, excluida_por text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  return query
    select 'obra'::text, o.id, o.id, o.nome, o.excluida_em, o.excluida_por from public.obras o where o.excluida_em is not null
    union all
    select 'pendencia'::text, p.id::text, p.obra, '#' || coalesce(p.numero::text, '?') || ' · ' || p.pavimento || ' · ' || p.tipo, p.excluida_em, p.excluida_por
    from public.pendencias p where p.excluida_em is not null
    order by 5 desc;
end $$;

create or replace function public.admin_restaurar(p_tipo text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  if p_tipo = 'obra' then update public.obras set excluida_em = null, excluida_por = null where id = p_id;
  else update public.pendencias set excluida_em = null, excluida_por = null where id::text = p_id;
       insert into public.pendencia_eventos (pendencia, por, acao, comentario) values (p_id::uuid, lower(auth.jwt() ->> 'email'), 'excluida', 'restaurada da lixeira');
  end if;
  insert into public.admin_log (por, alvo, acao, detalhe) values (lower(auth.jwt() ->> 'email'), p_id, 'lixeira', p_tipo || ' restaurada');
end $$;

-- ---------------------------------------------------------------------
-- 2. Comentários nas pendências (sem mudar o status)
-- ---------------------------------------------------------------------
create or replace function public.pendencia_comentar(p_id uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pendencias;
begin
  select * into p from public.pendencias where id = p_id and excluida_em is null;
  if not found or not public.pend_visivel(p.seguranca, p.disciplina) or public.cargo_atual() is null then
    raise exception 'Você não pode comentar nesta pendência.' using errcode = '42501';
  end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Escreva o comentário.'; end if;
  insert into public.pendencia_eventos (pendencia, por, acao, para, comentario)
  values (p_id, lower(auth.jwt() ->> 'email'), 'comentario', p.status, left(trim(p_texto), 2000));
end $$;

-- avisos também para comentários
create or replace function public.push_ao_evento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.acao in ('criada', 'status', 'comentario') then
    perform public.push_chamar(jsonb_build_object('tipo', 'evento', 'evento', to_jsonb(new)));
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Plantas dos pavimentos para marcar o local das pendências
--    (geradas pelo Mapa de Risco a partir do modelo IFC)
-- ---------------------------------------------------------------------
create table if not exists public.pend_plantas (
  obra       text not null references public.obras(id) on delete cascade,
  pavimento  text not null,
  caminho    text not null,
  bb         jsonb not null,   -- [x0, y0, x1, y1] em metros, coordenadas do projeto
  w          int not null,
  h          int not null,
  modelo     text,             -- arquivo do modelo IFC que gerou a planta
  primary key (obra, pavimento)
);
alter table public.pend_plantas enable row level security;
drop policy if exists "membros veem plantas" on public.pend_plantas;
drop policy if exists "editores gravam plantas" on public.pend_plantas;
create policy "membros veem plantas" on public.pend_plantas for select to authenticated using (public.papel_atual() is not null);
create policy "editores gravam plantas" on public.pend_plantas for all to authenticated
  using (public.papel_atual() = 'editor' and public.ve_mapas()) with check (public.papel_atual() = 'editor' and public.ve_mapas());

drop policy if exists "plantas baixam"  on storage.objects;
drop policy if exists "plantas enviam"  on storage.objects;
drop policy if exists "plantas apagam"  on storage.objects;
create policy "plantas baixam" on storage.objects for select to authenticated
  using (bucket_id = 'arquivos' and name like 'pendencias/%/plantas/%' and public.papel_atual() is not null);
create policy "plantas enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivos' and name like 'pendencias/%/plantas/%' and public.papel_atual() = 'editor' and public.ve_mapas());
create policy "plantas apagam" on storage.objects for delete to authenticated
  using (bucket_id = 'arquivos' and name like 'pendencias/%/plantas/%' and public.papel_atual() = 'editor' and public.ve_mapas());

-- tipo de problema para concreto abaixo do fck
insert into public.pend_listas (tipo, valor, ordem, extra)
values ('problema', 'Concreto abaixo do fck', 21, '{"disciplina":"Projeto/Engenharia"}')
on conflict (tipo, valor) do nothing;

-- ---------------------------------------------------------------------
-- 4. Versões anteriores do modelo IFC (até 5)
-- ---------------------------------------------------------------------
alter table public.obras add column if not exists modelos jsonb not null default '[]';

-- ---------------------------------------------------------------------
-- 5. Espaço usado (para a Administração)
-- ---------------------------------------------------------------------
create or replace function public.admin_uso()
returns table (arquivos_bytes bigint, arquivos_qtd int, fotos_bytes bigint, fotos_qtd int, modelos_bytes bigint, banco_bytes bigint)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not public.eh_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  return query
    select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint,
           count(*)::int,
           coalesce(sum((o.metadata ->> 'size')::bigint) filter (where o.name like 'pendencias/%' and o.name not like 'pendencias/%/plantas/%'), 0)::bigint,
           (count(*) filter (where o.name like 'pendencias/%' and o.name not like 'pendencias/%/plantas/%'))::int,
           coalesce(sum((o.metadata ->> 'size')::bigint) filter (where o.name like 'obras/%'), 0)::bigint,
           pg_database_size(current_database())::bigint
    from storage.objects o where o.bucket_id = 'arquivos';
end $$;

-- ---------------------------------------------------------------------
-- 6. Corpos de prova: quantos rompem hoje e quantos estão sem resultado
--    (usa as regras de acesso dos mapas; encarregados não veem)
-- ---------------------------------------------------------------------
create or replace function public.rompimentos_resumo()
returns table (obra text, hoje int, pendentes int)
language sql stable set search_path = public as $$
  with cps as (
    select split_part(r.painel, ':', 2) as obra,
           (case when coalesce(cam ->> 'data', '') ~ '^\d{4}-\d{2}-\d{2}$' then cam ->> 'data' else r.dados ->> 'data' end)::date + cp.idade::int as vence,
           exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(cp.v -> 'r') = 'array' then cp.v -> 'r' else '[]'::jsonb end) x
                   where x is not null and x <> 'null' and x <> '') as tem
    from public.registros r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.dados -> 'caminhoes') = 'array' then r.dados -> 'caminhoes' else '[]'::jsonb end) as t(cam)
    cross join lateral jsonb_each(case when jsonb_typeof(cam -> 'cps') = 'object' then cam -> 'cps' else '{}'::jsonb end) as cp(idade, v)
    where r.colecao = 'concretagens' and r.painel like 'concretagem:%'
      and coalesce(r.dados ->> 'data', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and cp.idade ~ '^[0-9]+$' and jsonb_typeof(cp.v) = 'object' and coalesce((cp.v ->> 'on')::boolean, false)
  )
  select obra,
         (count(*) filter (where not tem and vence = (now() at time zone 'America/Sao_Paulo')::date))::int,
         (count(*) filter (where not tem and vence < (now() at time zone 'America/Sao_Paulo')::date))::int
  from cps group by obra
$$;
grant execute on function public.rompimentos_resumo() to authenticated;

-- aviso de concreto abaixo do fck (chamado pelo Mapa de Concretagem)
create or replace function public.aviso_concreto(p_obra text, p_titulo text, p_corpo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.papel_atual() is null or not public.ve_mapas() then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  perform public.push_chamar(jsonb_build_object('tipo', 'concreto', 'obra', p_obra, 'titulo', left(p_titulo, 200), 'corpo', left(p_corpo, 500),
    'por', lower(auth.jwt() ->> 'email')));
end $$;

-- ---------------------------------------------------------------------
-- 7. Backup semanal e limpeza diária da lixeira (Edge Function "usuarios")
-- ---------------------------------------------------------------------
create or replace function public.usuarios_chamar(p_corpo jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if c.funcao_url is null or coalesce(c.segredo, '') = '' then return; end if;
  perform net.http_post(
    url := replace(c.funcao_url, '/notificar', '/usuarios'),
    body := p_corpo,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-segredo', c.segredo),
    timeout_milliseconds := 60000);
exception when others then
  raise warning 'usuarios_chamar: %', sqlerrm;
end $$;
revoke all on function public.usuarios_chamar(jsonb) from public, anon, authenticated;

do $$ begin perform cron.unschedule('backup-semanal'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('lixeira-diaria'); exception when others then null; end $$;
-- domingo às 3h (Brasília) = 6h UTC
select cron.schedule('backup-semanal', '0 6 * * 0', $$select public.usuarios_chamar('{"acao":"backup","automatico":true}'::jsonb)$$);
-- todo dia às 4h (Brasília) = 7h UTC
select cron.schedule('lixeira-diaria', '0 7 * * *', $$select public.usuarios_chamar('{"acao":"limpeza"}'::jsonb)$$);

-- permissões das funções novas
revoke all on function public.obra_excluir(text) from public, anon;
revoke all on function public.pendencia_excluir(uuid) from public, anon;
revoke all on function public.admin_lixeira() from public, anon;
revoke all on function public.admin_restaurar(text, text) from public, anon;
revoke all on function public.pendencia_comentar(uuid, text) from public, anon;
revoke all on function public.admin_uso() from public, anon;
revoke all on function public.aviso_concreto(text, text, text) from public, anon;
grant execute on function public.obra_excluir(text) to authenticated;
grant execute on function public.pendencia_excluir(uuid) to authenticated;
grant execute on function public.admin_lixeira() to authenticated;
grant execute on function public.admin_restaurar(text, text) to authenticated;
grant execute on function public.pendencia_comentar(uuid, text) to authenticated;
grant execute on function public.admin_uso() to authenticated;
grant execute on function public.aviso_concreto(text, text, text) to authenticated;
