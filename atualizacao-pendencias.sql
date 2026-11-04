-- =====================================================================
-- Atualização: módulo de Pendências de obra (etapa 1)
-- Rode este arquivo UMA vez em: Supabase > SQL Editor > New query
-- (depois do atualizacao-admin.sql). Pode rodar de novo sem problema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cargos
--   engenharia : abre, edita e vê todas; fecha as que não são de segurança
--   seguranca  : abre, vê e fecha só as de segurança
--   encarregado: vê só as das suas disciplinas e marca como corrigida;
--                não abre pendências e não entra nos mapas
-- ---------------------------------------------------------------------
alter table public.membros add column if not exists cargo text;
alter table public.membros drop constraint if exists membros_cargo_check;
alter table public.membros add constraint membros_cargo_check
  check (cargo is null or cargo in ('engenharia', 'seguranca', 'encarregado'));
alter table public.membros add column if not exists disciplinas text[] not null default '{}';

create or replace function public.cargo_atual() returns text
language sql stable security definer set search_path = public as $$
  select cargo from public.membros where lower(email) = lower(auth.jwt() ->> 'email') limit 1
$$;
create or replace function public.disciplinas_atuais() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select disciplinas from public.membros
                   where lower(email) = lower(auth.jwt() ->> 'email') limit 1), '{}')
$$;
create or replace function public.meu_cargo() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('cargo', m.cargo, 'disciplinas', m.disciplinas)
  from public.membros m where lower(m.email) = lower(auth.jwt() ->> 'email') limit 1
$$;
-- pode usar os mapas (risco, concretagem)? Encarregados não.
create or replace function public.ve_mapas() returns boolean
language sql stable security definer set search_path = public as $$
  select public.papel_atual() is not null and coalesce(public.cargo_atual(), '') <> 'encarregado'
$$;

-- Dados dos mapas: encarregados ficam de fora
drop policy if exists "membros leem"     on public.registros;
drop policy if exists "editores inserem" on public.registros;
drop policy if exists "editores alteram" on public.registros;
drop policy if exists "editores apagam"  on public.registros;
create policy "membros leem"     on public.registros for select to authenticated using (public.ve_mapas());
create policy "editores inserem" on public.registros for insert to authenticated with check (public.papel_atual() = 'editor' and public.ve_mapas());
create policy "editores alteram" on public.registros for update to authenticated using (public.papel_atual() = 'editor' and public.ve_mapas()) with check (public.papel_atual() = 'editor' and public.ve_mapas());
create policy "editores apagam"  on public.registros for delete to authenticated using (public.papel_atual() = 'editor' and public.ve_mapas());

-- ---------------------------------------------------------------------
-- 2. Listas (editáveis pelo administrador) e pavimentos/unidades por obra
-- ---------------------------------------------------------------------
create table if not exists public.pend_listas (
  tipo   text not null,   -- problema | disciplina | comodo | servico | local
  valor  text not null,
  ordem  int  not null default 0,
  extra  jsonb not null default '{}',  -- problema: {disciplina}; disciplina: {grupo}
  primary key (tipo, valor)
);
create table if not exists public.pend_config (
  obra        text primary key references public.obras(id) on delete cascade,
  pavimentos  jsonb not null default '[]'   -- [{nome, unidades:[...]}], de baixo para cima
);

