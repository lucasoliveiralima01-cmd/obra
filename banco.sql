-- =====================================================================
-- Ferramentas da Obra · banco de dados (Supabase)
--
-- Um arquivo só, para instalar e para atualizar:
--   Supabase > SQL Editor > New query > cole o arquivo inteiro > Run.
-- Ele vê sozinho o que o seu banco já tem e aplica só o que falta.
-- Pode rodar quantas vezes quiser.
--
-- INSTALAÇÃO NOVA: troque SEU_EMAIL@exemplo.com (logo abaixo) pelo seu
-- e-mail. Você vira o primeiro administrador. Quem já usa o sistema não
-- precisa trocar nada.
--
-- Para uma mudança nova no banco: acrescente um passo no fim (antes da
-- "Conferência final"), no mesmo formato dos outros, com o número seguinte,
-- e atualize BANCO_ESPERADO no admin.html.
-- =====================================================================
select set_config('obra.admin_email', 'SEU_EMAIL@exemplo.com', false);

-- Versão do banco (o site avisa o administrador quando falta atualizar)
create table if not exists public.banco_versao (
  id            int primary key default 1 check (id = 1),
  versao        int not null,
  atualizado_em timestamptz not null default now()
);
alter table public.banco_versao enable row level security;
do $inicio$
declare v int := 0;
  col boolean;
begin
  if exists (select 1 from public.banco_versao) then return; end if;
  -- banco que veio dos arquivos antigos (supabase.sql + atualizacao-*.sql): descobre até onde já foi
  if to_regclass('public.membros') is not null then v := 1; end if;
  if v = 1 and to_regclass('public.obras') is not null then v := 2; end if;
  if v = 2 and to_regclass('public.perfis') is not null then v := 3; end if;
  if v = 3 and to_regprocedure('public.eh_admin()') is not null then v := 4; end if;
  if v = 4 and to_regclass('public.pendencias') is not null then v := 5; end if;
  if v = 5 and to_regclass('public.push_inscricoes') is not null then v := 6; end if;
  if v = 6 and to_regclass('public.admin_log') is not null then v := 7; end if;
  if v = 7 and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'obras' and column_name = 'excluida_em') then v := 8; end if;
  if v = 8 and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pend_config' and column_name = 'regras') then v := 9; end if;
  if v = 9 and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pend_config' and column_name = 'listas') then v := 10; end if;
  if v = 10 and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pendencias' and column_name = 'equipe') then v := 11; end if;
  if v = 11 and to_regclass('public.pend_funcionarios') is not null then v := 12; end if;
  if v = 12 and to_regprocedure('public.aviso_fachada(text,text,text)') is not null then v := 13; end if;
  insert into public.banco_versao (versao) values (v);
end $inicio$;

create or replace function public.banco_versao() returns int
language sql stable security definer set search_path = public as $$
  select versao from public.banco_versao where id = 1
$$;
grant execute on function public.banco_versao() to anon, authenticated;

-- =====================================================================
-- Passo 1: Estrutura básica: pessoas, obras, mapas e arquivos
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 1 then return; end if;
  execute $p1$
-- Quem pode usar o painel. papel: 'editor' (altera) ou 'leitor' (só vê).
create table if not exists public.membros (
  email      text primary key,
  papel      text not null default 'editor' check (papel in ('editor','leitor')),
  admin      boolean not null default false,  -- libera e muda o acesso das pessoas no site
  criado_em  timestamptz not null default now()
);

-- Cadastro de obras. O modelo IFC fica na obra e é usado por todas as
-- ferramentas (Mapa de Risco, Mapa de Concretagem...).
create table if not exists public.obras (
  id             text primary key,
  nome           text not null,
  modelo         jsonb,
  foto           jsonb,
  criado_em      timestamptz not null default now(),
  criado_por     text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

-- Tudo o que cada ferramenta guarda: áreas, símbolos, revisões, configuração e fundos.
-- "painel" = ferramenta:obra (ex.: risco:residencial-x).
create table if not exists public.registros (
  painel         text not null,
  colecao        text not null,
  id             text not null,
  dados          jsonb not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text,
  primary key (painel, colecao, id)
);

-- Papel de quem está conectado (null = sem acesso)
create or replace function public.papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.membros where lower(email) = lower(auth.jwt() ->> 'email') limit 1
$$;

alter table public.membros   enable row level security;
alter table public.obras     enable row level security;
alter table public.registros enable row level security;

drop policy if exists "membros leem obras"     on public.obras;
drop policy if exists "editores criam obras"   on public.obras;
drop policy if exists "editores alteram obras" on public.obras;
drop policy if exists "editores apagam obras"  on public.obras;
create policy "membros leem obras"     on public.obras for select to authenticated using (public.papel_atual() is not null);
create policy "editores criam obras"   on public.obras for insert to authenticated with check (public.papel_atual() = 'editor');
create policy "editores alteram obras" on public.obras for update to authenticated using (public.papel_atual() = 'editor') with check (public.papel_atual() = 'editor');
create policy "editores apagam obras"  on public.obras for delete to authenticated using (public.papel_atual() = 'editor');

drop policy if exists "ve o proprio cadastro" on public.membros;
create policy "ve o proprio cadastro" on public.membros
  for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));
drop policy if exists "membros veem a equipe" on public.membros;
create policy "membros veem a equipe" on public.membros
  for select to authenticated using (public.papel_atual() is not null);

-- Nome de cada pessoa (aparece no lugar do e-mail)
create table if not exists public.perfis (
  email          text primary key,
  nome           text,
  atualizado_em  timestamptz not null default now()
);
alter table public.perfis enable row level security;
drop policy if exists "membros veem os nomes"   on public.perfis;
drop policy if exists "cada um cria o seu nome" on public.perfis;
drop policy if exists "cada um muda o seu nome" on public.perfis;
create policy "membros veem os nomes" on public.perfis for select to authenticated
  using (public.papel_atual() is not null);
create policy "cada um cria o seu nome" on public.perfis for insert to authenticated
  with check (lower(email) = lower(auth.jwt() ->> 'email') or public.papel_atual() = 'editor');
create policy "cada um muda o seu nome" on public.perfis for update to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.papel_atual() = 'editor')
  with check (lower(email) = lower(auth.jwt() ->> 'email') or public.papel_atual() = 'editor');

drop policy if exists "membros leem"     on public.registros;
drop policy if exists "editores inserem" on public.registros;
drop policy if exists "editores alteram" on public.registros;
drop policy if exists "editores apagam"  on public.registros;
create policy "membros leem"     on public.registros for select to authenticated using (public.papel_atual() is not null);
create policy "editores inserem" on public.registros for insert to authenticated with check (public.papel_atual() = 'editor');
create policy "editores alteram" on public.registros for update to authenticated using (public.papel_atual() = 'editor') with check (public.papel_atual() = 'editor');
create policy "editores apagam"  on public.registros for delete to authenticated using (public.papel_atual() = 'editor');

-- Atualização ao vivo (quando alguém salva, a tela dos outros atualiza)
alter table public.registros replica identity full;
alter table public.obras     replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.registros;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.obras;
exception when duplicate_object then null; end $$;

-- Arquivos (modelo IFC, imagens de fundo, logo): bucket privado
insert into storage.buckets (id, name, public)
values ('arquivos', 'arquivos', false)
on conflict (id) do nothing;

drop policy if exists "membros baixam arquivos"  on storage.objects;
drop policy if exists "editores enviam arquivos" on storage.objects;
drop policy if exists "editores apagam arquivos" on storage.objects;
create policy "membros baixam arquivos"  on storage.objects for select to authenticated using (bucket_id = 'arquivos' and public.papel_atual() is not null);
create policy "editores enviam arquivos" on storage.objects for insert to authenticated with check (bucket_id = 'arquivos' and public.papel_atual() = 'editor');
create policy "editores apagam arquivos" on storage.objects for delete to authenticated using (bucket_id = 'arquivos' and public.papel_atual() = 'editor');

-- Painel de administração: funções usadas pela tela "Administração" do site
-- Quem está conectado é administrador?
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from public.membros
                   where lower(email) = lower(auth.jwt() ->> 'email') limit 1), false)
$$;

