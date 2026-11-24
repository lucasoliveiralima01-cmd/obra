-- =====================================================================
-- Ferramentas da Obra · banco de dados (Supabase) · ATUALIZAÇÃO
--
-- Para atualizar: Supabase > SQL Editor > New query > cole o arquivo
-- inteiro > Run. Ele vê sozinho o que o seu banco já tem e aplica só o que
-- falta. Pode rodar quantas vezes quiser.
--
-- Banco NOVO (ou anterior ao passo 21): rode antes o banco-instalacao.sql
-- (a base, passos 1 a 21) e depois este.
--
-- Para uma mudança nova no banco: acrescente um passo no fim (antes da
-- "Conferência final"), no mesmo formato dos outros, com o número seguinte,
-- e atualize BANCO_ESPERADO no admin.html.
-- =====================================================================
do $confere$ begin
  if to_regclass('public.banco_versao') is null then
    raise exception 'Banco sem a base. Rode antes o arquivo banco-instalacao.sql e depois este.';
  end if;
  if coalesce((select versao from public.banco_versao), 0) < 21 then
    raise exception 'Banco na versão %: rode antes o arquivo banco-instalacao.sql e depois este.', (select versao from public.banco_versao);
  end if;
end $confere$;

-- =====================================================================
-- Passo 22: Almoxarifado (estoque geral de materiais com QR Code e código de barras)
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 22 then return; end if;
  execute $p22$
-- ---------------------------------------------------------------------
-- 1. Quem vê / quem movimenta / quem corrige (mesmos perfis das Cerâmicas)
-- ---------------------------------------------------------------------
create or replace function public.alm_ve(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() in ('admin', 'engenharia', 'consulta', 'almoxarifado'), false)
$$;
create or replace function public.alm_estoque(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() in ('admin', 'engenharia', 'almoxarifado'), false)
$$;
create or replace function public.alm_edita(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() in ('admin', 'engenharia'), false)
$$;
grant execute on function public.alm_ve(text), public.alm_estoque(text), public.alm_edita(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------
-- material: cada um ganha um código do sistema (M0001...), que vai no QR Code da etiqueta
create table if not exists public.alm_materiais (
  id          uuid primary key default gen_random_uuid(),
  obra        text not null references public.obras(id) on delete cascade,
  codigo      text not null,                 -- M0001 (gerado pelo banco)
  nome        text not null,                 -- Caixa elétrica 4x2 amarela
  unidade     text not null default 'un',    -- un, cx, pç, m, m², kg, saco, rolo, L...
  categoria   text,                          -- Elétrica, Hidráulica, Ferragens, EPI...
  minimo      numeric check (minimo is null or minimo >= 0),   -- avisa quando o saldo fica abaixo
  posicao     text,                          -- prateleira / onde fica no almoxarifado
  obs         text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  text
);
create unique index if not exists alm_materiais_codigo on public.alm_materiais (obra, codigo);
create index if not exists alm_materiais_obra on public.alm_materiais (obra);

-- códigos de barras ligados a um material (um material pode ter vários: fornecedores diferentes,
-- unidade e caixa fechada). fator = quanto do material uma leitura representa (caixa com 50 = 50)
create table if not exists public.alm_codigos (
  id          uuid primary key default gen_random_uuid(),
  obra        text not null references public.obras(id) on delete cascade,
  material    uuid not null references public.alm_materiais(id) on delete cascade,
  codigo      text not null,
  fator       numeric not null default 1 check (fator > 0),
  criado_em   timestamptz not null default now()
);
create unique index if not exists alm_codigos_codigo on public.alm_codigos (obra, codigo);
create index if not exists alm_codigos_material on public.alm_codigos (material);

-- quem retira e não é funcionário cadastrado (terceirizados, empreiteiros, visitantes...)
create table if not exists public.alm_pessoas (
  id          uuid primary key default gen_random_uuid(),
  obra        text not null references public.obras(id) on delete cascade,
  nome        text not null,
  empresa     text,                          -- empreiteira / empresa terceirizada
  telefone    text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  text
);
create index if not exists alm_pessoas_obra on public.alm_pessoas (obra);

-- movimentos (entrada = recebimento; saida = entrega; devolucao; perda; ajuste = contagem, + ou -)
create table if not exists public.alm_movs (
  id          uuid primary key default gen_random_uuid(),
  obra        text not null references public.obras(id) on delete cascade,
  material    uuid not null references public.alm_materiais(id) on delete cascade,
  tipo        text not null check (tipo in ('entrada', 'saida', 'devolucao', 'perda', 'ajuste')),
  qtd         numeric not null,
  funcionario uuid references public.pend_funcionarios(id) on delete set null,
  pessoa      uuid references public.alm_pessoas(id) on delete set null,
  pessoa_nome text,                          -- o nome e a empresa ficam guardados mesmo se o cadastro mudar
  empresa     text,
  pavimento   text,                          -- destino (opcional)
  local       text,
  fornecedor  text,                          -- entrada
  nf          text,
  lote        text,
  validade    date,
  foto        text,                          -- foto da nota / do material
  obs         text,
  em          timestamptz not null default now(),
  por         text
);
create index if not exists alm_movs_obra on public.alm_movs (obra, em desc);
create index if not exists alm_movs_material on public.alm_movs (material);

alter table public.alm_materiais enable row level security;
alter table public.alm_codigos enable row level security;
alter table public.alm_pessoas enable row level security;
alter table public.alm_movs enable row level security;

drop policy if exists "ve alm_materiais" on public.alm_materiais;
drop policy if exists "cria alm_materiais" on public.alm_materiais;
drop policy if exists "edita alm_materiais" on public.alm_materiais;
drop policy if exists "apaga alm_materiais" on public.alm_materiais;
create policy "ve alm_materiais" on public.alm_materiais for select to authenticated using (public.alm_ve(obra));
create policy "cria alm_materiais" on public.alm_materiais for insert to authenticated with check (public.alm_estoque(obra));
create policy "edita alm_materiais" on public.alm_materiais for update to authenticated using (public.alm_estoque(obra)) with check (public.alm_estoque(obra));
create policy "apaga alm_materiais" on public.alm_materiais for delete to authenticated using (public.alm_edita(obra));

drop policy if exists "ve alm_codigos" on public.alm_codigos;
drop policy if exists "grava alm_codigos" on public.alm_codigos;
create policy "ve alm_codigos" on public.alm_codigos for select to authenticated using (public.alm_ve(obra));
create policy "grava alm_codigos" on public.alm_codigos for all to authenticated using (public.alm_estoque(obra)) with check (public.alm_estoque(obra));

drop policy if exists "ve alm_pessoas" on public.alm_pessoas;
drop policy if exists "grava alm_pessoas" on public.alm_pessoas;
create policy "ve alm_pessoas" on public.alm_pessoas for select to authenticated using (public.alm_ve(obra));
create policy "grava alm_pessoas" on public.alm_pessoas for all to authenticated using (public.alm_estoque(obra)) with check (public.alm_estoque(obra));

-- movimento: quem cuida do estoque registra; corrigir/apagar: a Engenharia, ou quem registrou (em 24 h)
drop policy if exists "ve alm_movs" on public.alm_movs;
drop policy if exists "cria alm_movs" on public.alm_movs;
drop policy if exists "edita alm_movs" on public.alm_movs;
drop policy if exists "apaga alm_movs" on public.alm_movs;
create policy "ve alm_movs" on public.alm_movs for select to authenticated using (public.alm_ve(obra));
create policy "cria alm_movs" on public.alm_movs for insert to authenticated with check (public.alm_estoque(obra));
create policy "edita alm_movs" on public.alm_movs for update to authenticated using (public.alm_edita(obra)) with check (public.alm_edita(obra));
create policy "apaga alm_movs" on public.alm_movs for delete to authenticated
  using (public.alm_edita(obra) or (public.alm_estoque(obra) and lower(por) = lower(auth.jwt() ->> 'email') and em > now() - interval '24 hours'));

-- ---------------------------------------------------------------------
-- 3. Saldo e regras
-- ---------------------------------------------------------------------
create or replace function public.alm_saldo(p_material uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when tipo in ('entrada', 'devolucao', 'ajuste') then qtd else -qtd end), 0)
  from public.alm_movs where material = p_material
