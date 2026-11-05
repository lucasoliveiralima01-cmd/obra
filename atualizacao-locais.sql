-- =====================================================================
-- Atualização: locais da obra Start, responsáveis por cargo e
-- "Próprio ou Terceiro" nas pendências.
--   - cada pavimento da Start com os seus locais; Elevador e Fachada pedem o lado
--   - responsável pela correção vira o cargo (Alvenaria/Reboco → Pedreiro etc.),
--     atualizando as pendências e os encarregados que já existem
--   - pendências ganham "equipe" (próprio ou terceiro)
--   - plantas do IFC guardam a altura do pavimento (para ligar pela ordem)
-- Rode UMA vez em: Supabase > SQL Editor (depois do atualizacao-listas.sql).
-- Pode rodar de novo sem problema.
-- =====================================================================

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
