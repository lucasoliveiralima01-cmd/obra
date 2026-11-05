-- =====================================================================
-- Atualização: funcionários por cargo e "quem vai corrigir" na pendência
--   - lista de funcionários de cada obra, com um ou mais cargos
--     (ex.: Brian → Pedreiro e Impermeabilizador), editável em Listas e regras
--   - funcionário ligado a um usuário do sistema: os cargos dele passam a
--     valer no acesso (vê as pendências desses cargos)
--   - pendência ganha "responsavel" (o funcionário escolhido): o aviso vai
--     só para ele, e não para todos do cargo
--   - um usuário pode ter cargos de grupos diferentes (antes só complementares)
-- Rode UMA vez em: Supabase > SQL Editor (depois do atualizacao-locais.sql).
-- Pode rodar de novo sem problema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Funcionários
-- ---------------------------------------------------------------------
create table if not exists public.pend_funcionarios (
  id        uuid primary key default gen_random_uuid(),
  obra      text references public.obras(id) on delete cascade,   -- obra onde está trabalhando
  nome      text not null,
  cargos    text[] not null default '{}',                         -- ex.: {Pedreiro, Impermeabilizador}
  equipe    text check (equipe is null or equipe in ('proprio', 'terceiro')),
  email     text,                                                 -- usuário do sistema (opcional)
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists pend_funcionarios_obra on public.pend_funcionarios (obra);

alter table public.pend_funcionarios enable row level security;
drop policy if exists "membros veem funcionarios" on public.pend_funcionarios;
drop policy if exists "admin altera funcionarios" on public.pend_funcionarios;
create policy "membros veem funcionarios" on public.pend_funcionarios for select to authenticated using (public.papel_atual() is not null);
create policy "admin altera funcionarios" on public.pend_funcionarios for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- funcionário ligado a um usuário: os cargos dele entram no acesso desse usuário
-- (só para quem é encarregado ou ainda não tem cargo; nunca mexe em administradores,
-- engenharia ou segurança)
create or replace function public.func_sincronizar() returns trigger
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(new.email, '')));
begin
  if e = '' or not new.ativo or array_length(new.cargos, 1) is null then return null; end if;
  update public.membros m set
    disciplinas = (select coalesce(array_agg(distinct d order by d), '{}') from unnest(coalesce(m.disciplinas, '{}') || new.cargos) d),
    cargo = 'encarregado'
  where lower(m.email) = e
    and (m.cargo = 'encarregado' or (m.cargo is null and not coalesce(m.admin, false) and m.papel = 'leitor'));
  return null;
end $$;
drop trigger if exists func_sincronizar on public.pend_funcionarios;
create trigger func_sincronizar after insert or update on public.pend_funcionarios
for each row execute function public.func_sincronizar();

-- ---------------------------------------------------------------------
-- 2. Pendência: quem vai corrigir
-- ---------------------------------------------------------------------
alter table public.pendencias add column if not exists responsavel uuid references public.pend_funcionarios(id) on delete set null;
alter table public.pendencias add column if not exists responsavel_nome text;   -- o nome fica guardado mesmo se o funcionário sair

-- ---------------------------------------------------------------------
-- 3. Cargos do usuário: pode ter mais de um, de qualquer grupo
-- ---------------------------------------------------------------------
create or replace function public.admin_definir_cargo(alvo text, novo_cargo text, novas_disciplinas text[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(alvo));
  ds text[] := coalesce(novas_disciplinas, '{}');
  antes text;
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem mudar cargos.' using errcode = '42501';
  end if;
  select coalesce(cargo, 'sem cargo') || case when array_length(disciplinas, 1) is null then '' else ' (' || array_to_string(disciplinas, ', ') || ')' end
    into antes from public.membros where lower(email) = e;
  if not found then
    raise exception 'Libere o acesso desta pessoa antes de dar um cargo.';
  end if;
  if novo_cargo is not null and novo_cargo not in ('engenharia', 'seguranca', 'encarregado') then
    raise exception 'Cargo inválido.';
  end if;
  if novo_cargo = 'encarregado' then
    if array_length(ds, 1) is null then raise exception 'Escolha ao menos um cargo.'; end if;
    if exists (select 1 from public.membros where lower(email) = e and admin)
       and (select count(*) from public.membros where admin) <= 1 then
      raise exception 'Esta é a única conta de administrador; um funcionário de campo não pode ser administrador.';
    end if;
    update public.membros set cargo = 'encarregado', disciplinas = ds, papel = 'leitor', admin = false where lower(email) = e;
  else
    update public.membros set cargo = novo_cargo, disciplinas = '{}' where lower(email) = e;
  end if;
  insert into public.admin_log (por, alvo, acao, detalhe)
  values (lower(auth.jwt() ->> 'email'), e, 'cargo',
          antes || ' → ' || coalesce(novo_cargo, 'sem cargo') || case when novo_cargo = 'encarregado' then ' (' || array_to_string(ds, ', ') || ')' else '' end);
end $$;

-- ---------------------------------------------------------------------
-- 4. Renomear um cargo (Listas e regras) também nos funcionários
-- ---------------------------------------------------------------------
create or replace function public.pend_renomear(p_obra text, p_campo text, p_de text, p_para text)
returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.eh_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  if coalesce(trim(p_para), '') = '' or p_de = p_para then return 0; end if;
  perform set_config('app.renomeando', '1', true);
  if p_campo in ('tipo', 'comodo', 'local_tipo', 'disciplina', 'pavimento') then
    -- disciplina: todas as obras; obra informada: só ela; padrão: as obras sem listas próprias
    execute format(
      'update public.pendencias p set %I = $1 where p.%I = $2 and (
         $4 = ''disciplina''
         or ($3::text is not null and p.obra = $3)
         or ($3::text is null and not exists (select 1 from public.pend_config c where c.obra = p.obra and c.listas is not null)))',
      p_campo, p_campo)
      using p_para, p_de, p_obra, p_campo;
    get diagnostics n = row_count;
  elsif p_campo = 'servico' then
    update public.pendencias set bloqueios = (
      select coalesce(jsonb_agg(case when b ->> 'servico' = p_de then jsonb_set(b, '{servico}', to_jsonb(p_para)) else b end), '[]'::jsonb)
      from jsonb_array_elements(bloqueios) b)
    where bloqueios @> jsonb_build_array(jsonb_build_object('servico', p_de))
      and (p_obra is null or obra = p_obra);
    get diagnostics n = row_count;
  else
    raise exception 'Campo inválido.';
  end if;
  if p_campo = 'disciplina' then
    update public.membros set disciplinas = array_replace(disciplinas, p_de, p_para) where p_de = any(disciplinas);
    update public.pend_funcionarios set cargos = array_replace(cargos, p_de, p_para) where p_de = any(cargos);
  end if;
  perform set_config('app.renomeando', '', true);
  insert into public.admin_log (por, alvo, acao, detalhe)
  values (lower(auth.jwt() ->> 'email'), coalesce(p_obra, 'padrão'), 'listas', p_campo || ': “' || p_de || '” → “' || p_para || '” (' || n || ' pendência(s))');
  return n;
end $$;
revoke all on function public.pend_renomear(text, text, text, text) from public, anon;
grant execute on function public.pend_renomear(text, text, text, text) to authenticated;

-- avisos ao vivo da lista de funcionários (se a publicação existir)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pend_funcionarios') then
    alter publication supabase_realtime add table public.pend_funcionarios;
  end if;
end $$;