$$;
grant execute on function public.alm_saldo(uuid) to authenticated;

-- material: código do sistema em sequência por obra (M0001, M0002...)
create or replace function public.alm_material_ao_gravar() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  new.nome := trim(coalesce(new.nome, ''));
  if new.nome = '' then raise exception 'Informe o nome do material.'; end if;
  new.unidade := coalesce(nullif(trim(coalesce(new.unidade, '')), ''), 'un');
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('alm_codigo:' || new.obra));
    select coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1 into n
      from public.alm_materiais where obra = new.obra and codigo ~ '^M\d+$';
    new.codigo := 'M' || lpad(n::text, 4, '0');
    new.criado_por := lower(coalesce(auth.jwt() ->> 'email', new.criado_por)); new.criado_em := now();
  else
    new.obra := old.obra; new.codigo := old.codigo; new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  end if;
  return new;
end $$;
drop trigger if exists alm_material_ao_gravar on public.alm_materiais;
create trigger alm_material_ao_gravar before insert or update on public.alm_materiais for each row execute function public.alm_material_ao_gravar();

create or replace function public.alm_codigo_ao_gravar() returns trigger
language plpgsql security definer set search_path = public as $$
declare outro text;
begin
  new.codigo := trim(coalesce(new.codigo, ''));
  if new.codigo = '' then raise exception 'Código de barras vazio.'; end if;
  select obra into new.obra from public.alm_materiais where id = new.material;
  select m.nome into outro from public.alm_codigos c join public.alm_materiais m on m.id = c.material
   where c.obra = new.obra and c.codigo = new.codigo and c.id <> new.id;
  if outro is not null then raise exception 'O código % já está ligado a: %.', new.codigo, outro; end if;
  return new;
end $$;
drop trigger if exists alm_codigo_ao_gravar on public.alm_codigos;
create trigger alm_codigo_ao_gravar before insert or update on public.alm_codigos for each row execute function public.alm_codigo_ao_gravar();

create or replace function public.alm_pessoa_ao_gravar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nome := trim(coalesce(new.nome, '')); new.empresa := nullif(trim(coalesce(new.empresa, '')), '');
  if new.nome = '' then raise exception 'Informe o nome da pessoa.'; end if;
  if tg_op = 'INSERT' then new.criado_por := lower(coalesce(auth.jwt() ->> 'email', new.criado_por));
  else new.obra := old.obra; new.criado_por := old.criado_por; end if;
  return new;
end $$;
drop trigger if exists alm_pessoa_ao_gravar on public.alm_pessoas;
create trigger alm_pessoa_ao_gravar before insert or update on public.alm_pessoas for each row execute function public.alm_pessoa_ao_gravar();

