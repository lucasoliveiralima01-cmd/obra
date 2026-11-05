-- =====================================================================
-- Atualização: notificações das pendências (etapa 2)
-- Rode este arquivo UMA vez em: Supabase > SQL Editor > New query
-- (depois do atualizacao-pendencias.sql). Pode rodar de novo sem problema.
-- Depois rode também a linha "update public.push_config set segredo = ..."
-- que está no arquivo segredos-push.txt (ele não vai para o GitHub).
-- =====================================================================

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
