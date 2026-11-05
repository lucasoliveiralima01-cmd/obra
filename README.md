# Ferramentas da Obra

Site com ferramentas de engenharia e segurança que trabalham sobre o modelo IFC da obra:

- **Mapa de Risco** (NR-5): áreas com riscos por grupo e intensidade, símbolos de sinalização, hachuras, revisões e exportação das pranchas em PDF/PNG.
- **Mapa de Concretagem**: concretagens por pavimento e por caminhão, áreas e pilares concretados, corpos de prova e pendências de rompimento, revisões por pavimento e pranchas em PDF/PNG (com quadro de concretagens), além da exportação em Excel.

- **Pendências de obra**: registro de pendências e retrabalhos com fotos (antes e depois), responsável pela correção, prioridade e prazo, serviços travados, fluxo aberta → em correção → corrigida → fechada, histórico, resumo e relatórios em PDF. Funciona sem sinal: o que é registrado fica no aparelho e sobe sozinho quando a conexão volta.

Cargos nas pendências (definidos em **Administração**):
- **Engenharia**: abre, edita e vê todas; fecha as que não são de segurança.
- **Segurança**: abre, vê e fecha só as de segurança.
- **Encarregado**: vê só as das suas disciplinas (pode ter mais de uma, se forem complementares, como Drywall e Forro/Gesso), marca como corrigida com foto obrigatória, não abre pendências e não entra nos mapas.

Essas regras ficam no banco (RLS), não só na tela.

A obra **Start** é criada sozinha, com o modelo IFC, o mapa de risco do térreo e as concretagens já registradas, na primeira vez que um editor abre a lista de obras.

Como funciona:

1. A pessoa entra com login e escolhe a **obra** (cada cartão mostra um resumo: pendências abertas e vencidas, última concretagem, última revisão do mapa de risco) ou cadastra uma nova, com nome e modelo IFC.
2. Na página da obra, escolhe a **ferramenta**. Dentro da ferramenta, as abas no topo trocam de ferramenta na mesma obra, e um toque no nome da obra abre a lista para trocar de obra. As ações secundárias e o tema (automático, claro ou escuro) ficam no menu **⋯**.
3. O modelo fica guardado **na obra** e serve para todas as ferramentas. Ele só precisa ser enviado uma vez.
4. Cada ferramenta guarda os próprios dados de cada obra. Todos da equipe veem a mesma versão.
5. Se duas pessoas alteram o mesmo item ao mesmo tempo, o painel avisa e deixa escolher qual versão fica.

Se o `config.js` ficar vazio, o site abre sem login, no **modo local**. Nesse caso tudo fica só no navegador de quem abriu e não há cadastro de obras.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | Página inicial: escolha da ferramenta e da obra, cadastro de obras |
| `risco.html` | Mapa de Risco |
| `concretagem.html` | Mapa de Concretagem |
| `pendencias.html` | Pendências de obra |
| `sw.js` | Guarda as páginas no aparelho para as pendências abrirem sem sinal |
| `start.js`, `start-concretagem.js` | Dados da obra Start (modelo IFC, mapa de risco e concretagens) |
| `config.js` | Onde você cola o endereço e a chave do Supabase |
| `nuvem.js` | Login, cadastro de obras e conexão com o banco (não precisa mexer) |
| `supabase.sql` | Cria as tabelas, as regras de acesso e a pasta de arquivos no Supabase (instalação nova) |
| `atualizacao-obras.sql` | Atualiza um banco criado antes do cadastro de obras (rodar uma vez) |
| `atualizacao-perfis.sql` | Atualiza um banco criado antes dos nomes das pessoas e da foto das obras (rodar uma vez) |

## Já usava uma versão anterior?

Rode os arquivos de atualização que ainda não rodou, **uma vez cada**, nesta ordem, antes de enviar os arquivos novos ao GitHub:

1. `atualizacao-obras.sql`
2. `atualizacao-perfis.sql`
3. `atualizacao-admin.sql` (troque `SEU_EMAIL@exemplo.com`, no fim, pelo seu e-mail antes de rodar)
4. `atualizacao-pendencias.sql` (módulo de pendências; instalações novas também rodam este, depois do `supabase.sql`)
5. `atualizacao-push.sql` (avisos; veja "App instalável e avisos")
6. `atualizacao-admin2.sql` (página de Administração: atividade, convites e mais informações por pessoa)
7. `atualizacao-melhorias.sql` (lixeira de 30 dias, comentários, local na planta, versões do modelo, espaço usado, avisos de concreto, backup semanal e limpeza diária). Depois dele, republique as funções `notificar` e `usuarios` com o código novo.

