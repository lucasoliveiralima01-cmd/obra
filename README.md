# Ferramentas da Obra

Site com ferramentas de engenharia e segurança que trabalham sobre o modelo IFC da obra:

- **Mapa de Risco** (NR-5): áreas com riscos por grupo e intensidade, símbolos de sinalização, hachuras, revisões e exportação das pranchas em PDF/PNG.
- **Mapa de Concretagem**: concretagens por pavimento e por caminhão, áreas e pilares concretados, corpos de prova e pendências de rompimento, revisões por pavimento e pranchas em PDF/PNG (com quadro de concretagens), além da exportação em Excel.

- **Mapa de Fachadas**: as 4 fachadas geradas do IFC da arquitetura (o IFC é lido no computador de quem importa; só imagens leves das fachadas vão para a nuvem). Camadas livres (chapisco, reboco, textura, pinturas…) com material e tempo de cura; cada aplicação é desenhada sobre a fachada com a data. O painel mostra o que está liberado, o que está em cura e quanto falta, as quebras de cura (camada seguinte aplicada antes do prazo) e as áreas prontas para a próxima etapa, com a área sem janelas e portas. Exporta imagem e planilha (CSV).

- **Pendências de obra**: registro de pendências e retrabalhos com fotos (antes e depois), ofício de quem corrige, prioridade e prazo, serviços travados, fluxo (em avaliação →) aberta → em correção → corrigida → fechada, histórico, resumo e relatórios em PDF. Funciona sem sinal: o que é registrado fica no aparelho e sobe sozinho quando a conexão volta.

### Perfis e obras

Cada pessoa tem **um perfil** (escolhido em **Administração**) e vê **só as obras liberadas para ela** (o administrador vê todas):

| Perfil | Risco | Concretagem e Fachadas | Pendências | Personalizações | Cerâmicas | Administração |
|---|---|---|---|---|---|---|
| **Administrador** | edita | edita | tudo o que a Engenharia faz, e fecha também as de segurança | edita | edita | sim |
| **Engenharia** | edita | edita | abre, edita, avalia as sugestões e fecha as que não são de segurança | registra, aprova e libera as frentes | edita tudo (estimativa, pallets, entregas) | não |
| **Segurança** (técnicos de segurança) | edita | não vê | registra pendências oficiais direto (sem passar pela Engenharia), avalia e fecha as de segurança | não vê | não vê | não |
| **Campo** | não vê | não vê | vê as dos seus **ofícios**, marca como corrigida (com foto) e **sugere** novas | vê as do seu ofício e dá **Estou ciente** | não vê | não |
| **Consulta** | só vê | só vê | só vê | só vê | só vê | não |
| **Almoxarifado** | não vê | não vê | não vê | não vê | recebe pallets e registra entregas (vê a estimativa) | não |

- **Ofícios** (Pedreiro, Eletricista, Impermeabilizador…) são obrigatórios para quem é de Campo e podem ser vários. Quem é da Segurança pode ter ofício também (ex.: Técnico de segurança), para receber as pendências desse ofício e ser escolhido como responsável. Técnico de segurança deve ficar no perfil **Segurança**, não em Campo; a Administração avisa quando isso acontece. A lista de ofícios fica em **Listas e regras → Ofícios**.
- **Pendência de segurança**: a Segurança registra e escolhe quem corrige. Quando a Engenharia vê uma não conformidade de segurança, marca **É de segurança do trabalho** e ela vai **em avaliação** para a Segurança, que escolhe quem corrige e encaminha. Quem dá a baixa final é a Segurança.
- **Sugestão de Campo**: quem é de Campo registra o que encontrou; a pendência fica **em avaliação** até a Engenharia aprovar (escolhendo quem corrige) ou não aprovar (com o motivo, que volta para quem sugeriu).

Essas regras ficam no banco (RLS), não só na tela.