-- ---------------------------------------------------------------------
-- 3. Pendências, fotos e histórico
-- ---------------------------------------------------------------------
create table if not exists public.pendencias (
  id            uuid primary key,              -- gerado no aparelho (funciona sem sinal)
  obra          text not null references public.obras(id) on delete cascade,
  numero        int,                           -- sequencial por obra, dado pelo banco
  status        text not null default 'aberta' check (status in ('aberta', 'em_correcao', 'corrigida', 'fechada')),
  pavimento     text not null,
  local_tipo    text not null,
  unidade       text,                          -- apartamento ou unidade
  comodo        text,
  tipo          text not null,                 -- tipo de problema
  disciplina    text not null,                 -- responsável pela correção
  prioridade    text not null check (prioridade in ('critica', 'alta', 'media', 'baixa')),
  seguranca     boolean not null default false,
  descricao     text,
  causador      text,                          -- responsável pelo problema
  bloqueios     jsonb not null default '[]',   -- [{servico, local}]
  prazo         date,
  observacoes   text,
  ponto         jsonb,                         -- para depois: ponto na planta / IFC
  medicao_ref   text,                          -- para depois: vínculo com a medição
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create unique index if not exists pendencias_obra_numero on public.pendencias (obra, numero);

create table if not exists public.pendencia_fotos (
  id         uuid primary key,
  pendencia  uuid not null references public.pendencias(id) on delete cascade,
  tipo       text not null check (tipo in ('antes', 'depois')),
  caminho    text not null,
  criado_por text,
  criado_em  timestamptz not null default now()
);
create index if not exists pendencia_fotos_p on public.pendencia_fotos (pendencia);

create table if not exists public.pendencia_eventos (
  id         bigserial primary key,
  pendencia  uuid not null references public.pendencias(id) on delete cascade,
  em         timestamptz not null default now(),
  por        text,
  acao       text not null,   -- criada | status | editada | foto
  de         text,
  para       text,
  comentario text
);
create index if not exists pendencia_eventos_p on public.pendencia_eventos (pendencia);

-- ---------------------------------------------------------------------
-- 4. Quem vê, edita e fecha
-- ---------------------------------------------------------------------
create or replace function public.pend_visivel(p_seg boolean, p_disc text) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce(public.cargo_atual(), '')
    when 'engenharia'  then true
    when 'seguranca'   then p_seg
    when 'encarregado' then p_disc = any(public.disciplinas_atuais())
    else public.eh_admin() end
$$;
create or replace function public.pend_visivel_id(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pendencias p
                 where p.id::text = p_id and public.pend_visivel(p.seguranca, p.disciplina))
$$;
-- edita os dados (não o status): engenharia em todas, segurança nas de segurança
create or replace function public.pend_editor(p_seg boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cargo_atual(), '') = 'engenharia'
      or (coalesce(public.cargo_atual(), '') = 'seguranca' and p_seg)
$$;
-- dá a baixa final (fecha / reprova): segurança nas de segurança, engenharia nas outras
create or replace function public.pend_fecha(p_seg boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_seg then coalesce(public.cargo_atual(), '') = 'seguranca'
              else coalesce(public.cargo_atual(), '') = 'engenharia' end
$$;

-- número sequencial, autor e evento de criação
create or replace function public.pend_ao_criar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('pend:' || new.obra));
  select coalesce(max(numero), 0) + 1 into new.numero from public.pendencias where obra = new.obra;
  new.criado_por := lower(auth.jwt() ->> 'email');
  new.atualizado_por := new.criado_por;
  new.status := 'aberta';
  if new.criado_em is null or new.criado_em > now() then new.criado_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;
create or replace function public.pend_depois_criar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pendencia_eventos (pendencia, em, por, acao, para)
  values (new.id, new.criado_em, new.criado_por, 'criada', 'aberta');
  return null;
end $$;
-- o status só muda pela função pendencia_mudar (que confere o cargo e grava o histórico)
create or replace function public.pend_ao_alterar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('app.mudanca_status', true), '') <> '1' then
    raise exception 'Use os botões de status do painel para mudar o status.';
  end if;
  new.numero := old.numero; new.obra := old.obra;
  new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  new.atualizado_em := now(); new.atualizado_por := lower(auth.jwt() ->> 'email');
  return new;
end $$;
create or replace function public.pend_depois_alterar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    insert into public.pendencia_eventos (pendencia, por, acao, de, para)
    values (new.id, new.atualizado_por, 'editada', old.status, new.status);
  end if;
  return null;
end $$;

drop trigger if exists pend_ao_criar on public.pendencias;
drop trigger if exists pend_depois_criar on public.pendencias;
drop trigger if exists pend_ao_alterar on public.pendencias;
drop trigger if exists pend_depois_alterar on public.pendencias;
create trigger pend_ao_criar before insert on public.pendencias for each row execute function public.pend_ao_criar();
create trigger pend_depois_criar after insert on public.pendencias for each row execute function public.pend_depois_criar();
create trigger pend_ao_alterar before update on public.pendencias for each row execute function public.pend_ao_alterar();
create trigger pend_depois_alterar after update on public.pendencias for each row execute function public.pend_depois_alterar();

