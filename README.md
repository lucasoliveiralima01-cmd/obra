# Mapa de Risco

Painel web para desenhar mapas de risco (NR-5) sobre o modelo IFC da obra: áreas com riscos por grupo e intensidade, símbolos de sinalização, hachuras, revisões e exportação das pranchas em PDF/PNG.

Funciona de dois jeitos:

- **Online, com login** (recomendado): os dados ficam num banco no Supabase. Todo mundo que entra pelo link vê a mesma versão, e o que um salva aparece para os outros.
- **Local**: se o `config.js` ficar vazio, o painel abre sem login e guarda tudo só no navegador de quem abriu.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | O painel |
| `config.js` | Onde você cola o endereço e a chave do Supabase |
| `nuvem.js` | Login e conexão com o banco (não precisa mexer) |
| `supabase.sql` | Cria as tabelas, as regras de acesso e a pasta de arquivos no Supabase |

## Passo a passo

### 1. Criar o banco no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e um projeto novo (o plano gratuito serve para começar). Anote a senha do banco que ele pedir.
2. No projeto, abra **SQL Editor → New query**.
3. Abra o `supabase.sql`, troque `SEU_EMAIL@exemplo.com` (perto do fim) pelo seu e-mail, cole tudo no editor e clique em **Run**.
4. Vá em **Project Settings → API** (ou **Data API / API Keys**) e copie:
   - **Project URL**
   - a chave **anon / publishable** (nunca a `service_role` / `secret`).

### 2. Configurar o login

1. Em **Authentication → URL Configuration**:
   - **Site URL**: o endereço do GitHub Pages, por exemplo `https://seu-usuario.github.io/mapa-de-risco/`
   - **Redirect URLs**: adicione o mesmo endereço.
2. Em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up** (assim só entra quem você cadastrar).
3. Crie o seu usuário em **Authentication → Users → Add user → Create new user**, com o seu e-mail e uma senha.

### 3. Preencher o `config.js`

```js
supabaseUrl: 'https://abcdxyz.supabase.co',
supabaseAnonKey: 'eyJhbGciOi...',
```

### 4. Publicar no GitHub Pages

1. Envie `index.html`, `config.js`, `nuvem.js`, `supabase.sql` e este `README.md` para o repositório (**Add file → Upload files**).
2. Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
3. Em um ou dois minutos o link aparece no topo da página de Pages. Abra, entre com o seu e-mail e senha.

> No plano gratuito do GitHub, o Pages exige repositório público. Isso expõe só o código: os dados da obra ficam no Supabase, protegidos pelo login.

## Dar acesso a outras pessoas

São duas coisas, nesta ordem:

1. **Criar o usuário**: em **Authentication → Users**:
   - **Create new user**: você define e-mail e senha e passa a senha para a pessoa; ou
   - **Send invitation**: a pessoa recebe um e-mail, clica no link e cria a própria senha no painel.
2. **Liberar no painel**: no **SQL Editor**, rode:
   ```sql
   insert into public.membros (email, papel) values ('colega@empresa.com', 'editor');
   ```
   Use `'leitor'` no lugar de `'editor'` para quem só pode ver. Também dá para editar pela tela **Table Editor → membros**.

Para tirar o acesso: `delete from public.membros where email = 'colega@empresa.com';`

Quem tem login mas não está em `membros` vê a mensagem "Acesso pendente" e não enxerga nenhum dado.

## Um painel por obra

O mesmo site guarda obras separadas. Basta mudar o fim do link:

- `https://seu-usuario.github.io/mapa-de-risco/` → painel `principal`
- `https://seu-usuario.github.io/mapa-de-risco/?painel=residencial-x` → painel `residencial-x`

Cada painel tem o próprio modelo IFC, áreas, símbolos, revisões e carimbo.

## Bom saber

- **Modelo IFC**: é compactado antes de subir (um IFC de 1,3 MB vira cerca de 0,3 MB). O limite é 50 MB já compactado.
- **E-mails do Supabase** (convite, "esqueci minha senha"): o envio gratuito tem limite baixo por hora. Se a equipe for grande, prefira **Create new user**.
- **Projetos gratuitos do Supabase** ficam pausados depois de um tempo sem uso. Se o painel parar de conectar, entre no Supabase e reative o projeto.
- **Logo no carimbo**: na janela **Exportar PDF**, use o campo **Logo da empresa ou da obra no carimbo**.
- **Atualizar o painel**: troque só o `index.html` no repositório; os dados ficam no banco e não se perdem.