A obra **Start** é criada sozinha, com o modelo IFC, o mapa de risco do térreo e as concretagens já registradas, na primeira vez que alguém da Engenharia (ou um administrador) abre a lista de obras.

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
| `fachadas.html` | Mapa de Fachadas |
| `ifc-leitor.js`, `fachada-gerar.js` | Leem o IFC da arquitetura e geram as imagens das fachadas (só carregam na hora de gerar) |
| `sw.js` | Guarda as páginas no aparelho para as pendências abrirem sem sinal |
| `start.js`, `start-concretagem.js` | Dados da obra Start (modelo IFC, mapa de risco e concretagens) |
| `config.js` | Onde você cola o endereço e a chave do Supabase |
| `nuvem.js` | Login, perfil de quem entrou, cadastro de obras e conexão com o banco (não precisa mexer) |
| `estilo.css` | Cores e fontes comuns a todas as páginas (tema claro e escuro) |
| `banco.sql` | O banco inteiro: tabelas, regras de acesso e pasta de arquivos. Serve para instalar e para atualizar |
| `admin.html`, `listas.html` | Administração (pessoas, perfis, obras, dados) e Listas e regras (ofícios, problemas, locais…) |
| `supabase/functions/` | Funções `notificar` (avisos) e `usuarios` (convites, backup e limpeza da lixeira) |

## Atualizar o banco (quem já usa o sistema)

Sempre que o `banco.sql` mudar, antes de enviar os arquivos novos ao GitHub:

1. No Supabase, abra **SQL Editor → New query**, cole o `banco.sql` **inteiro** e clique em **Run**. Ele vê sozinho o que o seu banco já tem e aplica só o que falta (não precisa trocar o e-mail do começo). Rodar de novo não estraga nada.
2. Se a mudança pedir, republique as funções `notificar` e `usuarios` (veja abaixo).

Se o banco estiver desatualizado, a página de **Administração** avisa no topo.

**Desta versão (perfis e obras):** rode o `banco.sql` e republique as duas funções. Quem já tinha acesso ganha um perfil a partir do acesso e do cargo de antes (Editar + Engenharia → Engenharia, Só visualizar sem cargo → Consulta, encarregado → Campo…) e continua vendo as obras que já existiam; quem é de Campo fica nas obras em que estava cadastrado como funcionário. Depois, confira cada pessoa em **Administração**.

### Backup e lixeira

- **Backup**: todo domingo de madrugada uma cópia dos dados é guardada no Supabase (ficam as 8 últimas). Em **Administração → Dados** dá para baixar os dados (JSON) e todos os arquivos (ZIP) a qualquer momento; guarde essas cópias fora do Supabase de vez em quando.
- **Lixeira**: obras e pendências excluídas, pendências não aprovadas e mapas resetados ficam 30 dias em **Administração → Dados** (dá para restaurar) e depois são apagados de vez, junto com os arquivos. **Resetar o mapa** (Risco ou Concretagem) é só para administradores.
- **Local na planta**: as plantas dos pavimentos são geradas sozinhas quando alguém que edita o **Mapa de Risco** abre o mapa da obra (e de novo quando o modelo IFC muda).

## Passo a passo (instalação nova)

### 1. Criar o banco no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e um projeto novo (o plano gratuito serve para começar).
2. No projeto, abra **SQL Editor → New query**.
3. Abra o `banco.sql`, troque `SEU_EMAIL@exemplo.com` (no começo) pelo seu e-mail, cole tudo no editor e clique em **Run**. Você vira o primeiro administrador.
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

- **Nova pendência** → quem foi escolhido para corrigir (ou todos de Campo daquele ofício na obra).
- **Sugestão de Campo** → Engenharia da obra; **pendência de segurança encaminhada** → Segurança da obra.
- **Sugestão não aprovada** → quem sugeriu, com o motivo.
- **Marcada como corrigida** → Engenharia (ou Segurança, nas de segurança).
- **Reprovada ou reaberta** → quem corrige, com o motivo.
- **Todo dia às 8h** → vencidas para quem corrige (e para a Segurança, nas de segurança) e um resumo para a Engenharia.

