/* =====================================================================
   Mapa de Risco — conexão com o banco online (Supabase) e tela de login
   ---------------------------------------------------------------------
   - Com o config.js preenchido: pede login, lê e grava tudo no Supabase
     e atualiza a tela quando outra pessoa salva alguma coisa.
   - Obras: cadastro comum (nome + modelo IFC) usado por todas as ferramentas.
     Cada ferramenta guarda os dados dela em painel = "ferramenta:obra".
   - Conflitos: ao salvar, confere se outra pessoa salvou o mesmo item antes.
   - Sem o config.js preenchido: o painel funciona só neste navegador
     (modo local), como o arquivo HTML original.
   Não é preciso mexer neste arquivo; as configurações ficam no config.js.
   ===================================================================== */
(function () {
  'use strict';
  let pronto;
  window.NUVEM_PRONTA = new Promise(r => (pronto = r));

  // config.js com erro de digitação (aspa ou vírgula faltando) não define
  // MAPA_CONFIG; avisa em vez de cair calado no modo local.
  if (!window.MAPA_CONFIG) {
    console.error('config.js não carregou ou tem erro de sintaxe.');
    mostrarFalha('O arquivo config.js não carregou ou tem um erro de digitação (confira aspas e vírgulas). Corrija e recarregue a página.');
    return;
  }
  const C = window.MAPA_CONFIG;
  // Aceita o endereço copiado com /rest/v1/ ou barra no fim.
  C.supabaseUrl = String(C.supabaseUrl || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth|storage)\/v1$/i, '');
  C.supabaseAnonKey = String(C.supabaseAnonKey || '').trim();

  const temConfig = !!(C.supabaseUrl && C.supabaseAnonKey);
  if (!temConfig) { pronto(null); return; }
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Biblioteca do Supabase não carregou.');
    mostrarFalha('Não foi possível carregar a conexão com o banco online. Verifique a internet e recarregue a página.');
    return;
  }

  const hashInicial = location.hash || '';
  let precisaSenha = /type=(invite|recovery|signup)/.test(hashInicial);
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const T = 'registros';
  const BUCKET = C.bucket || 'arquivos';
  const slug = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  // Cada página de ferramenta define window.NUVEM_FERRAMENTA (ex.: 'risco') antes
  // de carregar este arquivo; a página inicial não define.
  const ferramenta = slug(window.NUVEM_FERRAMENTA || '');
  const qs = new URLSearchParams(location.search);
  const obraId = slug(qs.get('obra') || qs.get('painel') || '');
  if (ferramenta && !obraId) {
    // ferramenta aberta sem dizer a obra: volta para a escolha de obra
    location.replace('index.html?ferramenta=' + encodeURIComponent(ferramenta));
    return;
  }
  // chave dos dados no banco e pasta dos arquivos desta ferramenta nesta obra
  const painel = ferramenta ? ferramenta + ':' + obraId : '';
  const pasta = ferramenta ? ferramenta + '/' + obraId : '';
  let usuario = null, papel = null, iniciou = false;

  /* ---------------- erros no formato que o painel entende ---------------- */
  function erro(e) {
    const msg = (e && (e.message || e.error_description || e.error)) || 'erro';
    const s = String((e && (e.code || e.statusCode || e.status)) || '');
    const x = new Error(msg);
    if (s === '42501' || s === '401' || s === '403' || /row-level security|permission|not authorized|unauthorized|jwt/i.test(msg)) x.code = 'permission_denied';
    else if (s === '413' || /exceeded|too large|payload|quota/i.test(msg)) x.code = 'quota_exceeded';
    else x.code = 'erro';
    return x;
  }
  // Outra pessoa salvou o mesmo item depois que você o abriu.
  // "atual" traz a versão que está no banco (null se foi apagado).
  function conflito(atual, por, em) {
    const x = new Error('conflito');
    x.code = 'conflito'; x.atual = atual; x.por = por || null; x.em = em || null;
    return x;
  }
  const email = () => (usuario && usuario.email) || null;

  /* ---------------- banco: mesma interface que o painel já usa ---------------- */
  const dividir = p => { const i = p.indexOf('/'); return [p.slice(0, i), p.slice(i + 1)]; };
  async function lerColecao(col) {
    const out = []; const passo = 1000;
    for (let de = 0; ; de += passo) {
      const { data, error } = await sb.from(T).select('id,dados')
        .eq('painel', painel).eq('colecao', col).order('id').range(de, de + passo - 1);
      if (error) throw erro(error);
      for (const r of data) out.push({ id: r.id, dados: r.dados });
      if (data.length < passo) break;
    }
    return out;
  }
  const comoSnap = linhas => ({ docs: linhas.map(r => ({ id: r.id, exists: true, data: () => r.dados })) });

  const ouvintes = [];
  async function atualizar(o) {
    try {
      const linhas = await lerColecao(o.col);
      const sig = JSON.stringify(linhas);
      if (sig !== o.sig) { o.sig = sig; o.cb(comoSnap(linhas)); }
      o.falhou = false;
    } catch (e) {
      console.warn('Falha ao atualizar', o.col, e);
      if (o.sig == null && o.err && !o.falhou) { o.falhou = true; o.err(e); }
    }
  }
  const tempos = {};
  function agendar(col) {
    for (const o of ouvintes) {
      if (col && o.col !== col) continue;
      clearTimeout(tempos[o.col]);
      tempos[o.col] = setTimeout(() => atualizar(o), 250);
    }
  }

  const db = {
    // pn: outro painel (ex.: 'risco:start'); omitido = o painel desta página
    doc(path, pn) {
      const [col, id] = dividir(path);
      const painel_ = pn || painel;
      return {
        async get() {
          const { data, error } = await sb.from(T).select('dados,atualizado_por,atualizado_em')
            .eq('painel', painel_).eq('colecao', col).eq('id', id).maybeSingle();
          if (error) throw erro(error);
          return { id, exists: !!data, data: () => (data ? data.dados : undefined),
            por: data && data.atualizado_por, em: data && data.atualizado_em };
        },
        // opt.base: o campo "atualizado" da versão que a pessoa abriu.
        //   string -> só grava se o banco ainda estiver nessa versão;
        //   null   -> item novo, só grava se ainda não existir;
        //   omitido ou opt.forcar -> grava sem conferir.
        async set(o, opt) {
          opt = opt || {};
          const linha = { painel: painel_, colecao: col, id, dados: o,
            atualizado_em: new Date().toISOString(), atualizado_por: email() };
          if (opt.forcar || opt.base === undefined) {
            const { error } = await sb.from(T).upsert(linha);
            if (error) throw erro(error);
            return;
          }
          if (opt.base) {
            const { data, error } = await sb.from(T).update(linha)
              .eq('painel', painel_).eq('colecao', col).eq('id', id)
              .eq('dados->>atualizado', opt.base).select('id');
            if (error) throw erro(error);
            if (data && data.length) return;
          } else {
            const { error } = await sb.from(T).insert(linha);
            if (!error) return;
            if (String(error.code) !== '23505') throw erro(error);
          }
          const atual = await this.get();
          // mesma versão no banco e nada gravado: falta de permissão, não conflito
          if (atual.exists && opt.base && (atual.data() || {}).atualizado === opt.base) {
            const x = new Error('sem permissão'); x.code = 'permission_denied'; throw x;
          }
          throw conflito(atual.exists ? atual.data() : null, atual.por, atual.em);
        },
        async delete() {
          const { error } = await sb.from(T).delete()
            .eq('painel', painel_).eq('colecao', col).eq('id', id);
          if (error) throw erro(error);
        }
      };
    },
    collection(col) {
      return {
        async get() { return comoSnap(await lerColecao(col)); },
        onSnapshot(cb, err) {
          const o = { col, cb, err, sig: null };
          ouvintes.push(o); atualizar(o);
          return () => { const i = ouvintes.indexOf(o); if (i >= 0) ouvintes.splice(i, 1); };
        }
      };
    }
  };

  /* ---------------- arquivos (IFC, imagens de fundo, logo) ---------------- */
  const urls = new Map();
  const novoNome = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  async function enviar(caminho, blob) {
    const { error } = await sb.storage.from(BUCKET).upload(caminho, blob, {
      contentType: blob.type || 'application/octet-stream', upsert: false
    });
    if (error) throw erro(error);
    return { id: caminho };
  }
  async function listarPasta(p) {
    const { data, error } = await sb.storage.from(BUCKET).list(p, { limit: 1000 });
    if (error) throw erro(error);
    return (data || []).filter(f => f.name && f.id !== null).map(f => p + '/' + f.name);
  }
  // arquivos desta ferramenta nesta obra (imagens de fundo, logo)
  const assets = {
    upload(blob) { return enviar(pasta + '/' + novoNome(), blob); },
    async delete(id) {
      const { error } = await sb.storage.from(BUCKET).remove([id]);
      if (error) throw erro(error);
      urls.delete(id);
    },
    async list() { return { assets: (await listarPasta(pasta)).map(id => ({ id })) }; }
  };

  /* ---------------- cadastro de obras ---------------- */
  const OBRA_COLS = 'id,nome,modelo,criado_em,criado_por,atualizado_em,atualizado_por';
  const obras = {
    async listar() {
      const { data, error } = await sb.from('obras').select(OBRA_COLS).order('nome');
      if (error) throw erro(error);
      return data || [];
    },
    async obter(id) {
      const { data, error } = await sb.from('obras').select(OBRA_COLS).eq('id', id).maybeSingle();
      if (error) throw erro(error);
      return data || null;
    },
    // cria a obra com um endereço (id) tirado do nome; se já existir, acrescenta -2, -3...
    async criar(nome) {
      const base = slug(nome) || 'obra';
      for (let n = 1; n < 50; n++) {
        const id = n === 1 ? base : (base.slice(0, 55) + '-' + n);
        const { data, error } = await sb.from('obras')
          .insert({ id, nome, criado_por: email(), atualizado_por: email() }).select(OBRA_COLS).single();
        if (!error) return data;
        if (String(error.code) !== '23505') throw erro(error);
      }
      throw erro({ message: 'Não foi possível criar um endereço para esta obra.' });
    },
    // base: atualizado_em da versão que a pessoa abriu (omitido = grava sem conferir)
    async alterar(id, campos, base) {
      const linha = Object.assign({}, campos, { atualizado_em: new Date().toISOString(), atualizado_por: email() });
      let q = sb.from('obras').update(linha).eq('id', id);
      if (base) q = q.eq('atualizado_em', base);
      const { data, error } = await q.select(OBRA_COLS);
      if (error) throw erro(error);
      if (data && data.length) return data[0];
      const atual = await obras.obter(id);
      if (atual && base && atual.atualizado_em === base) {
        const x = new Error('sem permissão'); x.code = 'permission_denied'; throw x;
      }
      throw conflito(atual, atual && atual.atualizado_por, atual && atual.atualizado_em);
    },
    enviarModelo(id, blob) { return enviar('obras/' + id + '/' + novoNome(), blob); },
    async apagarArquivo(caminho) {
      if (!caminho) return;
      const { error } = await sb.storage.from(BUCKET).remove([caminho]);
      if (error) throw erro(error);
      urls.delete(caminho);
    },
    // apaga a obra, os dados dela em todas as ferramentas e os arquivos
    async apagar(id, ferramentas) {
      const { error: e1 } = await sb.from(T).delete().like('painel', '%:' + id);
      if (e1) throw erro(e1);
      const pastas = ['obras/' + id].concat((ferramentas || []).map(f => f + '/' + id));
      for (const p of pastas) {
        try { const l = await listarPasta(p); if (l.length) await sb.storage.from(BUCKET).remove(l); }
        catch (e) { console.warn('Arquivos de', p, e); }
      }
      const { error: e2 } = await sb.from('obras').delete().eq('id', id);
      if (e2) throw erro(e2);
    },
    // chama cb() quando alguém cria, altera ou apaga uma obra
    aoMudar(cb) {
      let t;
      const avisar = () => { clearTimeout(t); t = setTimeout(cb, 300); };
      try {
        sb.channel('obras').on('postgres_changes', { event: '*', schema: 'public', table: 'obras' }, avisar).subscribe();
      } catch (e) { console.warn('Tempo real indisponível', e); }
      document.addEventListener('visibilitychange', () => { if (!document.hidden) avisar(); });
    }
  };
  async function blobUrl(id) {
    if (urls.has(id)) return urls.get(id);
    const { data, error } = await sb.storage.from(BUCKET).download(id);
    if (error) throw erro(error);
    const u = URL.createObjectURL(data); urls.set(id, u); return u;
  }

  /* ---------------- atualização ao vivo ---------------- */
  function ligarAoVivo() {
    if (!painel) return;
    try {
      sb.channel('registros-' + painel)
        .on('postgres_changes', { event: '*', schema: 'public', table: T, filter: 'painel=eq.' + painel }, p => {
          const c = (p.new && p.new.colecao) || (p.old && p.old.colecao);
          agendar(c || null);
        })
        .subscribe();
    } catch (e) { console.warn('Tempo real indisponível', e); }
    // reforço: confere de novo ao voltar para a aba e a cada 30 s
    document.addEventListener('visibilitychange', () => { if (!document.hidden) agendar(null); });
    setInterval(() => { if (!document.hidden) agendar(null); }, 30000);
  }

  /* =====================================================================
     Tela de login
     ===================================================================== */
  const css = `
  #authTela{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px;
    background:var(--navy,#22425c);color:#fff;font-family:var(--f-body,system-ui,sans-serif);overflow:auto}
  #authTela::before{content:"";position:absolute;inset:0 0 0 auto;width:min(46%,620px);background:var(--petrol,#074669);
    clip-path:polygon(90px 0,100% 0,100% 100%,0 100%);pointer-events:none}
  #authTela .ac{position:relative;width:min(400px,100%);background:var(--panel,#fff);color:var(--ink,#14222e);
    border-radius:12px;padding:26px 24px 22px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:grid;gap:14px}
  #authTela .ak{font:600 .7rem var(--f-disp,sans-serif);letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#5a6b78);
    display:flex;align-items:center;gap:8px}
  #authTela .ak i{width:8px;height:8px;border-radius:50%;display:inline-block}
  #authTela h1{margin:-6px 0 0;font:700 1.7rem/1.1 var(--f-disp,sans-serif)}
  #authTela p{margin:0;color:var(--muted,#5a6b78);font-size:.92rem;line-height:1.45}
  #authTela form{display:grid;gap:12px}
  #authTela label{display:grid;gap:4px;font:600 .82rem var(--f-body,sans-serif);color:var(--muted,#5a6b78)}
  #authTela input{background:var(--bg,#eef2f5);border:1px solid var(--line,#d3dce3);border-radius:7px;padding:10px 11px;
    font:500 1rem var(--f-body,sans-serif);color:var(--ink,#14222e)}
  #authTela input:focus{outline:2px solid var(--accent,#074669);outline-offset:1px}
  #authTela .ab{background:var(--accent,#074669);color:var(--accent-ink,#fff);border:0;border-radius:7px;padding:11px 14px;
    font:700 .95rem var(--f-body,sans-serif);cursor:pointer}
  #authTela .ab:disabled{opacity:.6;cursor:default}
  #authTela .al{background:none;border:0;padding:0;color:var(--accent,#074669);font:600 .86rem var(--f-body,sans-serif);
    cursor:pointer;justify-self:start;text-decoration:underline;text-underline-offset:3px}
  #authTela .am{font-size:.86rem;padding:8px 10px;border-radius:7px;background:var(--bad-soft,#f8e0dc);color:var(--bad,#c23b2f)}
  #authTela .am.ok{background:var(--ok-soft,#dcf0e3);color:var(--ok,#23804a)}
  #authTela .ar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
  #authTela .ap{font:500 .72rem var(--f-mono,monospace);color:var(--muted,#5a6b78)}
  .hctl .quem{font:500 .74rem var(--f-mono,monospace);color:#d4e4ee;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const tela = document.createElement('div'); tela.id = 'authTela'; tela.setAttribute('role', 'dialog');
  tela.setAttribute('aria-modal', 'true'); tela.setAttribute('aria-label', 'Entrar');
  document.body.appendChild(tela);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const topo = (titulo) => `<div class="ak">Segurança do trabalho · NR-5 <span>${['#5cb531', '#e3141b', '#6c4a33', '#f3d500', '#1736e0'].map(c => `<i style="background:${c}"></i>`).join('')}</span></div><h1>${titulo}</h1>`;
  const nomeSistema = C.titulo || 'Mapa de Risco';
  const rodapePainel = obraId ? `<span class="ap">obra: ${esc(obraId)}</span>` : '';

  function tLogin(msg, ok) {
    tela.hidden = false;
    tela.innerHTML = `<div class="ac">${topo(esc(nomeSistema))}
      <p>Entre com o e-mail e a senha cadastrados para acessar o painel.</p>
      ${msg ? `<div class="am${ok ? ' ok' : ''}" role="alert">${esc(msg)}</div>` : ''}
      <form id="fLogin" novalidate>
        <label>E-mail<input id="lEmail" type="email" autocomplete="username" required></label>
        <label>Senha<input id="lSenha" type="password" autocomplete="current-password" required></label>
        <button class="ab" id="lOk">Entrar</button>
      </form>
      <div class="ar"><button class="al" id="lEsq" type="button">Esqueci minha senha</button>
      ${C.permitirCadastro ? '<button class="al" id="lCad" type="button">Criar conta</button>' : ''}${rodapePainel}</div></div>`;
    const em = tela.querySelector('#lEmail'); em.value = localStorage.getItem('mr_ultimo_email') || '';
    (em.value ? tela.querySelector('#lSenha') : em).focus();
    tela.querySelector('#fLogin').onsubmit = async ev => {
      ev.preventDefault();
      const email = em.value.trim(), senha = tela.querySelector('#lSenha').value;
      if (!email || !senha) { tLogin('Preencha o e-mail e a senha.'); return; }
      const b = tela.querySelector('#lOk'); b.disabled = true; b.textContent = 'Entrando…';
      const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) {
        const m = /invalid login|invalid credentials/i.test(error.message) ? 'E-mail ou senha incorretos.'
          : /not confirmed/i.test(error.message) ? 'Confirme o seu e-mail antes de entrar (veja a caixa de entrada).'
          : 'Não foi possível entrar: ' + error.message;
        tLogin(m); tela.querySelector('#lEmail').value = email; return;
      }
      try { localStorage.setItem('mr_ultimo_email', email); } catch (e) {}
      await entrou(data.session);
    };
    tela.querySelector('#lEsq').onclick = () => tEsqueci(em.value.trim());
    if (C.permitirCadastro) tela.querySelector('#lCad').onclick = () => tCadastro(em.value.trim());
  }

  function tEsqueci(email, msg, ok) {
    tela.innerHTML = `<div class="ac">${topo('Recuperar senha')}
      <p>Informe o seu e-mail. Você vai receber um link para criar uma nova senha.</p>
      ${msg ? `<div class="am${ok ? ' ok' : ''}" role="alert">${esc(msg)}</div>` : ''}
      <form id="fEsq" novalidate><label>E-mail<input id="rEmail" type="email" autocomplete="username" value="${esc(email || '')}"></label>
      <button class="ab" id="rOk">Enviar link</button></form>
      <div class="ar"><button class="al" id="rVolta" type="button">Voltar para o login</button></div></div>`;
    tela.querySelector('#rEmail').focus();
    tela.querySelector('#rVolta').onclick = () => tLogin();
    tela.querySelector('#fEsq').onsubmit = async ev => {
      ev.preventDefault(); const e = tela.querySelector('#rEmail').value.trim(); if (!e) return;
      const b = tela.querySelector('#rOk'); b.disabled = true; b.textContent = 'Enviando…';
      const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.pathname + location.search });
      if (error) tEsqueci(e, 'Não foi possível enviar: ' + error.message);
      else tEsqueci(e, 'Se este e-mail estiver cadastrado, o link chega em alguns minutos. Confira também o spam.', true);
    };
  }

  function tCadastro(email, msg, ok) {
    tela.innerHTML = `<div class="ac">${topo('Criar conta')}
      <p>Depois de criar a conta, o administrador do painel precisa liberar o seu acesso.</p>
      ${msg ? `<div class="am${ok ? ' ok' : ''}" role="alert">${esc(msg)}</div>` : ''}
      <form id="fCad" novalidate><label>E-mail<input id="cEmail" type="email" autocomplete="username" value="${esc(email || '')}"></label>
      <label>Senha (mínimo 8 caracteres)<input id="cSenha" type="password" autocomplete="new-password"></label>
      <button class="ab" id="cOk">Criar conta</button></form>
      <div class="ar"><button class="al" id="cVolta" type="button">Voltar para o login</button></div></div>`;
    tela.querySelector('#cVolta').onclick = () => tLogin();
    tela.querySelector('#fCad').onsubmit = async ev => {
      ev.preventDefault(); const e = tela.querySelector('#cEmail').value.trim(), s = tela.querySelector('#cSenha').value;
      if (!e || s.length < 8) { tCadastro(e, 'Informe o e-mail e uma senha com pelo menos 8 caracteres.'); return; }
      const { data, error } = await sb.auth.signUp({ email: e, password: s, options: { emailRedirectTo: location.origin + location.pathname + location.search } });
      if (error) { tCadastro(e, 'Não foi possível criar a conta: ' + error.message); return; }
      if (data.session) await entrou(data.session);
      else tLogin('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre aqui.', true);
    };
  }

  function tNovaSenha(msg) {
    tela.hidden = false;
    tela.innerHTML = `<div class="ac">${topo('Definir senha')}
      <p>Crie a senha que você vai usar para entrar no painel${usuario ? ' com <b>' + esc(usuario.email) + '</b>' : ''}.</p>
      ${msg ? `<div class="am" role="alert">${esc(msg)}</div>` : ''}
      <form id="fNs" novalidate><label>Nova senha (mínimo 8 caracteres)<input id="nS1" type="password" autocomplete="new-password"></label>
      <label>Repita a senha<input id="nS2" type="password" autocomplete="new-password"></label>
      <button class="ab" id="nOk">Salvar senha e entrar</button></form></div>`;
    tela.querySelector('#nS1').focus();
    tela.querySelector('#fNs').onsubmit = async ev => {
      ev.preventDefault(); const a = tela.querySelector('#nS1').value, b2 = tela.querySelector('#nS2').value;
      if (a.length < 8) { tNovaSenha('A senha precisa ter pelo menos 8 caracteres.'); return; }
      if (a !== b2) { tNovaSenha('As duas senhas não são iguais.'); return; }
      const b = tela.querySelector('#nOk'); b.disabled = true; b.textContent = 'Salvando…';
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) { tNovaSenha('Não foi possível salvar: ' + error.message); return; }
      precisaSenha = false; history.replaceState(null, '', location.pathname + location.search);
      const { data } = await sb.auth.getSession(); await entrou(data.session);
    };
  }

  function tSemAcesso() {
    tela.hidden = false;
    tela.innerHTML = `<div class="ac">${topo('Acesso pendente')}
      <p>Você entrou como <b>${esc(usuario && usuario.email)}</b>, mas este e-mail ainda não foi liberado no painel.</p>
      <p>Peça ao administrador para incluir o seu e-mail na lista de membros. Depois é só recarregar a página.</p>
      <div class="ar"><button class="ab" id="sRec" type="button">Recarregar</button><button class="al" id="sSair" type="button">Entrar com outro e-mail</button></div></div>`;
    tela.querySelector('#sRec').onclick = () => location.reload();
    tela.querySelector('#sSair').onclick = sair;
  }

  function tCarregando(t) {
    tela.hidden = false;
    tela.innerHTML = `<div class="ac">${topo(esc(nomeSistema))}<p>${esc(t || 'Verificando acesso…')}</p></div>`;
  }

  async function sair() { try { await sb.auth.signOut(); } catch (e) {} location.reload(); }

  function mostrarQuem() {
    const h = document.querySelector('.hctl'); if (!h || document.getElementById('bSair')) return;
    const q = document.createElement('span'); q.className = 'quem'; q.textContent = usuario.email + (papel === 'leitor' ? ' · leitura' : '');
    q.title = 'Conectado como ' + usuario.email + (papel === 'leitor' ? ' (somente leitura)' : '');
    const b = document.createElement('button'); b.className = 'hbtn'; b.id = 'bSair'; b.textContent = 'Sair'; b.onclick = sair;
    h.appendChild(q); h.appendChild(b);
    if (papel === 'leitor') { const r = document.getElementById('bReset'); if (r) r.hidden = true; }
  }

  async function entrou(sessao) {
    if (!sessao) { tLogin(); return; }
    usuario = sessao.user;
    if (precisaSenha) { tNovaSenha(); return; }
    if (iniciou) { tela.hidden = true; return; }
    tCarregando('Verificando acesso…');
    const { data, error } = await sb.from('membros').select('papel').limit(1);
    if (error) { tLogin('Não foi possível verificar o acesso: ' + error.message); return; }
    papel = data && data[0] && data[0].papel;
    if (!papel) { tSemAcesso(); return; }
    iniciou = true; tela.hidden = true; tela.innerHTML = '';
    window.Nuvem = { db, assets, obras, blobUrl, ferramenta, obraId, painel, papel, usuario, sair, cliente: sb };
    mostrarQuem(); ligarAoVivo();
    pronto(window.Nuvem);
  }

  sb.auth.onAuthStateChange((ev, sessao) => {
    if (ev === 'PASSWORD_RECOVERY') { precisaSenha = true; usuario = sessao && sessao.user; tNovaSenha(); }
    else if (ev === 'SIGNED_OUT' && iniciou) location.reload();
  });

  tCarregando('Conectando…');
  sb.auth.getSession().then(({ data }) => entrou(data.session)).catch(() => tLogin());

  function mostrarFalha(t) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#22425c;color:#fff;padding:24px;font:16px system-ui;text-align:center';
    d.textContent = t; document.body.appendChild(d);
  }
})();