-- Lista de todas as contas criadas (inclusive quem ainda espera liberação)
-- e dos e-mails liberados que ainda não criaram conta. Só para administradores.
create or replace function public.admin_usuarios()
returns table (email text, nome text, papel text, admin boolean,
               criado_em timestamptz, ultimo_acesso timestamptz, tem_conta boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem ver a lista de usuários.' using errcode = '42501';
  end if;
  return query
    select x.email, x.nome, x.papel, x.admin, x.criado_em, x.ultimo_acesso, x.tem_conta
    from (
      select lower(u.email)::text as email, p.nome, m.papel, coalesce(m.admin, false) as admin,
             u.created_at as criado_em, u.last_sign_in_at as ultimo_acesso, true as tem_conta
      from auth.users u
      left join public.membros m on lower(m.email) = lower(u.email)
      left join public.perfis  p on lower(p.email) = lower(u.email)
      where u.email is not null
      union all
      select lower(m.email)::text, p.nome, m.papel, m.admin, m.criado_em, null::timestamptz, false
      from public.membros m
      left join public.perfis p on lower(p.email) = lower(m.email)
      where not exists (select 1 from auth.users u where lower(u.email) = lower(m.email))
    ) x
    order by x.email;
end $$;

-- Define o acesso de uma pessoa. Só para administradores.
--   novo_papel: 'leitor' (só visualiza), 'editor' (edita) ou 'nenhum' (tira o acesso)
--   novo_admin: true para administrador (sempre com papel de editor)
-- Não deixa ficar sem nenhum administrador.
create or replace function public.admin_definir_acesso(alvo text, novo_papel text, novo_admin boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(alvo));
  era_admin boolean;
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem mudar acessos.' using errcode = '42501';
  end if;
  if e is null or e = '' or position('@' in e) = 0 then
    raise exception 'E-mail inválido.';
  end if;
  select coalesce(bool_or(admin), false) into era_admin from public.membros where lower(email) = e;
  if era_admin and (novo_papel = 'nenhum' or not coalesce(novo_admin, false))
     and (select count(*) from public.membros where admin) <= 1 then
    raise exception 'Esta é a única conta de administrador. Torne outra pessoa administradora antes.';
  end if;
  if novo_papel = 'nenhum' then
    delete from public.membros where lower(email) = e;
    return;
  end if;
  if coalesce(novo_admin, false) then novo_papel := 'editor'; end if;
  if novo_papel not in ('editor', 'leitor') then
    raise exception 'Papel inválido.';
  end if;
  update public.membros set papel = novo_papel, admin = coalesce(novo_admin, false) where lower(email) = e;
  if not found then
    insert into public.membros (email, papel, admin) values (e, novo_papel, coalesce(novo_admin, false));
  end if;
end $$;

revoke all on function public.admin_usuarios() from public, anon;
revoke all on function public.admin_definir_acesso(text, text, boolean) from public, anon;
grant execute on function public.eh_admin() to authenticated;
grant execute on function public.admin_usuarios() to authenticated;
grant execute on function public.admin_definir_acesso(text, text, boolean) to authenticated;

-- Primeiro administrador: o e-mail do começo do banco.sql
insert into public.membros (email, papel, admin)
select lower(current_setting('obra.admin_email')), 'editor', true where current_setting('obra.admin_email') not like 'SEU_EMAIL%'
on conflict (email) do update set papel = excluded.papel, admin = true;
$p1$;
  update public.banco_versao set versao = 1, atualizado_em = now();
  raise notice 'Passo 1 aplicado: Estrutura básica: pessoas, obras, mapas e arquivos';
end $passo$;

-- =====================================================================
-- Passo 2: Cadastro de obras
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 2 then return; end if;
  execute $p2$
-- Cadastro de obras. O modelo IFC fica na obra e é usado por todas as
-- ferramentas (Mapa de Risco, Mapa de Concretagem...).
create table if not exists public.obras (
  id             text primary key,
  nome           text not null,
  modelo         jsonb,
  criado_em      timestamptz not null default now(),
  criado_por     text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

alter table public.obras enable row level security;

drop policy if exists "membros leem obras"     on public.obras;
drop policy if exists "editores criam obras"   on public.obras;
drop policy if exists "editores alteram obras" on public.obras;
drop policy if exists "editores apagam obras"  on public.obras;
create policy "membros leem obras"     on public.obras for select to authenticated using (public.papel_atual() is not null);
create policy "editores criam obras"   on public.obras for insert to authenticated with check (public.papel_atual() = 'editor');
create policy "editores alteram obras" on public.obras for update to authenticated using (public.papel_atual() = 'editor') with check (public.papel_atual() = 'editor');
create policy "editores apagam obras"  on public.obras for delete to authenticated using (public.papel_atual() = 'editor');

alter table public.obras replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.obras;
exception when duplicate_object then null; end $$;

-- Dados antigos: cada painel antigo (ex.: "principal") vira uma obra,
-- levando o nome e o modelo IFC que estavam na configuração dele...
insert into public.obras (id, nome, modelo, criado_por)
select p.painel,
       coalesce(nullif(trim(c.dados->>'obra'), ''), initcap(replace(p.painel, '-', ' '))),
       case when jsonb_typeof(c.dados->'modelo') = 'object' then c.dados->'modelo' end,
       'migração'
from (select distinct painel from public.registros where position(':' in painel) = 0) p
left join public.registros c on c.painel = p.painel and c.colecao = 'config' and c.id = 'obra'
on conflict (id) do nothing;

-- ...e as áreas, símbolos e revisões dele passam para o Mapa de Risco dessa obra.
update public.registros set painel = 'risco:' || painel where position(':' in painel) = 0;
$p2$;
  update public.banco_versao set versao = 2, atualizado_em = now();
  raise notice 'Passo 2 aplicado: Cadastro de obras';
end $passo$;

-- =====================================================================
-- Passo 3: Nomes das pessoas e foto das obras
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 3 then return; end if;
  execute $p3$
-- Nome de cada pessoa (aparece no lugar do e-mail)
create table if not exists public.perfis (
  email          text primary key,
  nome           text,
  atualizado_em  timestamptz not null default now()
);
alter table public.perfis enable row level security;

drop policy if exists "membros veem os nomes"   on public.perfis;
drop policy if exists "cada um cria o seu nome" on public.perfis;
drop policy if exists "cada um muda o seu nome" on public.perfis;
create policy "membros veem os nomes" on public.perfis for select to authenticated
  using (public.papel_atual() is not null);
-- cada pessoa grava o próprio nome; editores podem dar nome a qualquer membro
create policy "cada um cria o seu nome" on public.perfis for insert to authenticated
  with check (lower(email) = lower(auth.jwt() ->> 'email') or public.papel_atual() = 'editor');
create policy "cada um muda o seu nome" on public.perfis for update to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.papel_atual() = 'editor')
  with check (lower(email) = lower(auth.jwt() ->> 'email') or public.papel_atual() = 'editor');

-- A equipe toda pode ver quem são os membros (para a tela "Equipe").
-- Alterar a lista de membros continua sendo só pelo Supabase.
drop policy if exists "membros veem a equipe" on public.membros;
create policy "membros veem a equipe" on public.membros for select to authenticated
  using (public.papel_atual() is not null);

-- Foto (imagem de perfil) de cada obra
alter table public.obras add column if not exists foto jsonb;
$p3$;
  update public.banco_versao set versao = 3, atualizado_em = now();
  raise notice 'Passo 3 aplicado: Nomes das pessoas e foto das obras';
end $passo$;

-- =====================================================================
-- Passo 4: Administração
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 4 then return; end if;
  execute $p4$
-- Administrador: edita tudo e, além disso, libera e muda o acesso das pessoas
-- pelo painel "Administração" do site.
alter table public.membros add column if not exists admin boolean not null default false;

-- Quem está conectado é administrador?
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from public.membros
                   where lower(email) = lower(auth.jwt() ->> 'email') limit 1), false)
$$;