-- movimento: autoria, obra do material, nome/empresa de quem retirou e saldo nunca negativo
create or replace function public.alm_mov_ao_gravar() returns trigger
language plpgsql security definer set search_path = public as $$
declare s numeric; d numeric; un text; nm text; st text; f record; p record;
begin
  perform 1 from public.alm_materiais where id = new.material for update;
  select obra, unidade, nome into new.obra, un, nm from public.alm_materiais where id = new.material;
  if new.tipo = 'ajuste' then
    if new.qtd = 0 then raise exception 'O ajuste não muda nada (diferença zero).'; end if;
  elsif new.qtd is null or new.qtd <= 0 then raise exception 'Informe a quantidade.'; end if;
  if tg_op = 'INSERT' then
    new.por := lower(coalesce(auth.jwt() ->> 'email', new.por)); new.em := now();
    s := public.alm_saldo(new.material);
  else
    new.por := old.por; new.em := old.em;
    s := public.alm_saldo(new.material) - case when old.tipo in ('entrada', 'devolucao', 'ajuste') then old.qtd else -old.qtd end;
  end if;
  d := case when new.tipo in ('entrada', 'devolucao', 'ajuste') then new.qtd else -new.qtd end;
  if s + d < 0 then
    st := round(s, 3)::text;
    if position('.' in st) > 0 then st := rtrim(rtrim(st, '0'), '.'); end if;
    raise exception 'Saldo insuficiente: há só % % de %.', st, un, nm;
  end if;
  if new.tipo = 'saida' and new.funcionario is null and new.pessoa is null and coalesce(trim(new.pessoa_nome), '') = '' then
    raise exception 'Diga para quem é a entrega.';
  end if;
  if new.funcionario is not null then
    select nome, equipe into f from public.pend_funcionarios where id = new.funcionario;
    new.pessoa_nome := coalesce(nullif(trim(coalesce(new.pessoa_nome, '')), ''), f.nome);
  elsif new.pessoa is not null then
    select nome, empresa into p from public.alm_pessoas where id = new.pessoa;
    new.pessoa_nome := coalesce(nullif(trim(coalesce(new.pessoa_nome, '')), ''), p.nome);
    new.empresa := coalesce(nullif(trim(coalesce(new.empresa, '')), ''), p.empresa);
  end if;
  return new;
end $$;
drop trigger if exists alm_mov_ao_gravar on public.alm_movs;
create trigger alm_mov_ao_gravar before insert or update on public.alm_movs for each row execute function public.alm_mov_ao_gravar();

-- resumo por obra para a página inicial (as regras de acesso valem: security invoker)
create or replace function public.alm_resumo() returns table (obra text, materiais int, com_saldo int, abaixo int)
language sql stable set search_path = public as $$
  select m.obra, count(*)::int,
         count(*) filter (where coalesce(s.v, 0) > 0)::int,
         count(*) filter (where m.minimo is not null and coalesce(s.v, 0) < m.minimo)::int
  from public.alm_materiais m
  left join (select material, sum(case when tipo in ('entrada', 'devolucao', 'ajuste') then qtd else -qtd end) v from public.alm_movs group by material) s on s.material = m.id
  where m.ativo
  group by m.obra
$$;
grant execute on function public.alm_resumo() to authenticated;

-- tempo real
do $x$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'alm_movs') then
      alter publication supabase_realtime add table public.alm_movs; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'alm_materiais') then
      alter publication supabase_realtime add table public.alm_materiais; end if;
  end if;
end $x$;

-- ---------------------------------------------------------------------
-- 4. Arquivos: almoxarifado/<obra>/… (foto da nota ou do material)
-- ---------------------------------------------------------------------
create or replace function public.arquivo_ok(p_nome text, p_editar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_nome, '/', 1) in ('risco', 'concretagem', 'fachada')
      then public.painel_ok(split_part(p_nome, '/', 1) || ':' || split_part(p_nome, '/', 2), p_editar)
    when split_part(p_nome, '/', 1) = 'obras'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and coalesce(public.perfil_atual() in ('admin', 'engenharia', 'seguranca') or (not p_editar and public.perfil_atual() is not null), false)
    when p_nome like 'pendencias/%/plantas/%'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and (not p_editar or public.ferramenta_ok('risco', true))
    when split_part(p_nome, '/', 1) = 'pendencias'
      then public.pend_visivel_id(split_part(p_nome, '/', 3))
           and (not p_editar or coalesce(public.perfil_atual() <> 'consulta', false))
    when split_part(p_nome, '/', 1) = 'personalizacoes'
      then case when p_editar then public.pers_edita(split_part(p_nome, '/', 2))
                else public.pers_edita(split_part(p_nome, '/', 2)) or public.pers_visivel_id(split_part(p_nome, '/', 3)) end
    when split_part(p_nome, '/', 1) = 'ceramicas'
      then case when p_editar then public.cer_estoque(split_part(p_nome, '/', 2)) else public.cer_ve(split_part(p_nome, '/', 2)) end
    when split_part(p_nome, '/', 1) = 'almoxarifado'
      then case when p_editar then public.alm_estoque(split_part(p_nome, '/', 2)) else public.alm_ve(split_part(p_nome, '/', 2)) end
    else false end
$$;

$p22$;
  update public.banco_versao set versao = 22, atualizado_em = now();
  raise notice 'Passo 22 aplicado: Almoxarifado (estoque geral com QR Code e código de barras)';
end $passo$;

-- =====================================================================
-- Passo 23: Planejamento (médio prazo e PCP lidos do PDF, histórico, ligação com as frentes)
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 23 then return; end if;
  execute $p23$
