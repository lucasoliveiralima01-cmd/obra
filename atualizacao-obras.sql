-- =====================================================================
-- Atualização: cadastro de obras + várias ferramentas
-- Rode este arquivo UMA vez em: Supabase > SQL Editor > New query
-- (só para quem já tinha rodado o supabase.sql antes desta versão;
--  instalações novas usam só o supabase.sql).
-- Pode rodar de novo sem problema: nada é duplicado.
-- =====================================================================

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