### Backup e lixeira

- **Backup**: todo domingo de madrugada uma cópia dos dados é guardada no Supabase (ficam as 8 últimas). Em **Administração → Dados** dá para baixar os dados (JSON) e todos os arquivos (ZIP) a qualquer momento; guarde essas cópias fora do Supabase de vez em quando.
- **Lixeira**: obras e pendências excluídas ficam 30 dias em **Administração → Dados** (dá para restaurar) e depois são apagadas de vez, junto com os arquivos.
- **Local na planta**: as plantas dos pavimentos são geradas sozinhas quando alguém com acesso de edição abre o **Mapa de Risco** da obra (e de novo quando o modelo IFC muda).

Para cada um: no Supabase, abra **SQL Editor → New query**, cole o conteúdo e clique em **Run**. Rodar de novo não estraga nada.

O `atualizacao-obras.sql` cria o cadastro de obras e transforma cada painel antigo em uma obra. Por exemplo, o painel `principal` vira a obra "Principal", com o mesmo modelo IFC, as mesmas áreas, símbolos e revisões. Depois, dá para renomear a obra na lista.

## Passo a passo (instalação nova)

### 1. Criar o banco no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e um projeto novo (o plano gratuito serve para começar).
2. No projeto, abra **SQL Editor → New query**.
3. Abra o `supabase.sql`, troque `SEU_EMAIL@exemplo.com` (perto do fim) pelo seu e-mail, cole tudo no editor e clique em **Run**.
4. Vá em **Project Settings → API** (ou **Data API / API Keys**) e copie:
   - **Project URL**, só o endereço, sem `/rest/v1/` no fim;
   - a chave **anon / publishable** (nunca a `service_role` / `secret`).

### 2. Configurar o login

1. Em **Authentication → URL Configuration**:
   - **Site URL**: o endereço do GitHub Pages, por exemplo `https://seu-usuario.github.io/obra/`
   - **Redirect URLs**: adicione o mesmo endereço.
2. Em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**. Assim só entra quem você cadastrar.
3. Crie o seu usuário em **Authentication → Users → Add user → Create new user**, com o seu e-mail e uma senha.

### 3. Preencher o `config.js`

```js
supabaseUrl: 'https://abcdxyz.supabase.co',
supabaseAnonKey: 'sb_publishable_...',
```

Confira as aspas e as vírgulas. Se o arquivo tiver um erro de digitação, o site mostra um aviso na tela.

### 4. Publicar no GitHub Pages

1. Envie os arquivos para o repositório (pelo GitHub Desktop: **Commit** e depois **Push origin**).
2. Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
3. Em um ou dois minutos o link aparece no topo da página de Pages. Abra e entre com o seu e-mail e a sua senha.

> No plano gratuito do GitHub, o Pages exige repositório público. Isso expõe só o código. Os dados das obras ficam no Supabase, protegidos pelo login.

## App instalável e avisos (notificações)

O site pode ser instalado como app: no Chrome ou no Edge aparece o botão **Instalar app** no topo (ou use o menu do navegador → Instalar). No iPhone: Safari → **Compartilhar** → **Adicionar à Tela de Início**. No iPhone, os avisos só funcionam com o app instalado assim.

Cada pessoa liga os avisos no próprio aparelho pelo botão **🔔 Avisos** do painel de Pendências. Quem recebe o quê:

- **Nova pendência** → encarregados da disciplina responsável.
- **Marcada como corrigida** → Engenharia (ou Segurança, nas de segurança).
- **Reprovada ou reaberta** → encarregados da disciplina, com o motivo.
- **Todo dia às 8h** → vencidas para a disciplina (e para a Segurança, nas de segurança) e um resumo para a Engenharia.

Configuração (uma vez, no Supabase):

1. **SQL Editor**: rode o `atualizacao-push.sql` e depois a linha `update public.push_config ...` do arquivo `segredos-push.txt` (gerado no seu computador, fora do GitHub).
2. **Edge Functions → Deploy a new function → Via Editor**: nome `notificar`, cole o conteúdo de `supabase/functions/notificar/index.ts` e publique. Nos detalhes da função, desligue **Verify JWT** (a função confere o acesso sozinha).
3. **Edge Functions → Secrets**: crie `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT` e `AVISO_SEGREDO` com os valores do `segredos-push.txt`.
4. No painel de Pendências: **🔔 Avisos → Ligar avisos → Enviar teste**.

