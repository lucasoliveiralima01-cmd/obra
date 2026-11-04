-- =====================================================================
-- Atualização: painel de administração
-- Rode este arquivo UMA vez em: Supabase > SQL Editor > New query
-- Antes de rodar, troque SEU_EMAIL@exemplo.com (no fim) pelo seu e-mail.
-- Pode rodar de novo sem problema.
-- =====================================================================

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
where lower(email) = lower('SEU_EMAIL@exemplo.com');
