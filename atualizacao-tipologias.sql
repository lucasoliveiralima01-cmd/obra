-- =====================================================================
-- Atualização: preenchimento condicionado nas pendências
--   - locais por pavimento (cada pavimento oferece só os seus locais)
--   - cômodos por final de apartamento (tipologias)
-- Rode UMA vez em: Supabase > SQL Editor. Pode rodar de novo sem problema.
-- Depois as regras são editadas em Pendências > ⋯ > Listas.
-- =====================================================================

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