A chave pública das notificações fica no `config.js` (`vapidPublica`); a privada, só nos segredos do Supabase. Se gerar chaves novas, quem já tinha ligado os avisos precisa ligar de novo.

## Dar acesso a outras pessoas

**Pelo site (administradores):** o botão **Administração** abre a página `admin.html`:

- **Resumo no topo**: pessoas, aguardando liberação, convites não aceitos, quantos por cargo e quantos com avisos ligados (cada número filtra a lista).
- **Pessoas**: acesso aos mapas (Sem acesso, Só visualizar, Editar, Administrador), cargo nas pendências e disciplinas, nome, último acesso, pendências registradas e avisos ligados; ações para **enviar link de senha**, **reenviar convite** e **excluir conta**.
- **+ Convidar pessoa**: e-mail, nome, acesso e cargo num passo só; o convite sai por e-mail.
- **Atividade**: quem mudou o acesso ou o cargo de quem, convites, links de senha e exclusões.

Para convidar e excluir contas pelo site, publique também a Edge Function `usuarios` (mesmo jeito da `notificar`: **Edge Functions → Deploy a new function → Via Editor**, nome `usuarios`, cole `supabase/functions/usuarios/index.ts`, publique e desligue **Verify JWT**). Ela não precisa de segredos novos. Sem ela, o resto da página funciona e o convite pode ser feito pelo Supabase (**Authentication → Users → Invite user**).

**Pelo Supabase**, sem o painel, são duas coisas, nesta ordem:

1. **Criar o usuário**: em **Authentication → Users**:
   - **Create new user**: você define o e-mail e a senha e passa a senha para a pessoa; ou
   - **Send invitation**: a pessoa recebe um e-mail, clica no link e cria a própria senha no painel.
2. **Liberar no painel**: no **SQL Editor**, rode:
   ```sql
   insert into public.membros (email, papel) values ('colega@empresa.com', 'editor');
   ```
   Use `'leitor'` no lugar de `'editor'` para quem só pode ver. Também dá para editar pela tela **Table Editor → membros**.

Para tirar o acesso: `delete from public.membros where email = 'colega@empresa.com';`

Quem tem login mas não está em `membros` vê a mensagem "Acesso pendente" e não enxerga nenhum dado.

**Nomes:** no primeiro acesso, cada pessoa informa como quer ser chamada. Depois dá para mudar clicando no próprio nome no topo da página. Na página inicial, o botão **Equipe** lista os membros: cada um muda o próprio nome, e editores podem dar nome a qualquer pessoa.

O que cada papel pode fazer:

- **Editor**: cria, renomeia e exclui obras, envia e troca o modelo IFC e edita os dados das ferramentas.
- **Leitor**: só vê.

## Links

- `.../obra/`: página inicial (escolher a ferramenta)
- `.../obra/?ferramenta=risco`: lista de obras do Mapa de Risco
- `.../obra/risco.html?obra=residencial-x`: Mapa de Risco da obra `residencial-x`

O endereço da obra (`residencial-x`) é criado a partir do nome e não muda quando a obra é renomeada.

## Incluir uma ferramenta nova

1. Crie a página, por exemplo `concretagem.html`. Antes do `nuvem.js`, coloque `<script>window.NUVEM_FERRAMENTA='concretagem'</script>`.
2. Em `index.html`, na lista `FERRAMENTAS`, preencha `pagina: 'concretagem.html'`.
3. Na página, `Nuvem.obras.obter(Nuvem.obraId)` traz o nome e o modelo IFC da obra, e `Nuvem.db` guarda os dados da ferramenta separados por obra.

## Bom saber

- **Modelo IFC**: é compactado antes de subir. Um IFC de 1,3 MB vira cerca de 0,3 MB. O limite é 50 MB já compactado.
- **Alteração ao mesmo tempo**: se outra pessoa salvou o mesmo item depois que você o abriu, o painel mostra a versão dela e pergunta se você quer manter a dela ou gravar a sua por cima.
- **E-mails do Supabase** (convite, "esqueci minha senha"): o envio gratuito tem limite baixo por hora. Se a equipe for grande, prefira **Create new user**.
- **Projetos gratuitos do Supabase** ficam pausados depois de um tempo sem uso. Se o site parar de conectar, entre no Supabase e reative o projeto.
- **Logo no carimbo**: na janela **Exportar PDF**, use o campo **Logo da empresa ou da obra no carimbo**.