-- Lista de todas as contas criadas (inclusive quem ainda espera liberação)
-- e dos e-mails liberados que ainda não criaram conta. Só para administradores.
create or replace function public.admin_usuarios()
returns table (email text, nome text, papel text, admin boolean,
               criado_em timestamptz, ultimo_acesso timestamptz, tem_conta boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem ver a lista de usuários.' using errcode = '42501';
  end if;
  return query
    select x.email, x.nome, x.papel, x.admin, x.criado_em, x.ultimo_acesso, x.tem_conta
    from (
      select lower(u.email)::text as email, p.nome, m.papel, coalesce(m.admin, false) as admin,
             u.created_at as criado_em, u.last_sign_in_at as ultimo_acesso, true as tem_conta
      from auth.users u
      left join public.membros m on lower(m.email) = lower(u.email)
      left join public.perfis  p on lower(p.email) = lower(u.email)
      where u.email is not null
      union all
      select lower(m.email)::text, p.nome, m.papel, m.admin, m.criado_em, null::timestamptz, false
      from public.membros m
      left join public.perfis p on lower(p.email) = lower(m.email)
      where not exists (select 1 from auth.users u where lower(u.email) = lower(m.email))
    ) x
    order by x.email;
end $$;

-- Define o acesso de uma pessoa. Só para administradores.
--   novo_papel: 'leitor' (só visualiza), 'editor' (edita) ou 'nenhum' (tira o acesso)
--   novo_admin: true para administrador (sempre com papel de editor)
-- Não deixa ficar sem nenhum administrador.
create or replace function public.admin_definir_acesso(alvo text, novo_papel text, novo_admin boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(alvo));
  era_admin boolean;
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem mudar acessos.' using errcode = '42501';
  end if;
  if e is null or e = '' or position('@' in e) = 0 then
    raise exception 'E-mail inválido.';
  end if;
  select coalesce(bool_or(admin), false) into era_admin from public.membros where lower(email) = e;
  if era_admin and (novo_papel = 'nenhum' or not coalesce(novo_admin, false))
     and (select count(*) from public.membros where admin) <= 1 then
    raise exception 'Esta é a única conta de administrador. Torne outra pessoa administradora antes.';
  end if;
  if novo_papel = 'nenhum' then
    delete from public.membros where lower(email) = e;
    return;
  end if;
  if coalesce(novo_admin, false) then novo_papel := 'editor'; end if;
  if novo_papel not in ('editor', 'leitor') then
    raise exception 'Papel inválido.';
  end if;
  update public.membros set papel = novo_papel, admin = coalesce(novo_admin, false) where lower(email) = e;
  if not found then
    insert into public.membros (email, papel, admin) values (e, novo_papel, coalesce(novo_admin, false));
  end if;
end $$;

revoke all on function public.admin_usuarios() from public, anon;
revoke all on function public.admin_definir_acesso(text, text, boolean) from public, anon;
grant execute on function public.eh_admin() to authenticated;
grant execute on function public.admin_usuarios() to authenticated;
grant execute on function public.admin_definir_acesso(text, text, boolean) to authenticated;

-- Primeiro administrador: você (troque o e-mail)
update public.membros set admin = true, papel = 'editor'
where lower(email) = lower(current_setting('obra.admin_email')) and current_setting('obra.admin_email') not like 'SEU_EMAIL%';
$p4$;
  update public.banco_versao set versao = 4, atualizado_em = now();
  raise notice 'Passo 4 aplicado: Administração';
end $passo$;

-- =====================================================================
-- Passo 5: Pendências de obra
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 5 then return; end if;
  execute $p5$
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
$p5$;
  update public.banco_versao set versao = 5, atualizado_em = now();
  raise notice 'Passo 5 aplicado: Pendências de obra';
end $passo$;

-- =====================================================================
-- Passo 6: Avisos no celular
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 6 then return; end if;
  execute $p6$
-- extensões: chamadas HTTP a partir do banco e agenda diária
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Aparelhos inscritos para receber avisos (um por navegador/aparelho)
-- ---------------------------------------------------------------------
create table if not exists public.push_inscricoes (
  endpoint      text primary key,
  email         text not null,
  p256dh        text not null,
  auth          text not null,
  ua            text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists push_inscricoes_email on public.push_inscricoes (lower(email));
alter table public.push_inscricoes enable row level security;
drop policy if exists "ve as proprias inscricoes" on public.push_inscricoes;
create policy "ve as proprias inscricoes" on public.push_inscricoes for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
-- gravação só pelas funções abaixo (um aparelho passa para quem entrou nele por último)

create or replace function public.push_registrar(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.papel_atual() is null then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  insert into public.push_inscricoes (endpoint, email, p256dh, auth, ua)
  values (p_endpoint, lower(auth.jwt() ->> 'email'), p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth,
    ua = excluded.ua, atualizado_em = now();
end $$;
create or replace function public.push_remover(p_endpoint text)
returns void
language sql security definer set search_path = public as $$
  delete from public.push_inscricoes where endpoint = p_endpoint and lower(email) = lower(auth.jwt() ->> 'email')
$$;
revoke all on function public.push_registrar(text, text, text, text) from public, anon;
revoke all on function public.push_remover(text) from public, anon;
grant execute on function public.push_registrar(text, text, text, text) to authenticated;
grant execute on function public.push_remover(text) to authenticated;

-- ---------------------------------------------------------------------
-- Onde está a Edge Function e o segredo combinado com ela
-- (tabela sem regras de leitura: ninguém lê pelo site)
-- ---------------------------------------------------------------------
create table if not exists public.push_config (
  id         int primary key default 1 check (id = 1),
  funcao_url text,
  segredo    text,
  site_url   text
);
alter table public.push_config enable row level security;
insert into public.push_config (id, funcao_url, site_url)
values (1, 'https://bqqcllclzlyauprgpjjo.supabase.co/functions/v1/notificar', 'https://lucasoliveiralima01-cmd.github.io/obra/')
on conflict (id) do update set funcao_url = excluded.funcao_url, site_url = excluded.site_url;

-- chama a Edge Function (não espera a resposta; nunca impede o registro)
create or replace function public.push_chamar(p_corpo jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if c.funcao_url is null or coalesce(c.segredo, '') = '' then return; end if;
  perform net.http_post(
    url := c.funcao_url,
    body := p_corpo || jsonb_build_object('site', c.site_url),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-segredo', c.segredo),
    timeout_milliseconds := 5000);
exception when others then
  raise warning 'push_chamar: %', sqlerrm;
end $$;
revoke all on function public.push_chamar(jsonb) from public, anon, authenticated;

-- cada evento do histórico (nova pendência, mudança de status) gera um aviso
create or replace function public.push_ao_evento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.acao in ('criada', 'status') then
    perform public.push_chamar(jsonb_build_object('tipo', 'evento', 'evento', to_jsonb(new)));
  end if;
  return null;
end $$;
drop trigger if exists push_ao_evento on public.pendencia_eventos;
create trigger push_ao_evento after insert on public.pendencia_eventos
  for each row execute function public.push_ao_evento();

-- todo dia às 8h (horário de Brasília = 11h UTC): vencidas e resumo da Engenharia
create or replace function public.push_diario() returns void
language sql security definer set search_path = public as $$
  select public.push_chamar(jsonb_build_object('tipo', 'diario'))
$$;
revoke all on function public.push_diario() from public, anon, authenticated;
do $$ begin
  perform cron.unschedule('pendencias-diario');
exception when others then null; end $$;
select cron.schedule('pendencias-diario', '0 11 * * *', 'select public.push_diario()');
$p6$;
  update public.banco_versao set versao = 6, atualizado_em = now();
  raise notice 'Passo 6 aplicado: Avisos no celular';
end $passo$;

-- =====================================================================
-- Passo 7: Administração: atividade e convites
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 7 then return; end if;
  execute $p7$
-- Registro de atividade da administração
create table if not exists public.admin_log (
  id      bigserial primary key,
  em      timestamptz not null default now(),
  por     text,
  alvo    text,
  acao    text not null,   -- acesso | cargo | convite | senha | exclusao
  detalhe text
);
alter table public.admin_log enable row level security;
drop policy if exists "admins veem a atividade" on public.admin_log;
create policy "admins veem a atividade" on public.admin_log for select to authenticated using (public.eh_admin());
-- gravação só pelas funções abaixo e pela Edge Function "usuarios"

create or replace function public.admin_registrar(p_alvo text, p_acao text, p_detalhe text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  insert into public.admin_log (por, alvo, acao, detalhe) values (lower(auth.jwt() ->> 'email'), lower(p_alvo), p_acao, p_detalhe);
end $$;
revoke all on function public.admin_registrar(text, text, text) from public, anon;
grant execute on function public.admin_registrar(text, text, text) to authenticated;

-- Acesso (agora com registro de atividade)
create or replace function public.admin_definir_acesso(alvo text, novo_papel text, novo_admin boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(alvo));
  era_admin boolean;
  antes text;
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem mudar acessos.' using errcode = '42501';
  end if;
  if e is null or e = '' or position('@' in e) = 0 then
    raise exception 'E-mail inválido.';
  end if;
  select coalesce(bool_or(admin), false), max(case when admin then 'administrador' else papel end)
    into era_admin, antes from public.membros where lower(email) = e;
  if era_admin and (novo_papel = 'nenhum' or not coalesce(novo_admin, false))
     and (select count(*) from public.membros where admin) <= 1 then
    raise exception 'Esta é a única conta de administrador. Torne outra pessoa administradora antes.';
  end if;
  if novo_papel = 'nenhum' then
    delete from public.membros where lower(email) = e;
  else
    if coalesce(novo_admin, false) then novo_papel := 'editor'; end if;
    if novo_papel not in ('editor', 'leitor') then raise exception 'Papel inválido.'; end if;
    update public.membros set papel = novo_papel, admin = coalesce(novo_admin, false) where lower(email) = e;
    if not found then
      insert into public.membros (email, papel, admin) values (e, novo_papel, coalesce(novo_admin, false));
    end if;
  end if;
  insert into public.admin_log (por, alvo, acao, detalhe)
  values (lower(auth.jwt() ->> 'email'), e, 'acesso',
          coalesce(antes, 'sem acesso') || ' → ' || case when novo_papel = 'nenhum' then 'sem acesso'
                                                       when coalesce(novo_admin, false) then 'administrador' else novo_papel end);
end $$;

-- Cargo (agora com registro de atividade)
create or replace function public.admin_definir_cargo(alvo text, novo_cargo text, novas_disciplinas text[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(alvo));
  ds text[] := coalesce(novas_disciplinas, '{}');
  grupos int;
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
  insert into public.admin_log (por, alvo, acao, detalhe)
  values (lower(auth.jwt() ->> 'email'), e, 'cargo',
          antes || ' → ' || coalesce(novo_cargo, 'sem cargo') || case when novo_cargo = 'encarregado' then ' (' || array_to_string(ds, ', ') || ')' else '' end);
end $$;

-- Lista de pessoas com mais informações: convite aceito, avisos ligados, pendências registradas
drop function if exists public.admin_usuarios();
create or replace function public.admin_usuarios()
returns table (email text, nome text, papel text, admin boolean, cargo text, disciplinas text[],
               criado_em timestamptz, ultimo_acesso timestamptz, tem_conta boolean,
               confirmado boolean, avisos int, pendencias int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem ver a lista de usuários.' using errcode = '42501';
  end if;
  return query
    select x.email, x.nome, x.papel, x.admin, x.cargo, x.disciplinas, x.criado_em, x.ultimo_acesso, x.tem_conta, x.confirmado,
           (select count(*)::int from public.push_inscricoes s where lower(s.email) = x.email),
           (select count(*)::int from public.pendencias pd where lower(pd.criado_por) = x.email)
    from (
      select lower(u.email)::text as email, p.nome, m.papel, coalesce(m.admin, false) as admin,
             m.cargo, coalesce(m.disciplinas, '{}') as disciplinas,
             u.created_at as criado_em, u.last_sign_in_at as ultimo_acesso, true as tem_conta,
             (u.email_confirmed_at is not null) as confirmado
      from auth.users u
      left join public.membros m on lower(m.email) = lower(u.email)
      left join public.perfis  p on lower(p.email) = lower(u.email)
      where u.email is not null
      union all
      select lower(m.email)::text, p.nome, m.papel, m.admin, m.cargo, coalesce(m.disciplinas, '{}'),
             m.criado_em, null::timestamptz, false, false
      from public.membros m
      left join public.perfis p on lower(p.email) = lower(m.email)
      where not exists (select 1 from auth.users u where lower(u.email) = lower(m.email))
    ) x
    order by x.email;
end $$;
revoke all on function public.admin_usuarios() from public, anon;
grant execute on function public.admin_usuarios() to authenticated;
$p7$;
  update public.banco_versao set versao = 7, atualizado_em = now();
  raise notice 'Passo 7 aplicado: Administração: atividade e convites';
end $passo$;

-- =====================================================================
-- Passo 8: Lixeira, comentários, plantas, backup
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 8 then return; end if;
  execute $p8$
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
$p8$;
  update public.banco_versao set versao = 8, atualizado_em = now();
  raise notice 'Passo 8 aplicado: Lixeira, comentários, plantas, backup';
end $passo$;

-- =====================================================================
-- Passo 9: Locais por pavimento e cômodos por tipo de apartamento
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 9 then return; end if;
  execute $p9$
-- regras da obra (por enquanto: cômodos por final de apartamento)
alter table public.pend_config add column if not exists regras jsonb not null default '{}';

-- cômodos novos na lista geral
insert into public.pend_listas (tipo, valor, ordem, extra) values
  ('comodo', 'Banheiro social', 11, '{}'), ('comodo', 'Banheiro suíte', 12, '{}'),
  ('comodo', 'Suíte', 13, '{}'), ('comodo', 'Sacada (balcony)', 14, '{}')
on conflict (tipo, valor) do nothing;

-- obra Start: cômodos de cada tipo de apartamento (pelo final do número)
update public.pend_config set regras = jsonb_set(regras, '{comodos}', '[
  {"finais": ["01"], "comodos": ["Estar/sala", "Cozinha", "Área de serviço", "Banheiro social", "Banheiro suíte", "Dormitório 1", "Suíte", "Sacada (balcony)"]},
  {"finais": ["02"], "comodos": ["Estar/sala", "Cozinha", "Área de serviço", "Banheiro social", "Dormitório 1", "Dormitório 2", "Sacada (balcony)"]},
  {"finais": ["03", "04", "05", "06", "07"], "comodos": ["Studio", "Banheiro", "Sacada (balcony)"]},
  {"finais": ["08", "09", "10", "11", "12"], "comodos": ["Studio", "Banheiro"]}
]'::jsonb)
where obra = 'start' and not (regras ? 'comodos');

-- obra Start: locais de cada pavimento (sugestão inicial; ajuste em Listas)
update public.pend_config c set pavimentos = (
  select jsonb_agg(
    case
      when p ? 'locais' then p
      when p ->> 'nome' like 'Pavimento %' then p || '{"locais": ["Apartamento", "Circulação/hall", "Escadaria", "Shaft", "Fachada", "Área técnica", "Outro"]}'::jsonb
      when p ->> 'nome' = 'Térreo' then p || '{"locais": ["Circulação/hall", "Escadaria", "Shaft", "Fachada", "Garagem", "Área técnica", "Outro"]}'::jsonb
      when p ->> 'nome' = 'Fundação' then p || '{"locais": ["Área técnica", "Shaft", "Outro"]}'::jsonb
      else p || '{"locais": ["Cobertura", "Escadaria", "Área técnica", "Fachada", "Outro"]}'::jsonb
    end order by ord)
  from jsonb_array_elements(c.pavimentos) with ordinality as t(p, ord))
where c.obra = 'start' and jsonb_typeof(c.pavimentos) = 'array' and jsonb_array_length(c.pavimentos) > 0;
$p9$;
  update public.banco_versao set versao = 9, atualizado_em = now();
  raise notice 'Passo 9 aplicado: Locais por pavimento e cômodos por tipo de apartamento';
end $passo$;

-- =====================================================================
-- Passo 10: Listas por obra
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 10 then return; end if;
  execute $p10$
-- listas próprias da obra (null = usa o padrão da empresa, tabela pend_listas)
alter table public.pend_config add column if not exists listas jsonb;
alter table public.pend_config add column if not exists regras jsonb not null default '{}';

-- renomear não deve encher o histórico das pendências com "editou os dados"
create or replace function public.pend_depois_alterar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.renomeando', true), '') = '1' then return null; end if;
  if new.status is not distinct from old.status and new.excluida_em is not distinct from old.excluida_em then
    insert into public.pendencia_eventos (pendencia, por, acao, de, para)
    values (new.id, new.atualizado_por, 'editada', old.status, new.status);
  end if;
  return null;
end $$;

-- Renomeia um item nas pendências já registradas (só administradores).
--   p_obra: a obra (null = todas as obras que usam o padrão da empresa;
--           para disciplinas, todas as obras e também os encarregados)
--   p_campo: tipo | comodo | local_tipo | disciplina | pavimento | servico
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
  end if;
  perform set_config('app.renomeando', '', true);
  insert into public.admin_log (por, alvo, acao, detalhe)
  values (lower(auth.jwt() ->> 'email'), coalesce(p_obra, 'padrão'), 'listas', p_campo || ': “' || p_de || '” → “' || p_para || '” (' || n || ' pendência(s))');
  return n;
end $$;
revoke all on function public.pend_renomear(text, text, text, text) from public, anon;
grant execute on function public.pend_renomear(text, text, text, text) to authenticated;
$p10$;
  update public.banco_versao set versao = 10, atualizado_em = now();
  raise notice 'Passo 10 aplicado: Listas por obra';
end $passo$;

-- =====================================================================
-- Passo 11: Locais da Start e responsáveis por ofício
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 11 then return; end if;
  execute $p11$
alter table public.pendencias add column if not exists equipe text;
alter table public.pendencias drop constraint if exists pendencias_equipe_check;
alter table public.pendencias add constraint pendencias_equipe_check check (equipe is null or equipe in ('proprio', 'terceiro'));
alter table public.pend_plantas add column if not exists elevacao double precision;
alter table public.pend_config add column if not exists listas jsonb;

-- não encher o histórico das pendências com "editou" durante a troca de nomes
select set_config('app.renomeando', '1', false);

-- ---------------------------------------------------------------------
-- 1. Responsável pela correção: disciplina → cargo
-- ---------------------------------------------------------------------
create temp table if not exists _mapa (velho text primary key, novo text not null);
truncate _mapa;
insert into _mapa values
  ('Alvenaria/Reboco', 'Pedreiro'), ('Hidráulica', 'Encanador'), ('Elétrica', 'Eletricista'),
  ('Drywall', 'Montador de drywall'), ('Forro/Gesso', 'Gesseiro'), ('Impermeabilização', 'Impermeabilizador'),
  ('Revestimento', 'Azulejista'), ('Esquadrias', 'Instalador de esquadrias'), ('Pintura', 'Pintor'),
  ('Limpeza', 'Servente'), ('Segurança', 'Técnico de segurança'), ('Projeto/Engenharia', 'Engenharia');

-- problemas que eram da disciplina "Segurança" continuam sendo de segurança
update public.pend_listas set extra = extra || '{"seguranca": true}'::jsonb
where tipo = 'problema' and extra ->> 'disciplina' = 'Segurança';
update public.pend_listas l set extra = l.extra || jsonb_build_object('disciplina', m.novo)
from _mapa m where l.tipo = 'problema' and l.extra ->> 'disciplina' = m.velho;
-- listas próprias de obras (problemas com disciplina sugerida)
update public.pend_config c set listas = jsonb_set(c.listas, '{problema}', (
  select coalesce(jsonb_agg(case when m.velho is null then x
           else jsonb_set(x, '{extra}', coalesce(x -> 'extra', '{}'::jsonb) || jsonb_build_object('disciplina', m.novo)
                || case when m.velho = 'Segurança' then '{"seguranca": true}'::jsonb else '{}'::jsonb end) end order by ord), '[]'::jsonb)
  from jsonb_array_elements(c.listas -> 'problema') with ordinality as t(x, ord)
  left join _mapa m on m.velho = x -> 'extra' ->> 'disciplina'))
where c.listas is not null and jsonb_typeof(c.listas -> 'problema') = 'array';
-- a própria lista de disciplinas
update public.pend_listas l set valor = m.novo
from _mapa m where l.tipo = 'disciplina' and l.valor = m.velho
  and not exists (select 1 from public.pend_listas x where x.tipo = 'disciplina' and x.valor = m.novo);
delete from public.pend_listas l using _mapa m where l.tipo = 'disciplina' and l.valor = m.velho;
insert into public.pend_listas (tipo, valor, ordem, extra) values
  ('disciplina', 'Carpinteiro', 13, '{}'), ('disciplina', 'Serralheiro', 14, '{}')
on conflict (tipo, valor) do nothing;
-- pendências já registradas e encarregados
update public.pendencias p set disciplina = m.novo from _mapa m where p.disciplina = m.velho;
update public.membros set disciplinas = (
  select coalesce(array_agg(distinct coalesce(m.novo, d)), '{}') from unnest(disciplinas) d left join _mapa m on m.velho = d)
where disciplinas && (select array_agg(velho) from _mapa);

-- ---------------------------------------------------------------------
-- 2. Tipos de local (padrão da empresa); "opcoes" = o que perguntar depois
-- ---------------------------------------------------------------------
truncate _mapa;
insert into _mapa values ('Circulação/hall', 'Circulação'), ('Garagem', 'Estacionamento'), ('Área técnica', 'Área Técnica');
update public.pend_listas l set valor = m.novo
from _mapa m where l.tipo = 'local' and l.valor = m.velho
  and not exists (select 1 from public.pend_listas x where x.tipo = 'local' and x.valor = m.novo);
delete from public.pend_listas l using _mapa m where l.tipo = 'local' and l.valor = m.velho;
update public.pendencias p set local_tipo = m.novo from _mapa m where p.local_tipo = m.velho;

insert into public.pend_listas (tipo, valor, ordem, extra) values
  ('local', 'Apartamento', 1, '{}'), ('local', 'Circulação', 2, '{}'), ('local', 'Hall', 3, '{}'),
  ('local', 'Escadaria', 4, '{}'), ('local', 'Elevador', 5, '{"opcoes": ["Esquerda", "Direita"]}'),
  ('local', 'Shaft', 6, '{}'), ('local', 'Fachada', 7, '{"opcoes": ["Norte", "Sul", "Leste", "Oeste"]}'),
  ('local', 'Estacionamento', 8, '{}'), ('local', 'Zelador', 9, '{}'), ('local', 'Área Técnica', 10, '{}'),
  ('local', 'Terraço', 11, '{}'), ('local', 'Fitness', 12, '{}'), ('local', 'Lavanderia', 13, '{}'),
  ('local', 'Lavabo', 14, '{}'), ('local', 'Lavabo PCD', 15, '{}'), ('local', 'Churrasqueira 1', 16, '{}'),
  ('local', 'Churrasqueira 2', 17, '{}'), ('local', 'Piscina', 18, '{}'), ('local', 'Floreiras', 19, '{}'),
  ('local', 'Mesa de polias', 20, '{}'), ('local', 'Cobertura', 21, '{}'), ('local', 'Células', 22, '{}'),
  ('local', 'Outro', 99, '{}')
on conflict (tipo, valor) do update set ordem = excluded.ordem, extra = public.pend_listas.extra || excluded.extra;

-- ---------------------------------------------------------------------
-- 3. Obra Start: pavimentos, apartamentos e locais de cada pavimento
-- ---------------------------------------------------------------------
truncate _mapa;
insert into _mapa values
  ('Pavimento 02', '2º Pavimento'), ('Pavimento 03', '3º Pavimento'), ('Pavimento 04', '4º Pavimento'),
  ('Pavimento 05', '5º Pavimento'), ('Pavimento 06', '6º Pavimento'), ('Pavimento 07', '7º Pavimento'),
  ('Pavimento 08', '8º Pavimento'), ('Pavimento 09', '9º Pavimento'), ('Pavimento 10', '10º Pavimento'),
  ('Pavimento 11', '11º Pavimento'), ('Cobertura', 'Rooftop'), ('Nível deck', 'Deck');
update public.pendencias p set pavimento = m.novo from _mapa m where p.obra = 'start' and p.pavimento = m.velho;
update public.pendencias set local_tipo = 'Zelador', unidade = null, comodo = null where obra = 'start' and local_tipo = 'Apartamento' and unidade = 'Zelador';
update public.pendencias set local_tipo = 'Área Técnica', unidade = null, comodo = null where obra = 'start' and local_tipo = 'Apartamento' and unidade = 'Apoio técnico';
update public.pendencias set local_tipo = 'Terraço', unidade = null, comodo = null where obra = 'start' and local_tipo = 'Apartamento' and unidade = 'Terraço';

insert into public.pend_config (obra, pavimentos)
select 'start', '[]'::jsonb where exists (select 1 from public.obras where id = 'start')
on conflict (obra) do nothing;
update public.pend_config set pavimentos = '[
  {"nome": "Térreo", "unidades": [], "locais": ["Circulação", "Hall", "Estacionamento", "Elevador", "Outro"]},
  {"nome": "2º Pavimento", "unidades": ["201", "202"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "3º Pavimento", "unidades": ["301", "302", "303", "304", "305", "306", "307", "308", "309", "310", "311", "312"], "locais": ["Apartamento", "Circulação", "Escadaria", "Zelador", "Área Técnica", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "4º Pavimento", "unidades": ["401", "402", "403", "404", "405", "406", "407", "408", "409", "410", "411", "412"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "5º Pavimento", "unidades": ["501", "502", "503", "504", "505", "506", "507", "508", "509", "510", "511", "512"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "6º Pavimento", "unidades": ["601", "602", "603", "604", "605", "606", "607", "608", "609", "610", "611", "612"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "7º Pavimento", "unidades": ["701", "702", "703", "704", "705", "706", "707", "708", "709", "710", "711", "712"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "8º Pavimento", "unidades": ["801", "802", "803", "804", "805", "806", "807"], "locais": ["Apartamento", "Circulação", "Escadaria", "Terraço", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "9º Pavimento", "unidades": ["901", "902", "903", "904", "905", "906", "907"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "10º Pavimento", "unidades": ["1001", "1002", "1003", "1004", "1005", "1006", "1007"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "11º Pavimento", "unidades": ["1101", "1102", "1103", "1104", "1105", "1106", "1107"], "locais": ["Apartamento", "Circulação", "Escadaria", "Shaft", "Elevador", "Fachada", "Outro"]},
  {"nome": "Rooftop", "unidades": [], "locais": ["Circulação", "Fitness", "Lavanderia", "Lavabo", "Lavabo PCD", "Churrasqueira 1", "Churrasqueira 2", "Shaft", "Terraço", "Elevador", "Fachada", "Outro"]},
  {"nome": "Deck", "unidades": [], "locais": ["Escadaria", "Piscina", "Floreiras", "Terraço"]},
  {"nome": "Forro", "unidades": [], "locais": ["Mesa de polias", "Área Técnica", "Cobertura", "Fachada", "Outro"]},
  {"nome": "Reservatório", "unidades": [], "locais": ["Células", "Outro"]},
  {"nome": "Coroa", "unidades": [], "locais": ["Cobertura", "Outro"]}
]'::jsonb
where obra = 'start';
-- a Start passa a usar os tipos de local do padrão (com as opções de Elevador e Fachada)
update public.pend_config set listas = listas - 'local' where obra = 'start' and listas is not null;

select set_config('app.renomeando', '', false);
drop table if exists _mapa;
$p11$;
  update public.banco_versao set versao = 11, atualizado_em = now();
  raise notice 'Passo 11 aplicado: Locais da Start e responsáveis por ofício';
end $passo$;

-- =====================================================================
-- Passo 12: Funcionários por ofício
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 12 then return; end if;
  execute $p12$
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
$p12$;
  update public.banco_versao set versao = 12, atualizado_em = now();
  raise notice 'Passo 12 aplicado: Funcionários por ofício';
end $passo$;

-- =====================================================================
-- Passo 13: Mapa de Fachadas
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 13 then return; end if;
  execute $p13$
-- aviso de quebra de cura (chamado pelo Mapa de Fachadas) → Engenharia
create or replace function public.aviso_fachada(p_obra text, p_titulo text, p_corpo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.papel_atual() is null or not public.ve_mapas() then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  perform public.push_chamar(jsonb_build_object('tipo', 'fachada', 'obra', p_obra, 'titulo', left(p_titulo, 200), 'corpo', left(p_corpo, 800),
    'por', lower(auth.jwt() ->> 'email')));
end $$;
revoke all on function public.aviso_fachada(text, text, text) from public, anon;
grant execute on function public.aviso_fachada(text, text, text) to authenticated;

-- tipo de problema para abrir pendência de quebra de cura
insert into public.pend_listas (tipo, valor, ordem, extra)
values ('problema', 'Quebra de cura', 22, '{"disciplina":"Projeto/Engenharia"}')
on conflict (tipo, valor) do nothing;
$p13$;
  update public.banco_versao set versao = 13, atualizado_em = now();
  raise notice 'Passo 13 aplicado: Mapa de Fachadas';
end $passo$;

-- =====================================================================
-- Passo 14: Perfis, ofícios e acesso por obra
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 14 then return; end if;
  execute $p14$
-- ---------------------------------------------------------------------
-- 1. Perfil e obras de cada pessoa
-- ---------------------------------------------------------------------
alter table public.membros add column if not exists perfil text;
alter table public.membros add column if not exists obras text[];

-- quem já tinha acesso: perfil a partir do acesso + cargo de antes
update public.membros set perfil = case
    when admin then 'admin'
    when cargo = 'encarregado' then 'campo'
    when cargo = 'engenharia' then 'engenharia'
    when cargo = 'seguranca' then 'seguranca'
    when papel = 'editor' then 'engenharia'
    else 'consulta' end
where perfil is null;

-- obras: quem é de campo fica nas obras em que está cadastrado como funcionário;
-- os demais continuam vendo as obras que já existem (o administrador ajusta depois)
do $$ begin
  if to_regclass('public.pend_funcionarios') is not null then
    update public.membros m set obras = (
      select array_agg(distinct f.obra order by f.obra) from public.pend_funcionarios f
      where lower(f.email) = lower(m.email) and f.ativo and f.obra is not null)
    where m.obras is null and m.perfil = 'campo';
  end if;
end $$;
update public.membros set obras = (select coalesce(array_agg(id order by id), '{}') from public.obras where excluida_em is null)
where obras is null;

alter table public.membros alter column obras set default '{}';
alter table public.membros alter column obras set not null;
alter table public.membros drop constraint if exists membros_perfil_check;
alter table public.membros add constraint membros_perfil_check
  check (perfil in ('admin', 'engenharia', 'seguranca', 'campo', 'consulta'));

-- o perfil manda; papel, admin e cargo ficam iguais a ele (compatibilidade)
create or replace function public.membros_perfil() returns trigger
language plpgsql as $$
begin
  if new.perfil is null then
    new.perfil := case when coalesce(new.admin, false) then 'admin'
                       when new.cargo = 'encarregado' then 'campo'
                       when new.cargo in ('engenharia', 'seguranca') then new.cargo
                       when new.papel = 'editor' then 'engenharia'
                       else 'consulta' end;
  end if;
  new.email := lower(trim(new.email));
  new.admin := new.perfil = 'admin';
  new.papel := case when new.perfil in ('admin', 'engenharia', 'seguranca') then 'editor' else 'leitor' end;
  new.cargo := case new.perfil when 'admin' then 'engenharia' when 'engenharia' then 'engenharia'
                               when 'seguranca' then 'seguranca' when 'campo' then 'encarregado' end;
  new.obras := coalesce((select array_agg(distinct x order by x) from unnest(new.obras) x where coalesce(x, '') <> ''), '{}');
  new.disciplinas := coalesce((select array_agg(distinct x order by x) from unnest(new.disciplinas) x where coalesce(x, '') <> ''), '{}');
  return new;
end $$;
drop trigger if exists membros_perfil on public.membros;
create trigger membros_perfil before insert or update on public.membros
for each row execute function public.membros_perfil();
update public.membros set perfil = perfil;   -- acerta papel/admin/cargo de quem já existe

-- ---------------------------------------------------------------------
-- 2. Quem está conectado: perfil, obras e o que pode fazer
-- ---------------------------------------------------------------------
create or replace function public.perfil_atual() returns text
language sql stable security definer set search_path = public as $$
  select perfil from public.membros where lower(email) = lower(auth.jwt() ->> 'email') limit 1
$$;
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.perfil_atual() = 'admin', false)
$$;
-- a obra está liberada para quem está conectado? (administrador: todas)
create or replace function public.obra_ok(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.perfil = 'admin' or p_obra = any(m.obras)
                   from public.membros m where lower(m.email) = lower(auth.jwt() ->> 'email') limit 1), false)
$$;
-- ferramenta (risco, concretagem, fachada) que o perfil vê ou edita
create or replace function public.ferramenta_ok(p_ferr text, p_editar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case public.perfil_atual()
    when 'admin'      then true
    when 'engenharia' then true
    when 'seguranca'  then p_ferr = 'risco'
    when 'consulta'   then not p_editar and p_ferr in ('risco', 'concretagem', 'fachada')
    else false end, false)
$$;
-- painel = "ferramenta:obra"; "sistema:…" guarda marcadores internos (ex.: carga da obra Start)
create or replace function public.painel_ok(p_painel text, p_editar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_painel, ':', 1) = 'sistema'
    then coalesce(public.perfil_atual() in ('admin', 'engenharia') or (not p_editar and public.perfil_atual() is not null), false)
    else public.ferramenta_ok(split_part(p_painel, ':', 1), p_editar) and public.obra_ok(split_part(p_painel, ':', 2)) end
$$;
-- vê algum mapa? (quem é de campo usa só as pendências)
create or replace function public.ve_mapas() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.perfil_atual() in ('admin', 'engenharia', 'seguranca', 'consulta'), false)
$$;
-- tudo de uma vez, para o site
create or replace function public.meu_acesso() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('perfil', m.perfil, 'oficios', m.disciplinas,
           'obras', case when m.perfil = 'admin' then null else m.obras end)
  from public.membros m where lower(m.email) = lower(auth.jwt() ->> 'email') limit 1
$$;
revoke all on function public.meu_acesso() from public, anon;
grant execute on function public.meu_acesso() to authenticated;
grant execute on function public.perfil_atual() to authenticated;
grant execute on function public.obra_ok(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Obras: cada um vê só as suas; quem cria a obra já entra nela
-- ---------------------------------------------------------------------
create or replace function public.obra_ao_criar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') <> '' then new.criado_por := lower(auth.jwt() ->> 'email'); end if;
  update public.membros set obras = array_append(obras, new.id)
  where lower(email) = lower(auth.jwt() ->> 'email') and perfil <> 'admin' and not (new.id = any(obras));
  return new;
end $$;
drop trigger if exists obra_ao_criar on public.obras;
create trigger obra_ao_criar before insert on public.obras for each row execute function public.obra_ao_criar();

create or replace function public.obra_ao_apagar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.membros set obras = array_remove(obras, old.id) where old.id = any(obras);
  return null;
end $$;
drop trigger if exists obra_ao_apagar on public.obras;
create trigger obra_ao_apagar after delete on public.obras for each row execute function public.obra_ao_apagar();

drop policy if exists "membros leem obras"     on public.obras;
drop policy if exists "editores criam obras"   on public.obras;
drop policy if exists "editores alteram obras" on public.obras;
drop policy if exists "editores apagam obras"  on public.obras;
create policy "membros leem obras" on public.obras for select to authenticated
  using (excluida_em is null and (public.obra_ok(id)
         -- quem acabou de criar (a liberação dela entra no mesmo comando)
         or (lower(criado_por) = lower(auth.jwt() ->> 'email') and criado_em > now() - interval '5 minutes'
             and public.perfil_atual() in ('admin', 'engenharia'))));
create policy "editores criam obras" on public.obras for insert to authenticated
  with check (public.perfil_atual() in ('admin', 'engenharia'));
create policy "editores alteram obras" on public.obras for update to authenticated
  using (public.obra_ok(id) and public.perfil_atual() in ('admin', 'engenharia', 'seguranca'))
  with check (public.obra_ok(id) and public.perfil_atual() in ('admin', 'engenharia', 'seguranca'));
create policy "editores apagam obras" on public.obras for delete to authenticated
  using (public.eh_admin());

create or replace function public.obra_excluir(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.eh_admin() or (public.perfil_atual() = 'engenharia' and public.obra_ok(p_id))) then
    raise exception 'Só a Engenharia e os administradores podem excluir obras.' using errcode = '42501';
  end if;
  update public.obras set excluida_em = now(), excluida_por = lower(auth.jwt() ->> 'email') where id = p_id and excluida_em is null;
  insert into public.admin_log (por, alvo, acao, detalhe) values (lower(auth.jwt() ->> 'email'), p_id, 'lixeira', 'obra enviada para a lixeira');
end $$;

-- ---------------------------------------------------------------------
-- 4. Mapas (registros) e arquivos: por ferramenta e por obra
-- ---------------------------------------------------------------------
drop policy if exists "membros leem"     on public.registros;
drop policy if exists "editores inserem" on public.registros;
drop policy if exists "editores alteram" on public.registros;
drop policy if exists "editores apagam"  on public.registros;
create policy "membros leem"     on public.registros for select to authenticated using (public.painel_ok(painel, false));
create policy "editores inserem" on public.registros for insert to authenticated with check (public.painel_ok(painel, true));
create policy "editores alteram" on public.registros for update to authenticated using (public.painel_ok(painel, true)) with check (public.painel_ok(painel, true));
create policy "editores apagam"  on public.registros for delete to authenticated using (public.painel_ok(painel, true));

-- arquivos: <ferramenta>/<obra>/…, obras/<obra>/… (modelo IFC),
-- pendencias/<obra>/<pendência>/… (fotos) e pendencias/<obra>/plantas/…
drop policy if exists "membros baixam arquivos"  on storage.objects;
drop policy if exists "editores enviam arquivos" on storage.objects;
drop policy if exists "editores apagam arquivos" on storage.objects;
drop policy if exists "plantas baixam"  on storage.objects;
drop policy if exists "plantas enviam"  on storage.objects;
drop policy if exists "plantas apagam"  on storage.objects;
drop policy if exists "pendencias baixam fotos"  on storage.objects;
drop policy if exists "pendencias enviam fotos"  on storage.objects;
drop policy if exists "pendencias apagam fotos"  on storage.objects;

create or replace function public.arquivo_ok(p_nome text, p_editar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_nome, '/', 1) in ('risco', 'concretagem', 'fachada')
      then public.painel_ok(split_part(p_nome, '/', 1) || ':' || split_part(p_nome, '/', 2), p_editar)
    when split_part(p_nome, '/', 1) = 'obras'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and coalesce(public.perfil_atual() in ('admin', 'engenharia', 'seguranca') or (not p_editar and public.perfil_atual() = 'consulta'), false)
    when p_nome like 'pendencias/%/plantas/%'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and (not p_editar or public.ferramenta_ok('risco', true))
    when split_part(p_nome, '/', 1) = 'pendencias'
      then public.pend_visivel_id(split_part(p_nome, '/', 3))
           and (not p_editar or coalesce(public.perfil_atual() <> 'consulta', false))
    else false end
$$;

create policy "membros baixam arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'arquivos' and public.arquivo_ok(name, false));
create policy "editores enviam arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivos' and public.arquivo_ok(name, true));
create policy "editores apagam arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'arquivos' and public.arquivo_ok(name, true)
         and (name not like 'pendencias/%' or name like 'pendencias/%/plantas/%'
              or coalesce(public.perfil_atual() in ('admin', 'engenharia', 'seguranca'), false)));

-- ---------------------------------------------------------------------
-- 5. Nomes, listas e configurações das pendências
-- ---------------------------------------------------------------------
drop policy if exists "membros veem a equipe" on public.membros;
create policy "membros veem a equipe" on public.membros for select to authenticated using (public.eh_admin());

drop policy if exists "cada um cria o seu nome" on public.perfis;
drop policy if exists "cada um muda o seu nome" on public.perfis;
create policy "cada um cria o seu nome" on public.perfis for insert to authenticated
  with check (lower(email) = lower(auth.jwt() ->> 'email') or public.eh_admin());
create policy "cada um muda o seu nome" on public.perfis for update to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.eh_admin())
  with check (lower(email) = lower(auth.jwt() ->> 'email') or public.eh_admin());

drop policy if exists "membros leem config" on public.pend_config;
create policy "membros leem config" on public.pend_config for select to authenticated using (public.obra_ok(obra));

drop policy if exists "membros veem plantas" on public.pend_plantas;
drop policy if exists "editores gravam plantas" on public.pend_plantas;
create policy "membros veem plantas" on public.pend_plantas for select to authenticated using (public.obra_ok(obra));
create policy "editores gravam plantas" on public.pend_plantas for all to authenticated
  using (public.obra_ok(obra) and public.ferramenta_ok('risco', true))
  with check (public.obra_ok(obra) and public.ferramenta_ok('risco', true));

drop policy if exists "membros veem funcionarios" on public.pend_funcionarios;
create policy "membros veem funcionarios" on public.pend_funcionarios for select to authenticated
  using (public.perfil_atual() is not null and (obra is null or public.obra_ok(obra)));

-- ---------------------------------------------------------------------
-- 6. Funcionários: quem tem login e é de campo aparece sozinho nas obras dele
--    (o cadastro manual em Listas e regras fica só para quem não usa o sistema)
-- ---------------------------------------------------------------------
drop trigger if exists func_sincronizar on public.pend_funcionarios;
drop function if exists public.func_sincronizar();

create or replace function public.membro_funcionarios(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(p_email));
  m public.membros;
  nm text;
begin
  select * into m from public.membros where lower(email) = e;
  update public.pend_funcionarios f set ativo = false
  where lower(f.email) = e and f.ativo
    and (m.email is null or m.perfil <> 'campo' or f.obra is null or not (f.obra = any(m.obras)));
  if m.email is null or m.perfil <> 'campo' then return; end if;
  select nullif(trim(nome), '') into nm from public.perfis where lower(email) = e;
  update public.pend_funcionarios f set cargos = m.disciplinas, ativo = true
  where lower(f.email) = e and f.obra = any(m.obras);
  insert into public.pend_funcionarios (obra, nome, cargos, email, ativo)
  select o, coalesce(nm, split_part(e, '@', 1)), m.disciplinas, e, true
  from unnest(m.obras) o
  where exists (select 1 from public.obras where id = o)
    and not exists (select 1 from public.pend_funcionarios f where lower(f.email) = e and f.obra = o);
end $$;
revoke all on function public.membro_funcionarios(text) from public, anon, authenticated;

create or replace function public.membros_funcionarios() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.membro_funcionarios(case when tg_op = 'DELETE' then old.email else new.email end);
  return null;
end $$;
drop trigger if exists membros_funcionarios on public.membros;
create trigger membros_funcionarios after insert or update or delete on public.membros
for each row execute function public.membros_funcionarios();

-- trocou o nome: o funcionário ligado ao login acompanha
create or replace function public.perfis_funcionarios() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(new.nome), '') <> '' then
    update public.pend_funcionarios set nome = trim(new.nome) where lower(email) = lower(new.email) and nome is distinct from trim(new.nome);
  end if;
  return null;
end $$;
drop trigger if exists perfis_funcionarios on public.perfis;
create trigger perfis_funcionarios after insert or update on public.perfis
for each row execute function public.perfis_funcionarios();

-- acerta os funcionários de quem já é de campo
do $$ declare r record; begin
  for r in select email from public.membros loop perform public.membro_funcionarios(r.email); end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Pendências: por obra, "em avaliação" e o caminho da Segurança
-- ---------------------------------------------------------------------
alter table public.pendencias drop constraint if exists pendencias_status_check;
alter table public.pendencias add constraint pendencias_status_check
  check (status in ('avaliacao', 'aberta', 'em_correcao', 'corrigida', 'fechada'));

-- quem vê a pendência
create or replace function public.pend_ve(p_obra text, p_seg boolean, p_disc text, p_status text, p_por text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when not (m.perfil = 'admin' or p_obra = any(m.obras)) then false
      when m.perfil in ('admin', 'engenharia', 'consulta') then true
      when m.perfil = 'seguranca' then p_seg or lower(p_por) = lower(m.email)
      when m.perfil = 'campo' then lower(p_por) = lower(m.email)
                                   or (p_status <> 'avaliacao' and p_disc = any(m.disciplinas))
      else false end
    from public.membros m where lower(m.email) = lower(auth.jwt() ->> 'email') limit 1), false)
$$;
-- quem edita os dados (não o status)
create or replace function public.pend_edita(p_obra text, p_seg boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() in ('admin', 'engenharia')
                                             or (public.perfil_atual() = 'seguranca' and p_seg), false)
$$;
-- quem dá a baixa final, reprova e avalia: Segurança nas de segurança, Engenharia nas outras
create or replace function public.pend_decide(p_obra text, p_seg boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() = 'admin'
    or (p_seg and public.perfil_atual() = 'seguranca')
    or (not p_seg and public.perfil_atual() = 'engenharia'), false)
$$;
create or replace function public.pend_visivel_id(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pendencias p
                 where p.id::text = p_id and public.pend_ve(p.obra, p.seguranca, p.disciplina, p.status, p.criado_por))
$$;
-- compatibilidade com telas antigas (sem a obra)
create or replace function public.pend_editor(p_seg boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.perfil_atual() in ('admin', 'engenharia') or (public.perfil_atual() = 'seguranca' and p_seg), false)
$$;
create or replace function public.pend_fecha(p_seg boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.perfil_atual() = 'admin' or (p_seg and public.perfil_atual() = 'seguranca')
                  or (not p_seg and public.perfil_atual() = 'engenharia'), false)
$$;

-- ao criar: quem é de campo só sugere (em avaliação); a Segurança sempre registra como de segurança
create or replace function public.pend_ao_criar() returns trigger
language plpgsql security definer set search_path = public as $$
declare pf text := public.perfil_atual();
begin
  perform pg_advisory_xact_lock(hashtext('pend:' || new.obra));
  select coalesce(max(numero), 0) + 1 into new.numero from public.pendencias where obra = new.obra;
  new.criado_por := lower(auth.jwt() ->> 'email');
  new.atualizado_por := new.criado_por;
  if pf = 'seguranca' then new.seguranca := true; end if;
  new.status := case when pf = 'campo' or new.status = 'avaliacao' then 'avaliacao' else 'aberta' end;
  if new.criado_em is null or new.criado_em > now() then new.criado_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;
create or replace function public.pend_depois_criar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pendencia_eventos (pendencia, em, por, acao, para)
  values (new.id, new.criado_em, new.criado_por, 'criada', new.status);
  return null;
end $$;

drop policy if exists "ve pendencias"    on public.pendencias;
drop policy if exists "cria pendencias"  on public.pendencias;
drop policy if exists "edita pendencias" on public.pendencias;
drop policy if exists "apaga pendencias" on public.pendencias;
create policy "ve pendencias" on public.pendencias for select to authenticated
  using (excluida_em is null and public.pend_ve(obra, seguranca, disciplina, status, criado_por));
create policy "cria pendencias" on public.pendencias for insert to authenticated
  with check (public.obra_ok(obra) and coalesce(
      public.perfil_atual() in ('admin', 'engenharia')
      or (public.perfil_atual() = 'seguranca' and seguranca)
      or (public.perfil_atual() = 'campo' and status = 'avaliacao'), false));
create policy "edita pendencias" on public.pendencias for update to authenticated
  using (public.pend_edita(obra, seguranca)) with check (public.pend_edita(obra, seguranca));
create policy "apaga pendencias" on public.pendencias for delete to authenticated
  using (public.pend_edita(obra, seguranca));

-- mudança de status
--   avaliacao -> aberta (encaminhar para correção; precisa do ofício) ou recusada (vai para a lixeira)
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
  select * into p from public.pendencias where id = p_id and excluida_em is null for update;
  if not found then raise exception 'Pendência não encontrada.'; end if;
  if not public.pend_ve(p.obra, p.seguranca, p.disciplina, p.status, p.criado_por)
     or coalesce(public.perfil_atual(), 'consulta') = 'consulta' then
    raise exception 'Você não tem acesso a esta pendência.' using errcode = '42501';
  end if;
  if p_para = p.status then return; end if;
  if p.status = 'avaliacao' then
    if not public.pend_decide(p.obra, p.seguranca) then
      raise exception '%', case when p.seguranca then 'Quem avalia esta pendência é a Segurança do Trabalho.'
                                else 'Quem avalia esta sugestão é a Engenharia.' end using errcode = '42501';
    end if;
    if p_para = 'aberta' then
      if coalesce(trim(p.disciplina), '') in ('', 'A definir') then
        raise exception 'Escolha o ofício de quem vai corrigir antes de encaminhar.';
      end if;
    elsif p_para = 'recusada' then
      if coalesce(trim(p_comentario), '') = '' then raise exception 'Escreva o motivo.'; end if;
      update public.pendencias set excluida_em = now(), excluida_por = eu where id = p_id;
      insert into public.pendencia_eventos (pendencia, por, acao, de, para, comentario)
      values (p_id, eu, 'status', p.status, 'recusada', trim(p_comentario));
      return;
    else
      raise exception 'Mudança de status não permitida.';
    end if;
  elsif p_para = 'em_correcao' and p.status = 'aberta' then
    null;
  elsif p_para = 'corrigida' and p.status in ('aberta', 'em_correcao') then
    select max(em) into ult from public.pendencia_eventos where pendencia = p_id and para = 'aberta';
    if not exists (select 1 from public.pendencia_fotos f where f.pendencia = p_id and f.tipo = 'depois'
                   and f.criado_em >= coalesce(ult, '-infinity'::timestamptz)) then
      raise exception 'Anexe a foto do depois para marcar como corrigida.';
    end if;
  elsif p_para = 'fechada' and p.status = 'corrigida' then
    if not public.pend_decide(p.obra, p.seguranca) then
      raise exception '%', case when p.seguranca then 'Só a Segurança dá a baixa final nas pendências de segurança.'
                                else 'Só a Engenharia fecha a pendência.' end using errcode = '42501';
    end if;
  elsif p_para = 'aberta' and p.status in ('corrigida', 'fechada') then
    if not public.pend_decide(p.obra, p.seguranca) then
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

-- foto: "depois" por quem vê (menos Consulta); "antes" por quem edita ou por quem sugeriu
create or replace function public.pend_pode_foto(p_id uuid, p_tipo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pendencias p where p.id = p_id
                 and public.pend_ve(p.obra, p.seguranca, p.disciplina, p.status, p.criado_por)
                 and coalesce(public.perfil_atual() <> 'consulta', false)
                 and (p_tipo = 'depois' or public.pend_edita(p.obra, p.seguranca)
                      or (p.status = 'avaliacao' and lower(p.criado_por) = lower(auth.jwt() ->> 'email'))))
$$;
drop policy if exists "apaga fotos" on public.pendencia_fotos;
create policy "apaga fotos" on public.pendencia_fotos for delete to authenticated
  using (lower(criado_por) = lower(auth.jwt() ->> 'email') or exists (
    select 1 from public.pendencias p where p.id = pendencia and public.pend_edita(p.obra, p.seguranca)));

create or replace function public.pendencia_comentar(p_id uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pendencias;
begin
  select * into p from public.pendencias where id = p_id and excluida_em is null;
  if not found or not public.pend_ve(p.obra, p.seguranca, p.disciplina, p.status, p.criado_por)
     or coalesce(public.perfil_atual(), 'consulta') = 'consulta' then
    raise exception 'Você não pode comentar nesta pendência.' using errcode = '42501';
  end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Escreva o comentário.'; end if;
  insert into public.pendencia_eventos (pendencia, por, acao, para, comentario)
  values (p_id, lower(auth.jwt() ->> 'email'), 'comentario', p.status, left(trim(p_texto), 2000));
end $$;

create or replace function public.pendencia_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pendencias;
begin
  select * into p from public.pendencias where id = p_id;
  if not found then return; end if;
  if not public.pend_edita(p.obra, p.seguranca) then raise exception 'Você não pode excluir esta pendência.' using errcode = '42501'; end if;
  update public.pendencias set excluida_em = now(), excluida_por = lower(auth.jwt() ->> 'email') where id = p_id;
  insert into public.pendencia_eventos (pendencia, por, acao, comentario) values (p_id, lower(auth.jwt() ->> 'email'), 'excluida', 'enviada para a lixeira');
end $$;

-- avisos do Mapa de Concretagem e do Mapa de Fachadas: só quem edita aquela ferramenta na obra
create or replace function public.aviso_concreto(p_obra text, p_titulo text, p_corpo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.painel_ok('concretagem:' || p_obra, true) then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  perform public.push_chamar(jsonb_build_object('tipo', 'concreto', 'obra', p_obra, 'titulo', left(p_titulo, 200), 'corpo', left(p_corpo, 500),
    'por', lower(auth.jwt() ->> 'email')));
end $$;
create or replace function public.aviso_fachada(p_obra text, p_titulo text, p_corpo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.painel_ok('fachada:' || p_obra, true) then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  perform public.push_chamar(jsonb_build_object('tipo', 'fachada', 'obra', p_obra, 'titulo', left(p_titulo, 200), 'corpo', left(p_corpo, 800),
    'por', lower(auth.jwt() ->> 'email')));
end $$;

-- ---------------------------------------------------------------------
-- 8. Resetar um mapa: só administradores, e o conteúdo vai para a lixeira
-- ---------------------------------------------------------------------
create table if not exists public.lixeira_paineis (
  id           uuid primary key default gen_random_uuid(),
  painel       text not null,
  registros    jsonb not null,
  excluida_em  timestamptz not null default now(),
  excluida_por text
);
alter table public.lixeira_paineis enable row level security;
drop policy if exists "admins veem paineis" on public.lixeira_paineis;
create policy "admins veem paineis" on public.lixeira_paineis for select to authenticated using (public.eh_admin());

create or replace function public.painel_resetar(p_painel text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.eh_admin() then raise exception 'Só administradores podem resetar um mapa.' using errcode = '42501'; end if;
  if split_part(p_painel, ':', 1) not in ('risco', 'concretagem', 'fachada') or split_part(p_painel, ':', 2) = '' then
    raise exception 'Mapa inválido.';
  end if;
  select count(*) into n from public.registros where painel = p_painel;
  if n = 0 then return 0; end if;
  insert into public.lixeira_paineis (painel, registros, excluida_por)
  select p_painel, jsonb_agg(to_jsonb(r)), lower(auth.jwt() ->> 'email') from public.registros r where r.painel = p_painel;
  delete from public.registros where painel = p_painel;
  insert into public.admin_log (por, alvo, acao, detalhe)
  values (lower(auth.jwt() ->> 'email'), split_part(p_painel, ':', 2), 'lixeira', split_part(p_painel, ':', 1) || ': mapa resetado (' || n || ' item(ns) na lixeira)');
  return n;
end $$;
revoke all on function public.painel_resetar(text) from public, anon;
grant execute on function public.painel_resetar(text) to authenticated;

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
    union all
    select 'painel'::text, l.id::text, split_part(l.painel, ':', 2),
           case split_part(l.painel, ':', 1) when 'risco' then 'Mapa de Risco' when 'concretagem' then 'Mapa de Concretagem' else 'Mapa de Fachadas' end
             || ' resetado (' || jsonb_array_length(l.registros) || ' itens)', l.excluida_em, l.excluida_por
    from public.lixeira_paineis l
    order by 5 desc;
end $$;

create or replace function public.admin_restaurar(p_tipo text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.lixeira_paineis;
begin
  if not public.eh_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  if p_tipo = 'obra' then
    update public.obras set excluida_em = null, excluida_por = null where id = p_id;
  elsif p_tipo = 'painel' then
    select * into l from public.lixeira_paineis where id::text = p_id;
    if not found then raise exception 'Item não encontrado na lixeira.'; end if;
    -- volta o que foi apagado; o que foi feito depois do reset continua
    insert into public.registros (painel, colecao, id, dados, atualizado_em, atualizado_por)
    select x.painel, x.colecao, x.id, x.dados, x.atualizado_em, x.atualizado_por
    from jsonb_populate_recordset(null::public.registros, l.registros) x
    on conflict (painel, colecao, id) do update set dados = excluded.dados, atualizado_em = now(), atualizado_por = lower(auth.jwt() ->> 'email');
    delete from public.lixeira_paineis where id = l.id;
  else
    update public.pendencias set excluida_em = null, excluida_por = null where id::text = p_id;
    insert into public.pendencia_eventos (pendencia, por, acao, comentario) values (p_id::uuid, lower(auth.jwt() ->> 'email'), 'excluida', 'restaurada da lixeira');
  end if;
  insert into public.admin_log (por, alvo, acao, detalhe) values (lower(auth.jwt() ->> 'email'), p_id, 'lixeira', p_tipo || ' restaurada');
end $$;

-- ---------------------------------------------------------------------
-- 9. Administração: perfil, ofícios e obras de cada pessoa
-- ---------------------------------------------------------------------
drop function if exists public.admin_usuarios();
create or replace function public.admin_usuarios()
returns table (email text, nome text, perfil text, oficios text[], obras text[],
               papel text, admin boolean, cargo text, disciplinas text[],
               criado_em timestamptz, ultimo_acesso timestamptz, tem_conta boolean,
               confirmado boolean, avisos int, pendencias int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem ver a lista de usuários.' using errcode = '42501';
  end if;
  return query
    select x.email, x.nome, x.perfil, x.disciplinas, x.obras, x.papel, x.admin, x.cargo, x.disciplinas,
           x.criado_em, x.ultimo_acesso, x.tem_conta, x.confirmado,
           (select count(*)::int from public.push_inscricoes s where lower(s.email) = x.email),
           (select count(*)::int from public.pendencias pd where lower(pd.criado_por) = x.email)
    from (
      select lower(u.email)::text as email, p.nome, m.perfil, coalesce(m.disciplinas, '{}') as disciplinas,
             coalesce(m.obras, '{}') as obras, m.papel, coalesce(m.admin, false) as admin, m.cargo,
             u.created_at as criado_em, u.last_sign_in_at as ultimo_acesso, true as tem_conta,
             (u.email_confirmed_at is not null) as confirmado
      from auth.users u
      left join public.membros m on lower(m.email) = lower(u.email)
      left join public.perfis  p on lower(p.email) = lower(u.email)
      where u.email is not null
      union all
      select lower(m.email)::text, p.nome, m.perfil, coalesce(m.disciplinas, '{}'), coalesce(m.obras, '{}'),
             m.papel, m.admin, m.cargo, m.criado_em, null::timestamptz, false, false
      from public.membros m
      left join public.perfis p on lower(p.email) = lower(m.email)
      where not exists (select 1 from auth.users u where lower(u.email) = lower(m.email))
    ) x
    order by x.email;
end $$;
revoke all on function public.admin_usuarios() from public, anon;
grant execute on function public.admin_usuarios() to authenticated;

-- perfil: 'admin' | 'engenharia' | 'seguranca' | 'campo' | 'consulta' | 'nenhum' (bloqueia o acesso)
-- ofícios e obras: null = mantém como está
create or replace function public.admin_definir_perfil(alvo text, novo_perfil text, novos_oficios text[] default null, novas_obras text[] default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(alvo));
  m public.membros;
  rot jsonb := '{"admin":"Administrador","engenharia":"Engenharia","seguranca":"Segurança","campo":"Campo","consulta":"Consulta"}';
  antes text; depois text;
begin
  if not public.eh_admin() then raise exception 'Só administradores podem mudar o perfil das pessoas.' using errcode = '42501'; end if;
  if e is null or e = '' or position('@' in e) = 0 then raise exception 'E-mail inválido.'; end if;
  if novo_perfil not in ('admin', 'engenharia', 'seguranca', 'campo', 'consulta', 'nenhum') then raise exception 'Perfil inválido.'; end if;
  select * into m from public.membros where lower(email) = e;
  if m.perfil = 'admin' and novo_perfil <> 'admin' and (select count(*) from public.membros where perfil = 'admin') <= 1 then
    raise exception 'Esta é a única conta de administrador. Torne outra pessoa administradora antes.';
  end if;
  antes := case when m.email is null then 'sem acesso' else
             coalesce(rot ->> m.perfil, m.perfil)
             || case when m.perfil = 'campo' and array_length(m.disciplinas, 1) > 0 then ' (' || array_to_string(m.disciplinas, ', ') || ')' else '' end
             || case when m.perfil <> 'admin' then ' · obras: ' || coalesce(nullif(array_to_string(m.obras, ', '), ''), 'nenhuma') else '' end end;
  if novo_perfil = 'nenhum' then
    delete from public.membros where lower(email) = e;
    depois := 'sem acesso';
  else
    if novo_perfil = 'campo' and array_length(coalesce(novos_oficios, m.disciplinas, '{}'), 1) is null then
      raise exception 'Marque ao menos um ofício para quem é de campo.';
    end if;
    if m.email is null then
      insert into public.membros (email, perfil, disciplinas, obras)
      values (e, novo_perfil, coalesce(novos_oficios, '{}'), coalesce(novas_obras, '{}'));
    else
      update public.membros set perfil = novo_perfil,
             disciplinas = coalesce(novos_oficios, disciplinas),
             obras = coalesce(novas_obras, obras)
      where lower(email) = e;
    end if;
    select * into m from public.membros where lower(email) = e;
    depois := coalesce(rot ->> m.perfil, m.perfil)
              || case when m.perfil = 'campo' then ' (' || array_to_string(m.disciplinas, ', ') || ')' else '' end
              || case when m.perfil <> 'admin' then ' · obras: ' || coalesce(nullif(array_to_string(m.obras, ', '), ''), 'nenhuma') else '' end;
  end if;
  if antes is distinct from depois then
    insert into public.admin_log (por, alvo, acao, detalhe) values (lower(auth.jwt() ->> 'email'), e, 'perfil', antes || ' → ' || depois);
  end if;
end $$;
revoke all on function public.admin_definir_perfil(text, text, text[], text[]) from public, anon;
grant execute on function public.admin_definir_perfil(text, text, text[], text[]) to authenticated;

-- as funções antigas continuam funcionando (telas antigas ainda abertas)
create or replace function public.admin_definir_acesso(alvo text, novo_papel text, novo_admin boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare atual text;
begin
  select perfil into atual from public.membros where lower(email) = lower(trim(alvo));
  perform public.admin_definir_perfil(alvo,
    case when novo_papel = 'nenhum' then 'nenhum' when coalesce(novo_admin, false) then 'admin'
         when novo_papel = 'leitor' then case when atual = 'campo' then 'campo' else 'consulta' end
         else case when atual in ('engenharia', 'seguranca') then atual else 'engenharia' end end);
end $$;
create or replace function public.admin_definir_cargo(alvo text, novo_cargo text, novas_disciplinas text[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.membros where lower(email) = lower(trim(alvo))) then
    raise exception 'Libere o acesso desta pessoa antes de dar um perfil.';
  end if;
  perform public.admin_definir_perfil(alvo,
    case novo_cargo when 'engenharia' then 'engenharia' when 'seguranca' then 'seguranca' when 'encarregado' then 'campo' else 'consulta' end,
    case when novo_cargo = 'encarregado' then novas_disciplinas else null end, null);
end $$;

-- renomear um ofício também renomeia nos perfis e nos funcionários
create or replace function public.pend_renomear(p_obra text, p_campo text, p_de text, p_para text)
returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.eh_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  if coalesce(trim(p_para), '') = '' or p_de = p_para then return 0; end if;
  perform set_config('app.renomeando', '1', true);
  if p_campo in ('tipo', 'comodo', 'local_tipo', 'disciplina', 'pavimento') then
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
  values (lower(auth.jwt() ->> 'email'), coalesce(p_obra, 'padrão'), 'listas',
          case p_campo when 'disciplina' then 'ofício' else p_campo end || ': “' || p_de || '” → “' || p_para || '” (' || n || ' pendência(s))');
  return n;
end $$;

-- avisos ao vivo da lista de pessoas não são necessários; a lixeira dos mapas entra no backup pela função "usuarios"
$p14$;
  update public.banco_versao set versao = 14, atualizado_em = now();
  raise notice 'Passo 14 aplicado: Perfis, ofícios e acesso por obra';
end $passo$;


-- =====================================================================
-- Passo 15: Foto da obra para todos da obra
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 15 then return; end if;
  execute $p15$
-- a foto da obra (obras/<obra>/…) aparece na tela inicial de todos os perfis com acesso à obra,
-- inclusive Campo; enviar e apagar continua só com Administrador, Engenharia e Segurança
create or replace function public.arquivo_ok(p_nome text, p_editar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_nome, '/', 1) in ('risco', 'concretagem', 'fachada')
      then public.painel_ok(split_part(p_nome, '/', 1) || ':' || split_part(p_nome, '/', 2), p_editar)
    when split_part(p_nome, '/', 1) = 'obras'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and coalesce(public.perfil_atual() in ('admin', 'engenharia', 'seguranca') or (not p_editar and public.perfil_atual() is not null), false)
    when p_nome like 'pendencias/%/plantas/%'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and (not p_editar or public.ferramenta_ok('risco', true))
    when split_part(p_nome, '/', 1) = 'pendencias'
      then public.pend_visivel_id(split_part(p_nome, '/', 3))
           and (not p_editar or coalesce(public.perfil_atual() <> 'consulta', false))
    else false end
$$;
$p15$;
  update public.banco_versao set versao = 15, atualizado_em = now();
  raise notice 'Passo 15 aplicado: Foto da obra para todos da obra';
end $passo$;


-- =====================================================================
-- Passo 16: Segurança com ofício (técnico de segurança)
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 16 then return; end if;
  execute $p16$
-- quem é do perfil Segurança também pode ter ofícios (ex.: Técnico de segurança):
-- aparece na lista de funcionários para ser escolhido como responsável pela correção
-- e vê as pendências do seu ofício, além das de segurança
create or replace function public.membro_funcionarios(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(p_email));
  m public.membros;
  nm text;
  com_oficio boolean;
begin
  select * into m from public.membros where lower(email) = e;
  com_oficio := m.email is not null and m.perfil in ('campo', 'seguranca') and array_length(m.disciplinas, 1) > 0;
  update public.pend_funcionarios f set ativo = false
  where lower(f.email) = e and f.ativo
    and (not com_oficio or f.obra is null or not (f.obra = any(m.obras)));
  if not com_oficio then return; end if;
  select nullif(trim(nome), '') into nm from public.perfis where lower(email) = e;
  update public.pend_funcionarios f set cargos = m.disciplinas, ativo = true
  where lower(f.email) = e and f.obra = any(m.obras);
  insert into public.pend_funcionarios (obra, nome, cargos, email, ativo)
  select o, coalesce(nm, split_part(e, '@', 1)), m.disciplinas, e, true
  from unnest(m.obras) o
  where exists (select 1 from public.obras where id = o)
    and not exists (select 1 from public.pend_funcionarios f where lower(f.email) = e and f.obra = o);
end $$;
revoke all on function public.membro_funcionarios(text) from public, anon, authenticated;

create or replace function public.pend_ve(p_obra text, p_seg boolean, p_disc text, p_status text, p_por text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when not (m.perfil = 'admin' or p_obra = any(m.obras)) then false
      when m.perfil in ('admin', 'engenharia', 'consulta') then true
      when m.perfil = 'seguranca' then p_seg or lower(p_por) = lower(m.email)
                                       or (p_status <> 'avaliacao' and p_disc = any(m.disciplinas))
      when m.perfil = 'campo' then lower(p_por) = lower(m.email)
                                   or (p_status <> 'avaliacao' and p_disc = any(m.disciplinas))
      else false end
    from public.membros m where lower(m.email) = lower(auth.jwt() ->> 'email') limit 1), false)
$$;

-- refaz a lista de funcionários de quem já é da Segurança e tem ofício
do $x$ declare r record; begin
  for r in select email from public.membros where perfil = 'seguranca' and array_length(disciplinas, 1) > 0 loop
    perform public.membro_funcionarios(r.email);
  end loop;
end $x$;
$p16$;
  update public.banco_versao set versao = 16, atualizado_em = now();
  raise notice 'Passo 16 aplicado: Segurança com ofício';
end $passo$;

-- =====================================================================
-- Conferência final
-- =====================================================================
do $fim$ begin
  if not exists (select 1 from public.membros where perfil = 'admin') then
    raise warning 'Nenhum administrador. Troque SEU_EMAIL@exemplo.com no começo deste arquivo pelo seu e-mail e rode de novo.';
  end if;
  raise notice 'Banco na versão %.', (select versao from public.banco_versao);
end $fim$;
