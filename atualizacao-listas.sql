-- =====================================================================
-- Atualização: listas por obra (a partir do padrão da empresa) e
-- renomear itens atualizando as pendências que já usam o nome.
-- Rode UMA vez em: Supabase > SQL Editor (depois do atualizacao-tipologias.sql).
-- Pode rodar de novo sem problema.
-- =====================================================================

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