Cada pessoa só recebe avisos das obras liberadas para ela.

Configuração (uma vez, no Supabase):

1. **SQL Editor**: rode o `banco.sql` (se ainda não rodou) e depois a linha `update public.push_config ...` do arquivo `segredos-push.txt` (gerado no seu computador, fora do GitHub).
2. **Edge Functions → Deploy a new function → Via Editor**: nome `notificar`, cole o conteúdo de `supabase/functions/notificar/index.ts` e publique. Nos detalhes da função, desligue **Verify JWT** (a função confere o acesso sozinha).
3. **Edge Functions → Secrets**: crie `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT` e `AVISO_SEGREDO` com os valores do `segredos-push.txt`.
4. No painel de Pendências: **🔔 Avisos → Ligar avisos → Enviar teste**.

A chave pública das notificações fica no `config.js` (`vapidPublica`); a privada, só nos segredos do Supabase. Se gerar chaves novas, quem já tinha ligado os avisos precisa ligar de novo.

## Dar acesso a outras pessoas

**Pelo site (administradores):** o botão **Administração** abre a página `admin.html`:

- **Pessoas**: um cartão por pessoa com o **perfil** (Administrador, Engenharia, Segurança, Campo ou Consulta), os **ofícios** (só para Campo) e as **obras** dela. Cada toque salva na hora. Filtros por perfil, “aguardando liberação”, “convite não aceito” e “sem obra”; ações para **enviar link de senha**, **reenviar convite**, **bloquear acesso** e **excluir conta**.
- **+ Convidar pessoa**: e-mail, nome, perfil, ofícios e obras num passo só; o convite sai por e-mail.
- **Atividade**: quem mudou o perfil ou as obras de quem, convites, links de senha, exclusões e lixeira.
- **Dados**: espaço usado, backup e lixeira.
- **Ofícios e listas**: abre **Listas e regras** (ofícios, tipos de problema, locais…). Quem corrige mas **não usa o sistema** é cadastrado em **Listas e regras → Funcionários** de cada obra; quem usa o sistema com perfil Campo aparece lá sozinho.

Quem cria a obra já entra nela. Para colocar outras pessoas na obra nova, marque a obra no cartão de cada uma.

Para convidar e excluir contas pelo site, publique também a Edge Function `usuarios` (mesmo jeito da `notificar`: **Edge Functions → Deploy a new function → Via Editor**, nome `usuarios`, cole `supabase/functions/usuarios/index.ts`, publique e desligue **Verify JWT**). Ela não precisa de segredos novos. Sem ela, o resto da página funciona e o convite pode ser feito pelo Supabase (**Authentication → Users → Invite user**); depois, a pessoa aparece em **Administração** como “aguardando liberação”.

Quem tem login mas ainda não foi liberado vê a mensagem "Acesso pendente" e não enxerga nenhum dado.

**Nomes:** no primeiro acesso, cada pessoa informa como quer ser chamada. Depois dá para mudar clicando no próprio nome no topo da página. O administrador também pode mudar o nome de qualquer pessoa na Administração.

## Links

- `.../obra/`: página inicial (escolher a ferramenta)
- `.../obra/?ferramenta=risco`: lista de obras do Mapa de Risco
- `.../obra/risco.html?obra=residencial-x`: Mapa de Risco da obra `residencial-x`

O endereço da obra (`residencial-x`) é criado a partir do nome e não muda quando a obra é renomeada.

## Incluir uma ferramenta nova

1. Crie a página, por exemplo `concretagem.html`. Antes do `nuvem.js`, coloque `<script>window.NUVEM_FERRAMENTA='concretagem'</script>`.
2. Em `index.html`, na lista `FERRAMENTAS`, preencha `pagina: 'concretagem.html'`.
3. Na página, `Nuvem.obras.obter(Nuvem.obraId)` traz o nome e o modelo IFC da obra, e `Nuvem.db` guarda os dados da ferramenta separados por obra.
4. Diga quais perfis veem e editam a ferramenta: em `nuvem.js` (listas `VE` e `EDITA`), em `app.js` (lista `FERR`) e, no banco, na função `ferramenta_ok` (um passo novo no fim do `banco.sql`).