-- mudança de status com as regras do fluxo
--   aberta -> em_correcao -> corrigida (exige foto do depois) -> fechada
--   corrigida/fechada -> aberta (reprovar/reabrir, exige comentário)
create or replace function public.pendencia_mudar(p_id uuid, p_para text, p_comentario text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.pendencias;
  ult timestamptz;
  eu text := lower(auth.jwt() ->> 'email');
begin
  select * into p from public.pendencias where id = p_id for update;
  if not found then raise exception 'Pendência não encontrada.'; end if;
  if not public.pend_visivel(p.seguranca, p.disciplina) or public.cargo_atual() is null then
    raise exception 'Você não tem acesso a esta pendência.' using errcode = '42501';
  end if;
  if p_para = p.status then return; end if;
  if p_para = 'em_correcao' and p.status = 'aberta' then
    null;
  elsif p_para = 'corrigida' and p.status in ('aberta', 'em_correcao') then
    select max(em) into ult from public.pendencia_eventos where pendencia = p_id and para = 'aberta';
    if not exists (select 1 from public.pendencia_fotos f where f.pendencia = p_id and f.tipo = 'depois'
                   and f.criado_em >= coalesce(ult, '-infinity'::timestamptz)) then
      raise exception 'Anexe a foto do depois para marcar como corrigida.';
    end if;
  elsif p_para = 'fechada' and p.status = 'corrigida' then
    if not public.pend_fecha(p.seguranca) then
      raise exception '%', case when p.seguranca then 'Só a Segurança dá a baixa final nas pendências de segurança.'
                                else 'Só a Engenharia fecha a pendência.' end using errcode = '42501';
    end if;
  elsif p_para = 'aberta' and p.status in ('corrigida', 'fechada') then
    if not public.pend_fecha(p.seguranca) then
      raise exception 'Você não pode reprovar esta pendência.' using errcode = '42501';
    end if;
    if coalesce(trim(p_comentario), '') = '' then
      raise exception 'Escreva o motivo da reprovação.';
    end if;
  else
    raise exception 'Mudança de status não permitida.';
  end if;
  perform set_config('app.mudanca_status', '1', true);
  update public.pendencias set status = p_para where id = p_id;
  perform set_config('app.mudanca_status', '', true);
  insert into public.pendencia_eventos (pendencia, por, acao, de, para, comentario)
  values (p_id, eu, 'status', p.status, p_para, nullif(trim(p_comentario), ''));
end $$;

-- foto: "antes" por quem edita; "depois" por quem vê e tem cargo
create or replace function public.pend_pode_foto(p_id uuid, p_tipo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pendencias p where p.id = p_id
                 and public.pend_visivel(p.seguranca, p.disciplina)
                 and public.cargo_atual() is not null
                 and (p_tipo = 'depois' or public.pend_editor(p.seguranca)))
$$;
create or replace function public.pend_foto_evento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pendencia_eventos (pendencia, em, por, acao, para)
  values (new.pendencia, new.criado_em, new.criado_por, 'foto', new.tipo);
  return null;
end $$;
drop trigger if exists pend_foto_evento on public.pendencia_fotos;
create trigger pend_foto_evento after insert on public.pendencia_fotos for each row execute function public.pend_foto_evento();

create or replace function public.pend_foto_ao_criar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.criado_por := lower(auth.jwt() ->> 'email');
  new.criado_em := now();   -- hora do envio (vale para conferir a foto do depois)
  return new;
end $$;
drop trigger if exists pend_foto_ao_criar on public.pendencia_fotos;
create trigger pend_foto_ao_criar before insert on public.pendencia_fotos for each row execute function public.pend_foto_ao_criar();

-- regras de acesso (RLS)
alter table public.pend_listas       enable row level security;
alter table public.pend_config       enable row level security;
alter table public.pendencias        enable row level security;
alter table public.pendencia_fotos   enable row level security;
alter table public.pendencia_eventos enable row level security;

drop policy if exists "membros leem listas"   on public.pend_listas;
drop policy if exists "admin altera listas"   on public.pend_listas;
drop policy if exists "membros leem config"   on public.pend_config;
drop policy if exists "admin altera config"   on public.pend_config;
create policy "membros leem listas" on public.pend_listas for select to authenticated using (public.papel_atual() is not null);
create policy "admin altera listas" on public.pend_listas for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy "membros leem config" on public.pend_config for select to authenticated using (public.papel_atual() is not null);
create policy "admin altera config" on public.pend_config for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists "ve pendencias"     on public.pendencias;
drop policy if exists "cria pendencias"   on public.pendencias;
drop policy if exists "edita pendencias"  on public.pendencias;
drop policy if exists "apaga pendencias"  on public.pendencias;
create policy "ve pendencias" on public.pendencias for select to authenticated
  using (public.pend_visivel(seguranca, disciplina));
create policy "cria pendencias" on public.pendencias for insert to authenticated
  with check (coalesce(public.cargo_atual(), '') = 'engenharia'
              or (coalesce(public.cargo_atual(), '') = 'seguranca' and seguranca));
create policy "edita pendencias" on public.pendencias for update to authenticated
  using (public.pend_editor(seguranca)) with check (public.pend_editor(seguranca));
create policy "apaga pendencias" on public.pendencias for delete to authenticated
  using (public.pend_editor(seguranca));

drop policy if exists "ve fotos"    on public.pendencia_fotos;
drop policy if exists "envia fotos" on public.pendencia_fotos;
drop policy if exists "apaga fotos" on public.pendencia_fotos;
create policy "ve fotos" on public.pendencia_fotos for select to authenticated
  using (public.pend_visivel_id(pendencia::text));
create policy "envia fotos" on public.pendencia_fotos for insert to authenticated
  with check (public.pend_pode_foto(pendencia, tipo));
create policy "apaga fotos" on public.pendencia_fotos for delete to authenticated
  using (lower(criado_por) = lower(auth.jwt() ->> 'email') or exists (
    select 1 from public.pendencias p where p.id = pendencia and public.pend_editor(p.seguranca)));

drop policy if exists "ve historico" on public.pendencia_eventos;
create policy "ve historico" on public.pendencia_eventos for select to authenticated
  using (public.pend_visivel_id(pendencia::text));
-- o histórico só é gravado pelo próprio banco (sem insert/update/delete diretos)

-- Arquivos: fotos das pendências em pendencias/<obra>/<pendencia>/...;
-- encarregados não baixam os arquivos dos mapas (modelos, imagens)
drop policy if exists "membros baixam arquivos"  on storage.objects;
drop policy if exists "editores enviam arquivos" on storage.objects;
drop policy if exists "editores apagam arquivos" on storage.objects;
drop policy if exists "pendencias baixam fotos"  on storage.objects;
drop policy if exists "pendencias enviam fotos"  on storage.objects;
drop policy if exists "pendencias apagam fotos"  on storage.objects;
create policy "membros baixam arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'arquivos' and name not like 'pendencias/%' and public.ve_mapas());
create policy "editores enviam arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivos' and name not like 'pendencias/%' and public.papel_atual() = 'editor' and public.ve_mapas());
create policy "editores apagam arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'arquivos' and name not like 'pendencias/%' and public.papel_atual() = 'editor' and public.ve_mapas());
create policy "pendencias baixam fotos" on storage.objects for select to authenticated
  using (bucket_id = 'arquivos' and name like 'pendencias/%' and public.pend_visivel_id(split_part(name, '/', 3)));
create policy "pendencias enviam fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivos' and name like 'pendencias/%' and public.pend_visivel_id(split_part(name, '/', 3))
              and public.cargo_atual() is not null);