-- ---------------------------------------------------------------------
-- 1. Quem vê (todos os perfis com acesso à obra) e quem importa (Administrador e Engenharia)
-- ---------------------------------------------------------------------
create or replace function public.plan_ve(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and public.perfil_atual() is not null
$$;
create or replace function public.plan_edita(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() in ('admin', 'engenharia'), false)
$$;
grant execute on function public.plan_ve(text), public.plan_edita(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------
-- cada PDF importado (médio prazo ou PCP) vira uma versão; o PDF fica guardado
create table if not exists public.plan_versoes (
  id          uuid primary key default gen_random_uuid(),
  obra        text not null references public.obras(id) on delete cascade,
  tipo        text not null check (tipo in ('mp', 'pcp')),
  referencia  date,            -- médio prazo: data da reunião; PCP: 1º dia da semana
  proxima     date,            -- médio prazo: próxima reunião; PCP: último dia da semana
  titulo      text,
  arquivo     text,            -- planejamento/<obra>/<id>.pdf
  n_linhas    int not null default 0,
  resumo      jsonb not null default '{}',   -- o que mudou em relação à versão anterior
  avisos      jsonb not null default '[]',   -- erros e pontos de atenção encontrados no planejamento
  notas       jsonb not null default '[]',   -- avisos amarelos de cada disciplina [{grupo, texto}]
  gerais      jsonb not null default '[]',   -- avisos gerais (texto)
  criado_em   timestamptz not null default now(),
  criado_por  text
);
create index if not exists plan_versoes_obra on public.plan_versoes (obra, tipo, criado_em desc);

-- atividade do médio prazo. A "chave" (disciplina + atividade + local) liga a mesma atividade entre versões.
create table if not exists public.plan_atividades (
  id          uuid primary key default gen_random_uuid(),
  obra        text not null references public.obras(id) on delete cascade,
  chave       text not null,
  grupo       text,
  atividade   text not null,
  local       text,
  equipe      text,
  servico     text,                          -- serviço das Listas (liga às frentes e às modificações)
  pavimentos  text[] not null default '{}',  -- pavimentos da obra que o "local" representa
  inicio      date,
  termino     date,
  concluida   boolean not null default false,
  ativa       boolean not null default true, -- false: saiu do planejamento
  ajuste      text,                          -- correção feita à mão na importação
  versao      uuid references public.plan_versoes(id) on delete set null,
  n_mudancas  int not null default 0,        -- quantas vezes as datas mudaram (reprogramações)
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists plan_atividades_chave on public.plan_atividades (obra, chave);

-- histórico: como cada atividade estava em cada versão
create table if not exists public.plan_hist (
  id          bigserial primary key,
  obra        text not null references public.obras(id) on delete cascade,
  atividade   uuid not null references public.plan_atividades(id) on delete cascade,
  versao      uuid not null references public.plan_versoes(id) on delete cascade,
  inicio      date,
  termino     date,
  concluida   boolean not null default false,
  ativa       boolean not null default true,
  ajuste      text
);
create index if not exists plan_hist_atividade on public.plan_hist (atividade);
create index if not exists plan_hist_obra on public.plan_hist (obra);

-- o que a Engenharia já ligou à mão: atividade → serviço, local → pavimentos (vale para as próximas versões)
create table if not exists public.plan_mapa (
  obra        text not null references public.obras(id) on delete cascade,
  tipo        text not null check (tipo in ('servico', 'local')),
  origem      text not null,
  destino     jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (obra, tipo, origem)
);

-- itens do PCP (plano semanal)
create table if not exists public.plan_pcp (
  id          uuid primary key default gen_random_uuid(),
  obra        text not null references public.obras(id) on delete cascade,
  versao      uuid not null references public.plan_versoes(id) on delete cascade,
  ordem       int not null default 0,
  frente      text,
  empresa     text,
  pessoas     text,
  item        int,
  texto       text not null,
  dias        smallint[] not null default '{}',   -- 0 = 2ª … 5 = sábado
  ok          text,
  motivo      text,
  atividade   uuid references public.plan_atividades(id) on delete set null,  -- ligação feita à mão
  ligado      text not null default 'auto' check (ligado in ('auto', 'manual', 'nenhum'))
);
create index if not exists plan_pcp_versao on public.plan_pcp (versao);

alter table public.plan_versoes enable row level security;
alter table public.plan_atividades enable row level security;
alter table public.plan_hist enable row level security;
alter table public.plan_mapa enable row level security;
alter table public.plan_pcp enable row level security;

drop policy if exists "ve plan_versoes" on public.plan_versoes;
drop policy if exists "ve plan_atividades" on public.plan_atividades;
drop policy if exists "ve plan_hist" on public.plan_hist;
drop policy if exists "ve plan_mapa" on public.plan_mapa;
drop policy if exists "grava plan_mapa" on public.plan_mapa;
drop policy if exists "ve plan_pcp" on public.plan_pcp;
drop policy if exists "liga plan_pcp" on public.plan_pcp;
create policy "ve plan_versoes" on public.plan_versoes for select to authenticated using (public.plan_ve(obra));
create policy "ve plan_atividades" on public.plan_atividades for select to authenticated using (public.plan_ve(obra));
create policy "ve plan_hist" on public.plan_hist for select to authenticated using (public.plan_ve(obra));
create policy "ve plan_mapa" on public.plan_mapa for select to authenticated using (public.plan_ve(obra));
create policy "grava plan_mapa" on public.plan_mapa for all to authenticated using (public.plan_edita(obra)) with check (public.plan_edita(obra));
create policy "ve plan_pcp" on public.plan_pcp for select to authenticated using (public.plan_ve(obra));
create policy "liga plan_pcp" on public.plan_pcp for update to authenticated using (public.plan_edita(obra)) with check (public.plan_edita(obra));
-- versões e atividades só mudam pela importação (funções abaixo)

-- ---------------------------------------------------------------------
-- 3. Importar o médio prazo (tudo ou nada)
--    p_versao: {titulo, referencia, proxima, arquivo, resumo, avisos, notas, gerais}
--    p_linhas: [{chave, grupo, atividade, local, equipe, servico, pavimentos[], inicio, termino, concluida, ajuste}]
--    Atividade que já existia: atualiza e conta reprogramação se a data mudou. A que sumiu: fica inativa.
--    As frentes (serviço × pavimento) recebem a data prevista do planejamento.
-- ---------------------------------------------------------------------
create or replace function public.plan_importar_mp(p_obra text, p_versao jsonb, p_linhas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; l jsonb; atv public.plan_atividades; novo_ini date; novo_fim date; nid uuid; vistos uuid[] := '{}';
  quem text := lower(auth.jwt() ->> 'email');
begin
  if not public.plan_edita(p_obra) then raise exception 'Só a Engenharia importa o planejamento.' using errcode = '42501'; end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then raise exception 'O PDF não tem atividades.'; end if;
  insert into public.plan_versoes (obra, tipo, referencia, proxima, titulo, arquivo, n_linhas, resumo, avisos, notas, gerais, criado_por)
  values (p_obra, 'mp', nullif(p_versao ->> 'referencia', '')::date, nullif(p_versao ->> 'proxima', '')::date, p_versao ->> 'titulo', p_versao ->> 'arquivo',
          jsonb_array_length(p_linhas), coalesce(p_versao -> 'resumo', '{}'), coalesce(p_versao -> 'avisos', '[]'), coalesce(p_versao -> 'notas', '[]'), coalesce(p_versao -> 'gerais', '[]'), quem)
  returning id into v;
  for l in select * from jsonb_array_elements(p_linhas) loop
    novo_ini := nullif(l ->> 'inicio', '')::date; novo_fim := nullif(l ->> 'termino', '')::date;
    select * into atv from public.plan_atividades where obra = p_obra and chave = l ->> 'chave';
    if found then
      update public.plan_atividades set grupo = l ->> 'grupo', atividade = l ->> 'atividade', local = l ->> 'local', equipe = l ->> 'equipe',
        servico = nullif(l ->> 'servico', ''), pavimentos = coalesce(array(select jsonb_array_elements_text(l -> 'pavimentos')), '{}'),
        inicio = novo_ini, termino = novo_fim, concluida = coalesce((l ->> 'concluida')::boolean, false), ativa = true, ajuste = nullif(l ->> 'ajuste', ''), versao = v,
        n_mudancas = atv.n_mudancas + case when (atv.inicio is distinct from novo_ini or atv.termino is distinct from novo_fim) and atv.ativa then 1 else 0 end,
        atualizado_em = now()
      where id = atv.id;
      nid := atv.id;
    else
      insert into public.plan_atividades (obra, chave, grupo, atividade, local, equipe, servico, pavimentos, inicio, termino, concluida, ajuste, versao)
      values (p_obra, l ->> 'chave', l ->> 'grupo', l ->> 'atividade', l ->> 'local', l ->> 'equipe', nullif(l ->> 'servico', ''),
              coalesce(array(select jsonb_array_elements_text(l -> 'pavimentos')), '{}'), novo_ini, novo_fim, coalesce((l ->> 'concluida')::boolean, false), nullif(l ->> 'ajuste', ''), v)
      returning id into nid;
    end if;
    vistos := vistos || nid;
    insert into public.plan_hist (obra, atividade, versao, inicio, termino, concluida, ativa, ajuste)
    values (p_obra, nid, v, novo_ini, novo_fim, coalesce((l ->> 'concluida')::boolean, false), true, nullif(l ->> 'ajuste', ''));
  end loop;
  -- as que saíram do planejamento
  insert into public.plan_hist (obra, atividade, versao, inicio, termino, concluida, ativa)
    select obra, id, v, inicio, termino, concluida, false from public.plan_atividades where obra = p_obra and ativa and not (id = any(vistos));
  update public.plan_atividades set ativa = false, atualizado_em = now() where obra = p_obra and ativa and not (id = any(vistos));
  -- frentes: data prevista = 1º início planejado (ainda não concluído) de cada serviço × pavimento
  insert into public.frentes (obra, servico, pavimento, previsto, atualizado_em)
    select p_obra, a.servico, p.pav, min(coalesce(a.inicio, a.termino)), now()
    from public.plan_atividades a cross join lateral unnest(a.pavimentos) p(pav)
    where a.obra = p_obra and a.ativa and not a.concluida and a.servico is not null and coalesce(a.inicio, a.termino) is not null
    group by a.servico, p.pav
  on conflict (obra, servico, pavimento) do update set previsto = excluded.previsto, atualizado_em = now()
    where public.frentes.liberada_em is null and public.frentes.previsto is distinct from excluded.previsto;
  return v;
end $$;
revoke all on function public.plan_importar_mp(text, jsonb, jsonb) from public, anon;
grant execute on function public.plan_importar_mp(text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Importar o PCP (uma versão por PDF; vale a mais nova de cada semana)
--    p_itens: [{ordem, frente, empresa, pessoas, item, texto, dias[], ok, motivo}]
-- ---------------------------------------------------------------------
create or replace function public.plan_importar_pcp(p_obra text, p_versao jsonb, p_itens jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; quem text := lower(auth.jwt() ->> 'email');
begin
  if not public.plan_edita(p_obra) then raise exception 'Só a Engenharia importa o planejamento.' using errcode = '42501'; end if;
  if nullif(p_versao ->> 'referencia', '') is null then raise exception 'Falta a semana do PCP.'; end if;
  insert into public.plan_versoes (obra, tipo, referencia, proxima, titulo, arquivo, n_linhas, resumo, criado_por)
  values (p_obra, 'pcp', (p_versao ->> 'referencia')::date, nullif(p_versao ->> 'proxima', '')::date, p_versao ->> 'titulo', p_versao ->> 'arquivo',
          jsonb_array_length(coalesce(p_itens, '[]')), coalesce(p_versao -> 'resumo', '{}'), quem)
  returning id into v;
  insert into public.plan_pcp (obra, versao, ordem, frente, empresa, pessoas, item, texto, dias, ok, motivo)
    select p_obra, v, coalesce((i ->> 'ordem')::int, 0), i ->> 'frente', i ->> 'empresa', i ->> 'pessoas', (i ->> 'item')::int, i ->> 'texto',
           coalesce(array(select jsonb_array_elements_text(i -> 'dias'))::smallint[], '{}'), nullif(i ->> 'ok', ''), nullif(i ->> 'motivo', '')
    from jsonb_array_elements(coalesce(p_itens, '[]')) i where coalesce(i ->> 'texto', '') <> '';
  return v;
end $$;
revoke all on function public.plan_importar_pcp(text, jsonb, jsonb) from public, anon;
grant execute on function public.plan_importar_pcp(text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Resumo para a página inicial (por obra)
-- ---------------------------------------------------------------------
create or replace function public.plan_resumo() returns table (obra text, ativas int, atrasadas int, semana int, erros int)
language sql stable security invoker set search_path = public as $$
  select a.obra, count(*)::int,
    count(*) filter (where not a.concluida and a.termino < current_date)::int,
    count(*) filter (where not a.concluida and a.inicio between date_trunc('week', current_date)::date and date_trunc('week', current_date)::date + 5)::int,
    coalesce((select count(*)::int from jsonb_array_elements(v.avisos) x where x ->> 'nivel' = 'erro'), 0)
  from public.plan_atividades a
  left join lateral (select avisos from public.plan_versoes where obra = a.obra and tipo = 'mp' order by criado_em desc limit 1) v on true
  where a.ativa
  group by a.obra, v.avisos
$$;
grant execute on function public.plan_resumo() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Arquivos: planejamento/<obra>/… (o PDF de cada versão)
-- ---------------------------------------------------------------------
create or replace function public.arquivo_ok(p_nome text, p_editar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_nome, '/', 1) in ('risco', 'concretagem', 'fachada')
      then public.painel_ok(split_part(p_nome, '/', 1) || ':' || split_part(p_nome, '/', 2), p_editar)
    when split_part(p_nome, '/', 1) = 'obras'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and coalesce(public.perfil_atual() in ('admin', 'engenharia', 'seguranca') or (not p_editar and public.perfil_atual() is not null), false)
    when p_nome like 'pendencias/%/plantas/%'
      then public.obra_ok(split_part(p_nome, '/', 2))
           and (not p_editar or public.ferramenta_ok('risco', true))
    when split_part(p_nome, '/', 1) = 'pendencias'
      then public.pend_visivel_id(split_part(p_nome, '/', 3))
           and (not p_editar or coalesce(public.perfil_atual() <> 'consulta', false))
    when split_part(p_nome, '/', 1) = 'personalizacoes'
      then case when p_editar then public.pers_edita(split_part(p_nome, '/', 2))
                else public.pers_edita(split_part(p_nome, '/', 2)) or public.pers_visivel_id(split_part(p_nome, '/', 3)) end
    when split_part(p_nome, '/', 1) = 'ceramicas'
      then case when p_editar then public.cer_estoque(split_part(p_nome, '/', 2)) else public.cer_ve(split_part(p_nome, '/', 2)) end
    when split_part(p_nome, '/', 1) = 'almoxarifado'
      then case when p_editar then public.alm_estoque(split_part(p_nome, '/', 2)) else public.alm_ve(split_part(p_nome, '/', 2)) end
    when split_part(p_nome, '/', 1) = 'planejamento'
      then case when p_editar then public.plan_edita(split_part(p_nome, '/', 2)) else public.plan_ve(split_part(p_nome, '/', 2)) end
    else false end
$$;

$p23$;
  update public.banco_versao set versao = 23, atualizado_em = now();
  raise notice 'Passo 23 aplicado: Planejamento (médio prazo e PCP)';
end $passo$;

-- =====================================================================
-- Passo 24: Planejamento: concluir no app, corrigir datas, desfazer importação e zerar
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 24 then return; end if;
  execute $p24$
-- concluída no app (vale mesmo que o PDF seguinte ainda não traga como concluída)
alter table public.plan_atividades add column if not exists concluida_app boolean not null default false;
alter table public.plan_atividades add column if not exists concluida_em timestamptz;
alter table public.plan_atividades add column if not exists concluida_por text;
-- data corrigida no app: {pdf_inicio, pdf_termino, inicio, termino}. Volta a valer enquanto o PDF trouxer a mesma data errada
alter table public.plan_atividades add column if not exists correcao jsonb;
-- "está certo": aviso do planejamento que a Engenharia conferiu (origem = chave|texto do aviso)
alter table public.plan_mapa drop constraint if exists plan_mapa_tipo_check;
alter table public.plan_mapa add constraint plan_mapa_tipo_check check (tipo in ('servico', 'local', 'aviso'));

-- importar: igual ao passo 23, respeitando o que foi concluído e corrigido no app
create or replace function public.plan_importar_mp(p_obra text, p_versao jsonb, p_linhas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; l jsonb; atv public.plan_atividades; novo_ini date; novo_fim date; nid uuid; vistos uuid[] := '{}'; conc boolean;
  quem text := lower(auth.jwt() ->> 'email');
begin
  if not public.plan_edita(p_obra) then raise exception 'Só a Engenharia importa o planejamento.' using errcode = '42501'; end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then raise exception 'O PDF não tem atividades.'; end if;
  insert into public.plan_versoes (obra, tipo, referencia, proxima, titulo, arquivo, n_linhas, resumo, avisos, notas, gerais, criado_por)
  values (p_obra, 'mp', nullif(p_versao ->> 'referencia', '')::date, nullif(p_versao ->> 'proxima', '')::date, p_versao ->> 'titulo', p_versao ->> 'arquivo',
          jsonb_array_length(p_linhas), coalesce(p_versao -> 'resumo', '{}'), coalesce(p_versao -> 'avisos', '[]'), coalesce(p_versao -> 'notas', '[]'), coalesce(p_versao -> 'gerais', '[]'), quem)
  returning id into v;
  for l in select * from jsonb_array_elements(p_linhas) loop
    novo_ini := nullif(l ->> 'inicio', '')::date; novo_fim := nullif(l ->> 'termino', '')::date;
    select * into atv from public.plan_atividades where obra = p_obra and chave = l ->> 'chave';
    if found then
      conc := coalesce((l ->> 'concluida')::boolean, false) or atv.concluida_app;
      update public.plan_atividades set grupo = l ->> 'grupo', atividade = l ->> 'atividade', local = l ->> 'local', equipe = l ->> 'equipe',
        servico = nullif(l ->> 'servico', ''), pavimentos = coalesce(array(select jsonb_array_elements_text(l -> 'pavimentos')), '{}'),
        inicio = novo_ini, termino = novo_fim, concluida = conc, ativa = true, ajuste = nullif(l ->> 'ajuste', ''), correcao = case when l ? 'correcao' then nullif(l -> 'correcao', 'null') else null end, versao = v,
        n_mudancas = atv.n_mudancas + case when (atv.inicio is distinct from novo_ini or atv.termino is distinct from novo_fim) and atv.ativa then 1 else 0 end,
        atualizado_em = now()
      where id = atv.id;
      nid := atv.id;
    else
      conc := coalesce((l ->> 'concluida')::boolean, false);
      insert into public.plan_atividades (obra, chave, grupo, atividade, local, equipe, servico, pavimentos, inicio, termino, concluida, ajuste, correcao, versao)
      values (p_obra, l ->> 'chave', l ->> 'grupo', l ->> 'atividade', l ->> 'local', l ->> 'equipe', nullif(l ->> 'servico', ''),
              coalesce(array(select jsonb_array_elements_text(l -> 'pavimentos')), '{}'), novo_ini, novo_fim, conc, nullif(l ->> 'ajuste', ''), case when l ? 'correcao' then nullif(l -> 'correcao', 'null') else null end, v)
      returning id into nid;
    end if;
    vistos := vistos || nid;
    insert into public.plan_hist (obra, atividade, versao, inicio, termino, concluida, ativa, ajuste)
    values (p_obra, nid, v, novo_ini, novo_fim, conc, true, nullif(l ->> 'ajuste', ''));
  end loop;
  insert into public.plan_hist (obra, atividade, versao, inicio, termino, concluida, ativa)
    select obra, id, v, inicio, termino, concluida, false from public.plan_atividades where obra = p_obra and ativa and not (id = any(vistos));
  update public.plan_atividades set ativa = false, atualizado_em = now() where obra = p_obra and ativa and not (id = any(vistos));
  perform public.plan_frentes(p_obra);
  return v;
end $$;

-- frentes: data prevista = 1º início planejado (ainda não concluído) de cada serviço × pavimento
create or replace function public.plan_frentes(p_obra text) returns void
language sql security definer set search_path = public as $$
  insert into public.frentes (obra, servico, pavimento, previsto, atualizado_em)
    select p_obra, a.servico, p.pav, min(coalesce(a.inicio, a.termino)), now()
    from public.plan_atividades a cross join lateral unnest(a.pavimentos) p(pav)
    where a.obra = p_obra and a.ativa and not a.concluida and a.servico is not null and coalesce(a.inicio, a.termino) is not null
    group by a.servico, p.pav
  on conflict (obra, servico, pavimento) do update set previsto = excluded.previsto, atualizado_em = now()
    where public.frentes.liberada_em is null and public.frentes.previsto is distinct from excluded.previsto
$$;
revoke all on function public.plan_frentes(text) from public, anon, authenticated;

-- marcar (ou desmarcar) uma atividade como concluída
create or replace function public.plan_concluir(p_id uuid, p_concluida boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.plan_atividades;
begin
  select * into a from public.plan_atividades where id = p_id;
  if not found then raise exception 'Atividade não encontrada.'; end if;
  if not public.plan_edita(a.obra) then raise exception 'Só a Engenharia altera o planejamento.' using errcode = '42501'; end if;
  update public.plan_atividades set concluida = p_concluida, concluida_app = p_concluida,
    concluida_em = case when p_concluida then now() end, concluida_por = case when p_concluida then lower(auth.jwt() ->> 'email') end, atualizado_em = now()
  where id = p_id;
  perform public.plan_frentes(a.obra);
end $$;

-- corrigir as datas de uma atividade (erro no PDF). p_inicio/p_termino null = sem data
create or replace function public.plan_corrigir(p_id uuid, p_inicio date, p_termino date) returns void
language plpgsql security definer set search_path = public as $$
declare a public.plan_atividades; orig jsonb;
begin
  select * into a from public.plan_atividades where id = p_id;
  if not found then raise exception 'Atividade não encontrada.'; end if;
  if not public.plan_edita(a.obra) then raise exception 'Só a Engenharia altera o planejamento.' using errcode = '42501'; end if;
  if p_inicio is not null and p_termino is not null and p_termino < p_inicio then raise exception 'O término não pode ser antes do início.'; end if;
  orig := coalesce(a.correcao, jsonb_build_object('pdf_inicio', a.inicio, 'pdf_termino', a.termino));
  update public.plan_atividades set inicio = p_inicio, termino = p_termino,
    correcao = jsonb_build_object('pdf_inicio', orig -> 'pdf_inicio', 'pdf_termino', orig -> 'pdf_termino', 'inicio', p_inicio, 'termino', p_termino),
    ajuste = 'Datas corrigidas no app (no PDF: ' || coalesce(to_char((orig ->> 'pdf_inicio')::date, 'DD/MM/YYYY'), '—') || ' → ' || coalesce(to_char((orig ->> 'pdf_termino')::date, 'DD/MM/YYYY'), '—') || ')',
    atualizado_em = now()
  where id = p_id;
  perform public.plan_frentes(a.obra);
end $$;

-- desfazer a última importação do médio prazo: as atividades voltam ao que eram na versão anterior
create or replace function public.plan_desfazer_mp(p_obra text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid; ant uuid;
begin
  if not public.plan_edita(p_obra) then raise exception 'Só a Engenharia altera o planejamento.' using errcode = '42501'; end if;
  select id into v from public.plan_versoes where obra = p_obra and tipo = 'mp' order by criado_em desc limit 1;
  if v is null then raise exception 'Não há médio prazo importado.'; end if;
  select id into ant from public.plan_versoes where obra = p_obra and tipo = 'mp' and id <> v order by criado_em desc limit 1;
  -- criadas nesta versão: somem
  delete from public.plan_atividades a where a.obra = p_obra
    and not exists (select 1 from public.plan_hist h where h.atividade = a.id and h.versao <> v);
  -- as outras voltam ao estado da versão anterior
  if ant is not null then
    update public.plan_atividades a set inicio = h.inicio, termino = h.termino, ativa = h.ativa, versao = ant,
      concluida = h.concluida or a.concluida_app, ajuste = h.ajuste,
      n_mudancas = greatest(0, a.n_mudancas - case when (a.inicio is distinct from h.inicio or a.termino is distinct from h.termino) and h.ativa then 1 else 0 end),
      atualizado_em = now()
    from public.plan_hist h where h.atividade = a.id and h.versao = ant and a.obra = p_obra;
  end if;
  delete from public.plan_versoes where id = v;   -- o histórico desta versão vai junto
  perform public.plan_frentes(p_obra);
end $$;

-- excluir um PCP importado
create or replace function public.plan_excluir_pcp(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o text;
begin
  select obra into o from public.plan_versoes where id = p_id and tipo = 'pcp';
  if o is null then raise exception 'PCP não encontrado.'; end if;
  if not public.plan_edita(o) then raise exception 'Só a Engenharia altera o planejamento.' using errcode = '42501'; end if;
  delete from public.plan_versoes where id = p_id;
end $$;

-- zerar o planejamento da obra (as frentes e as modificações ficam; as datas previstas das frentes também)
create or replace function public.plan_zerar(p_obra text, p_ligacoes boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.plan_edita(p_obra) then raise exception 'Só a Engenharia altera o planejamento.' using errcode = '42501'; end if;
  delete from public.plan_versoes where obra = p_obra;
  delete from public.plan_atividades where obra = p_obra;
  if p_ligacoes then delete from public.plan_mapa where obra = p_obra; else delete from public.plan_mapa where obra = p_obra and tipo = 'aviso'; end if;
end $$;

-- trocar a ligação (serviço e/ou pavimentos) das atividades já importadas; null = não mexe
create or replace function public.plan_religar(p_obra text, p_ids uuid[], p_servico text, p_pavimentos text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.plan_edita(p_obra) then raise exception 'Só a Engenharia altera o planejamento.' using errcode = '42501'; end if;
  update public.plan_atividades set servico = case when p_servico is null then servico else nullif(p_servico, '') end,
    pavimentos = coalesce(p_pavimentos, pavimentos), atualizado_em = now()
  where obra = p_obra and id = any(p_ids);
  perform public.plan_frentes(p_obra);
end $$;

revoke all on function public.plan_concluir(uuid, boolean), public.plan_corrigir(uuid, date, date), public.plan_desfazer_mp(text), public.plan_excluir_pcp(uuid), public.plan_zerar(text, boolean), public.plan_religar(text, uuid[], text, text[]) from public, anon;
grant execute on function public.plan_concluir(uuid, boolean), public.plan_corrigir(uuid, date, date), public.plan_desfazer_mp(text), public.plan_excluir_pcp(uuid), public.plan_zerar(text, boolean), public.plan_religar(text, uuid[], text, text[]) to authenticated;
$p24$;
  update public.banco_versao set versao = 24, atualizado_em = now();
  raise notice 'Passo 24 aplicado: Planejamento (concluir, corrigir, desfazer e zerar)';
end $passo$;

-- =====================================================================
-- Passo 25: Conferências de serviço (FVQ) por voz
-- =====================================================================
do $passo$ begin
  if (select versao from public.banco_versao) >= 25 then return; end if;
  execute $p25$
-- uma conferência = uma ficha (modelo) num local; os itens e as respostas ficam em "itens"
create table if not exists public.fvq_conferencias (
  id          uuid primary key,
  obra        text not null references public.obras(id) on delete cascade,
  modelo      text not null,              -- id da ficha (ex.: fvq-030)
  modelo_nome text not null,
  pavimento   text not null,
  unidade     text,
  comodo      text,
  itens       jsonb not null default '[]',  -- [{id, txt, st: ok|nc|na|null, valor, unidade, desc, pend, pnum, lote, em}]
  resumo      jsonb not null default '{}',  -- {ok, nc, na, vz}
  status      text not null default 'andamento' check (status in ('andamento', 'concluida')),
  modo        text,                         -- voz | tela
  inicio      timestamptz not null default now(),
  fim         timestamptz,
  por         text,
  atualizado_em timestamptz not null default now()
);
create index if not exists fvq_conferencias_obra on public.fvq_conferencias (obra, inicio desc);
alter table public.fvq_conferencias enable row level security;

create or replace function public.fvq_ve(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() in ('admin', 'engenharia', 'consulta'), false)
$$;
create or replace function public.fvq_edita(p_obra text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.obra_ok(p_obra) and coalesce(public.perfil_atual() in ('admin', 'engenharia'), false)
$$;
grant execute on function public.fvq_ve(text), public.fvq_edita(text) to authenticated;

drop policy if exists "ve fvq" on public.fvq_conferencias;
drop policy if exists "cria fvq" on public.fvq_conferencias;
drop policy if exists "edita fvq" on public.fvq_conferencias;
drop policy if exists "apaga fvq" on public.fvq_conferencias;
create policy "ve fvq" on public.fvq_conferencias for select to authenticated using (public.fvq_ve(obra));
create policy "cria fvq" on public.fvq_conferencias for insert to authenticated with check (public.fvq_edita(obra));
create policy "edita fvq" on public.fvq_conferencias for update to authenticated using (public.fvq_edita(obra)) with check (public.fvq_edita(obra));
create policy "apaga fvq" on public.fvq_conferencias for delete to authenticated using (public.fvq_edita(obra));

-- autoria e data (o aparelho não decide quem conferiu)
create or replace function public.fvq_ao_gravar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.por := lower(auth.jwt() ->> 'email'); else new.por := old.por; new.obra := old.obra; new.inicio := old.inicio; end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists fvq_ao_gravar on public.fvq_conferencias;
create trigger fvq_ao_gravar before insert or update on public.fvq_conferencias for each row execute function public.fvq_ao_gravar();
$p25$;
  update public.banco_versao set versao = 25, atualizado_em = now();
  raise notice 'Passo 25 aplicado: Conferências de serviço (FVQ)';
end $passo$;

-- =====================================================================
-- Conferência final
-- =====================================================================
do $fim$ begin
  if not exists (select 1 from public.membros where perfil = 'admin') then
    raise warning 'Nenhum administrador. Troque SEU_EMAIL@exemplo.com no começo do banco-instalacao.sql pelo seu e-mail e rode os dois de novo.';
  end if;
  raise notice 'Banco na versão %.', (select versao from public.banco_versao);
end $fim$;
