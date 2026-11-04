-- =====================================================================
-- Mapa de Risco — estrutura do banco no Supabase
-- Rode este arquivo inteiro uma vez em: Supabase > SQL Editor > New query
-- Antes de rodar, troque SEU_EMAIL@exemplo.com (no fim) pelo seu e-mail.
-- =====================================================================

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

-- Primeiro membro e administrador: você (troque o e-mail)
insert into public.membros (email, papel, admin) values ('SEU_EMAIL@exemplo.com', 'editor', true)
on conflict (email) do update set papel = excluded.papel, admin = true;

-- Depois disso, libere as outras pessoas pelo botão "Administração" do site.
-- (Ou aqui, rodando só a linha, com o e-mail certo:
--   insert into public.membros (email, papel) values ('colega@empresa.com', 'editor'); )