-- =====================================================================
-- Atualização: nomes das pessoas e foto das obras
-- Rode este arquivo UMA vez em: Supabase > SQL Editor > New query
-- (só para quem já tinha o banco antes desta versão; instalações novas
--  usam só o supabase.sql). Pode rodar de novo sem problema.
-- =====================================================================

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