## Bom saber

- **Modelo IFC**: é compactado antes de subir. Um IFC de 1,3 MB vira cerca de 0,3 MB. O limite é 50 MB já compactado.
- **Alteração ao mesmo tempo**: se outra pessoa salvou o mesmo item depois que você o abriu, o painel mostra a versão dela e pergunta se você quer manter a dela ou gravar a sua por cima.
- **E-mails do Supabase** (convite, "esqueci minha senha"): o envio gratuito tem limite baixo por hora. Se a equipe for grande, prefira **Create new user**.
- **Projetos gratuitos do Supabase** ficam pausados depois de um tempo sem uso. Se o site parar de conectar, entre no Supabase e reative o projeto.
- **Logo no carimbo**: na janela **Exportar PDF**, use o campo **Logo da empresa ou da obra no carimbo**.
- **Zoom no celular**: a página não amplia com pinça nem com toque duplo, para a tela não sair do lugar. Ampliam só os mapas de desenho, a planta da pendência e a foto aberta em tela cheia.
- **Pendências no iPhone**: a pendência fica guardada no aparelho até subir. Se o Safari não deixar guardar (modo privado, ou ao voltar da câmera), ela sobe direto, desde que haja sinal.
- **Relatórios de pendências em PDF** (botão **Relatório PDF** e, na ficha, **⋯ → Exportar PDF**): *Consolidado* (duas pendências por página, blocos de tamanho fixo), *Individual* (uma página por pendência, com a planta e o encerramento), *Fotográfico* e *Lista detalhada*. Fotos além de quatro por categoria e textos longos vão para os anexos. O desenho fica em `relatorio-pdf.js`; o logo, a empresa e o endereço ficam guardados em cada aparelho.
- **Personalizações** (`personalizacoes.html`): modificações pedidas pelos compradores por apartamento (ex.: fechar uma porta do banheiro). Cada uma lista os **serviços afetados**, a equipe (ofício) e a instrução. Aprovada, a equipe de cada serviço recebe o aviso e precisa tocar em **Estou ciente** (ou a Engenharia registra quem foi avisado). Na aba **Frentes de trabalho** (serviço × pavimento) dá para marcar a **data prevista**: o sistema avisa 7 dias antes (no Meu dia e no celular, 5 dias antes) se ainda falta ciência, e a frente só é **liberada** com todas as ciências ou com uma justificativa registrada. As Pendências mostram quando o apartamento é personalizado.
- **Cerâmicas** (`ceramicas.html`): estoque por **pallet** com os dados da etiqueta (qualidade, tonalidade, tamanho/calibre, lote, PLT…) e a foto da etiqueta. O código quadrado da etiqueta (DataMatrix) traz só a **série** do pallet, então o pallet é registrado uma vez ao chegar; depois, o almoxarifado toca em **Ler etiqueta**, aponta o celular para o código e só escolhe **para quem** (os funcionários de ofício Azulejista aparecem primeiro), **para onde** (pavimento → apartamento → ambiente, pelo final: o 01 tem banheiro social e suíte) e **quantas caixas**. O saldo é guardado em peças (caixa + peças avulsas) e nunca fica negativo. A aba **Estimativa** calcula as peças de cada ambiente (área ÷ área da peça; rodapé pela peça cortada em tiras) com **margem de perda** ajustável, e a aba **Apartamentos** compara o entregue com o estimado e avisa quando um ambiente recebeu **duas partidas** (tonalidade, tamanho ou lote diferentes). O leitor usa o do navegador (Android) ou a biblioteca zxing-wasm (iPhone); sem câmera ao vivo, dá para tirar uma foto da etiqueta ou digitar o número.
