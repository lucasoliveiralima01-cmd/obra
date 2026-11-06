-- =====================================================================
-- Atualização: Mapa de Fachadas (avisos de quebra de cura)
-- Rode UMA vez em: Supabase > SQL Editor (depois do atualizacao-funcionarios.sql).
-- Pode rodar de novo sem problema.
--
-- As fachadas, camadas e aplicações ficam na tabela "registros" (painel
-- "fachada:<obra>") e as imagens das fachadas na pasta "fachada/<obra>" do
-- armazenamento: as regras de acesso que já existem valem para elas.
-- O aviso diário das áreas liberadas é feito pela função "notificar".
-- =====================================================================

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