create policy "pendencias apagam fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'arquivos' and name like 'pendencias/%' and public.pend_visivel_id(split_part(name, '/', 3))
         and public.cargo_atual() in ('engenharia', 'seguranca'));

-- atualização ao vivo
alter table public.pendencias        replica identity full;
alter table public.pendencia_fotos   replica identity full;
alter table public.pendencia_eventos replica identity full;
do $$ begin alter publication supabase_realtime add table public.pendencias;        exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.pendencia_fotos;   exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.pendencia_eventos; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 5. Administração: cargo e disciplinas de cada pessoa
-- ---------------------------------------------------------------------
drop function if exists public.admin_usuarios();
create or replace function public.admin_usuarios()
returns table (email text, nome text, papel text, admin boolean, cargo text, disciplinas text[],
               criado_em timestamptz, ultimo_acesso timestamptz, tem_conta boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem ver a lista de usuários.' using errcode = '42501';
  end if;
  return query
    select x.email, x.nome, x.papel, x.admin, x.cargo, x.disciplinas, x.criado_em, x.ultimo_acesso, x.tem_conta
    from (
      select lower(u.email)::text as email, p.nome, m.papel, coalesce(m.admin, false) as admin,
             m.cargo, coalesce(m.disciplinas, '{}') as disciplinas,
             u.created_at as criado_em, u.last_sign_in_at as ultimo_acesso, true as tem_conta
      from auth.users u
      left join public.membros m on lower(m.email) = lower(u.email)
      left join public.perfis  p on lower(p.email) = lower(u.email)
      where u.email is not null
      union all
      select lower(m.email)::text, p.nome, m.papel, m.admin, m.cargo, coalesce(m.disciplinas, '{}'),
             m.criado_em, null::timestamptz, false
      from public.membros m
      left join public.perfis p on lower(p.email) = lower(m.email)
      where not exists (select 1 from auth.users u where lower(u.email) = lower(m.email))
    ) x
    order by x.email;
end $$;
revoke all on function public.admin_usuarios() from public, anon;
grant execute on function public.admin_usuarios() to authenticated;

-- cargo: 'engenharia' | 'seguranca' | 'encarregado' | null (sem cargo)
-- encarregado: precisa de disciplinas do mesmo grupo (ex.: Drywall e Forro/Gesso)
--              e fica só com o painel de pendências (papel leitor, sem administração)
create or replace function public.admin_definir_cargo(alvo text, novo_cargo text, novas_disciplinas text[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(alvo));
  ds text[] := coalesce(novas_disciplinas, '{}');
  grupos int;
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem mudar cargos.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.membros where lower(email) = e) then
    raise exception 'Libere o acesso desta pessoa antes de dar um cargo.';
  end if;
  if novo_cargo is not null and novo_cargo not in ('engenharia', 'seguranca', 'encarregado') then
    raise exception 'Cargo inválido.';
  end if;
  if novo_cargo = 'encarregado' then
    if array_length(ds, 1) is null then raise exception 'Escolha ao menos uma disciplina para o encarregado.'; end if;
    select count(distinct coalesce(l.extra ->> 'grupo', l.valor)) into grupos
    from unnest(ds) d left join public.pend_listas l on l.tipo = 'disciplina' and l.valor = d;
    if grupos > 1 then
      raise exception 'As disciplinas de um encarregado precisam ser complementares (do mesmo grupo).';
    end if;
    if exists (select 1 from public.membros where lower(email) = e and admin)
       and (select count(*) from public.membros where admin) <= 1 then
      raise exception 'Esta é a única conta de administrador; um encarregado não pode ser administrador.';
    end if;
    update public.membros set cargo = 'encarregado', disciplinas = ds, papel = 'leitor', admin = false where lower(email) = e;
  else
    update public.membros set cargo = novo_cargo, disciplinas = '{}' where lower(email) = e;
  end if;
end $$;
revoke all on function public.admin_definir_cargo(text, text, text[]) from public, anon;
grant execute on function public.admin_definir_cargo(text, text, text[]) to authenticated;
grant execute on function public.meu_cargo() to authenticated;
grant execute on function public.pendencia_mudar(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Listas iniciais (o administrador edita depois pelo painel)
-- ---------------------------------------------------------------------
insert into public.pend_listas (tipo, valor, ordem, extra) values
  ('disciplina', 'Alvenaria/Reboco', 1, '{}'), ('disciplina', 'Hidráulica', 2, '{}'),
  ('disciplina', 'Elétrica', 3, '{}'), ('disciplina', 'Drywall', 4, '{"grupo":"Drywall e forro"}'),
  ('disciplina', 'Forro/Gesso', 5, '{"grupo":"Drywall e forro"}'), ('disciplina', 'Impermeabilização', 6, '{}'),
  ('disciplina', 'Revestimento', 7, '{}'), ('disciplina', 'Esquadrias', 8, '{}'),
  ('disciplina', 'Pintura', 9, '{}'), ('disciplina', 'Limpeza', 10, '{}'),
  ('disciplina', 'Segurança', 11, '{}'), ('disciplina', 'Projeto/Engenharia', 12, '{}'),
  ('problema', 'Alvenaria', 1, '{"disciplina":"Alvenaria/Reboco"}'),
  ('problema', 'Reboco/emboço', 2, '{"disciplina":"Alvenaria/Reboco"}'),
  ('problema', 'Contrapiso', 3, '{"disciplina":"Alvenaria/Reboco"}'),
  ('problema', 'Impermeabilização', 4, '{"disciplina":"Impermeabilização"}'),
  ('problema', 'Água fria', 5, '{"disciplina":"Hidráulica"}'),
  ('problema', 'Água quente', 6, '{"disciplina":"Hidráulica"}'),
  ('problema', 'Esgoto/pluvial', 7, '{"disciplina":"Hidráulica"}'),
  ('problema', 'Elétrica', 8, '{"disciplina":"Elétrica"}'),
  ('problema', 'Drywall – estrutura', 9, '{"disciplina":"Drywall"}'),
  ('problema', 'Drywall – placas/fita', 10, '{"disciplina":"Drywall"}'),
  ('problema', 'Forro', 11, '{"disciplina":"Forro/Gesso"}'),
  ('problema', 'Shaft', 12, '{"disciplina":"Drywall"}'),
  ('problema', 'Esquadrias/contramarcos', 13, '{"disciplina":"Esquadrias"}'),
  ('problema', 'Peitoris', 14, '{"disciplina":"Revestimento"}'),
  ('problema', 'Revestimento cerâmico', 15, '{"disciplina":"Revestimento"}'),
  ('problema', 'Pintura', 16, '{"disciplina":"Pintura"}'),
  ('problema', 'Limpeza/entulho', 17, '{"disciplina":"Limpeza"}'),
  ('problema', 'Segurança (proteções coletivas)', 18, '{"disciplina":"Segurança"}'),
  ('problema', 'Projeto/compatibilização', 19, '{"disciplina":"Projeto/Engenharia"}'),
  ('problema', 'Outro', 20, '{}'),
  ('comodo', 'Estar/sala', 1, '{}'), ('comodo', 'Cozinha', 2, '{}'), ('comodo', 'Área de serviço', 3, '{}'),
  ('comodo', 'Banheiro', 4, '{}'), ('comodo', 'Dormitório 1', 5, '{}'), ('comodo', 'Dormitório 2', 6, '{}'),
  ('comodo', 'Studio', 7, '{}'), ('comodo', 'Sacada', 8, '{}'), ('comodo', 'Hall do apto', 9, '{}'),
  ('comodo', 'Shaft do apto', 10, '{}'),
  ('servico', 'Plaqueamento drywall', 1, '{}'), ('servico', 'Fita/massa drywall', 2, '{}'),
  ('servico', 'Instalação elétrica', 3, '{}'), ('servico', 'Forro', 4, '{}'), ('servico', 'Contrapiso', 5, '{}'),
  ('servico', 'Impermeabilização', 6, '{}'), ('servico', 'Revestimento', 7, '{}'), ('servico', 'Pintura', 8, '{}'),
  ('servico', 'Esquadrias', 9, '{}'), ('servico', 'Peitoris', 10, '{}'), ('servico', 'Louças e metais', 11, '{}'),
  ('servico', 'Limpeza final', 12, '{}'),
  ('local', 'Apartamento', 1, '{}'), ('local', 'Circulação/hall', 2, '{}'), ('local', 'Escadaria', 3, '{}'),
  ('local', 'Shaft', 4, '{}'), ('local', 'Fachada', 5, '{}'), ('local', 'Cobertura', 6, '{}'),
  ('local', 'Garagem', 7, '{}'), ('local', 'Área técnica', 8, '{}'), ('local', 'Outro', 9, '{}')
on conflict (tipo, valor) do nothing;

-- Pavimentos e unidades da obra Start
insert into public.pend_config (obra, pavimentos)
select 'start', jsonb_build_array(
  jsonb_build_object('nome', 'Fundação', 'unidades', '[]'::jsonb),
  jsonb_build_object('nome', 'Térreo', 'unidades', '[]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 02', 'unidades', '["201","202"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 03', 'unidades', '["301","302","303","304","305","306","307","308","309","310","311","312","Zelador","Apoio técnico"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 04', 'unidades', '["401","402","403","404","405","406","407","408","409","410","411","412"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 05', 'unidades', '["501","502","503","504","505","506","507","508","509","510","511","512"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 06', 'unidades', '["601","602","603","604","605","606","607","608","609","610","611","612"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 07', 'unidades', '["701","702","703","704","705","706","707","708","709","710","711","712"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 08', 'unidades', '["801","802","803","804","805","806","807","Terraço"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 09', 'unidades', '["901","902","903","904","905","906","907"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 10', 'unidades', '["1001","1002","1003","1004","1005","1006","1007"]'::jsonb),
  jsonb_build_object('nome', 'Pavimento 11', 'unidades', '["1101","1102","1103","1104","1105","1106","1107"]'::jsonb),
  jsonb_build_object('nome', 'Cobertura', 'unidades', '[]'::jsonb),
  jsonb_build_object('nome', 'Nível deck', 'unidades', '[]'::jsonb),
  jsonb_build_object('nome', 'Forro', 'unidades', '[]'::jsonb),
  jsonb_build_object('nome', 'Reservatório', 'unidades', '[]'::jsonb)
)
where exists (select 1 from public.obras where id = 'start')
on conflict (obra) do nothing;
