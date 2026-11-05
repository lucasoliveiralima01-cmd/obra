-- =====================================================================
-- Atualização: página de Administração (registro de atividade e mais
-- informações por pessoa). Rode UMA vez em: Supabase > SQL Editor
-- (depois do atualizacao-pendencias.sql e do atualizacao-push.sql).
-- Pode rodar de novo sem problema.
-- =====================================================================

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
