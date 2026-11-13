/* =====================================================================
   Mapa de Risco — conexão com o banco online (Supabase) e tela de login
   ---------------------------------------------------------------------
   - Com o config.js preenchido: pede login, lê e grava tudo no Supabase
     e atualiza a tela quando outra pessoa salva alguma coisa.
   - Obras: cadastro comum (nome + modelo IFC) usado por todas as ferramentas.
     Cada ferramenta guarda os dados dela em painel = "ferramenta:obra".
   - Perfis: cada pessoa tem um perfil (Administrador, Engenharia, Segurança,
     Campo ou Consulta) e vê só as obras liberadas para ela.
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

  /* ---------------- perfis: o que cada um vê e edita ---------------- */
  const PERFIS = { admin: 'Administrador', engenharia: 'Engenharia', seguranca: 'Segurança', campo: 'Campo', consulta: 'Consulta', almoxarifado: 'Almoxarifado' };
  const FERR_NOMES = [['risco', 'Mapa de Risco'], ['concretagem', 'Mapa de Concretagem'], ['fachada', 'Mapa de Fachadas'], ['pendencias', 'Pendências'], ['personalizacao', 'Personalizações'], ['ceramica', 'Cerâmicas']];
  // personalizacao: Campo vê as que afetam os seus ofícios (para dar "Estou ciente")
  // ceramica: Almoxarifado recebe pallets e registra entregas (só essa ferramenta)
  const VE = { admin: ['risco', 'concretagem', 'fachada', 'pendencias', 'personalizacao', 'ceramica'], engenharia: ['risco', 'concretagem', 'fachada', 'pendencias', 'personalizacao', 'ceramica'],
    seguranca: ['risco', 'pendencias'], campo: ['pendencias', 'personalizacao'], consulta: ['risco', 'concretagem', 'fachada', 'pendencias', 'personalizacao', 'ceramica'], almoxarifado: ['ceramica'] };
  const EDITA = { admin: ['risco', 'concretagem', 'fachada', 'personalizacao', 'ceramica'], engenharia: ['risco', 'concretagem', 'fachada', 'personalizacao', 'ceramica'], seguranca: ['risco'], campo: [], consulta: [], almoxarifado: ['ceramica'] };
  const podeVer = f => (VE[perfil] || []).includes(f);
  const podeEditar = f => (EDITA[perfil] || []).includes(f);
  const temObra = id => obrasLib === null || obrasLib.includes(id);
  function aplicarPerfil(p, ofs, obs) {
    perfil = PERFIS[p] ? p : 'consulta';
    admin = perfil === 'admin';
    papel = ['admin', 'engenharia', 'seguranca'].includes(perfil) ? 'editor' : 'leitor';
    cargo = { admin: 'engenharia', engenharia: 'engenharia', seguranca: 'seguranca', campo: 'encarregado' }[perfil] || null;
    disciplinas = Array.isArray(ofs) ? ofs : [];
    obrasLib = admin || !Array.isArray(obs) ? null : obs;
  }
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
  let usuario = null, papel = null, admin = false, cargo = null, disciplinas = [], offline = false, iniciou = false;
  // perfil: admin | engenharia | seguranca | campo | consulta; obrasLib: null = todas as obras
  let perfil = null, obrasLib = null;

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
  const OBRA_COLS = 'id,nome,modelo,modelos,foto,criado_em,criado_por,atualizado_em,atualizado_por';
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
    // extra.id fixa o endereço (se já existir, devolve a obra que está lá);
    // os outros campos de extra (modelo, foto) entram junto.
    async criar(nome, extra) {
      extra = Object.assign({}, extra);
      const fixo = extra.id; delete extra.id;
      if (fixo) {
        const { data, error } = await sb.from('obras')
          .insert(Object.assign({ id: fixo, nome, criado_por: email(), atualizado_por: email() }, extra)).select(OBRA_COLS).single();
        if (!error) return data;
        if (String(error.code) !== '23505') throw erro(error);
        return obras.obter(fixo);
      }
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
    // manda a obra para a lixeira (30 dias; o administrador pode restaurar)
    async apagar(id, ferramentas) {
      const r = await sb.rpc('obra_excluir', { p_id: id });
      if (!r.error) return;
      // banco ainda sem lixeira (banco.sql não rodado): apaga de vez, como antes
      if (!/obra_excluir|function|schema cache/i.test(r.error.message || '')) throw erro(r.error);
      return obras.apagarDeVez(id, ferramentas);
    },
    // trocar o modelo guardando o anterior no histórico (até 5 versões)
    async trocarModelo(id, modelo, base) {
      const o = await obras.obter(id);
      const ant = o && o.modelo && o.modelo.asset ? [Object.assign({}, o.modelo, { substituido_em: new Date().toISOString(), substituido_por: email() })] : [];
      const hist = ant.concat((o && o.modelos) || []).filter(m => m && m.asset && m.asset !== modelo.asset);
      const sobra = hist.slice(5);
      const r = await obras.alterar(id, { modelo, modelos: hist.slice(0, 5) }, base);
      for (const m of sobra) obras.apagarArquivo(m.asset).catch(() => {});
      return r;
    },
    async apagarDeVez(id, ferramentas) {
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
  /* ---------------- nomes das pessoas ---------------- */
  // tabela perfis (email -> nome). Se ainda não existir no banco, tudo continua
  // funcionando e as telas mostram a parte do e-mail antes do @.
  const nomes = new Map();
  let temPerfis = false;
  const pessoas = {
    async carregar() {
      const { data, error } = await sb.from('perfis').select('email,nome');
      if (error) { temPerfis = false; return; }
      temPerfis = true; nomes.clear();
      for (const p of data || []) if (p.nome) nomes.set(String(p.email).toLowerCase(), p.nome);
      try { localStorage.setItem('mr_nomes', JSON.stringify([...nomes])); } catch (e) {}
    },
    // nomes guardados da última vez (para a página abrir sem esperar o servidor)
    usarGuardados() {
      try { const l = JSON.parse(localStorage.getItem('mr_nomes') || 'null'); if (Array.isArray(l)) { nomes.clear(); for (const [e, n] of l) nomes.set(e, n); temPerfis = true; } } catch (e) {}
    },
    disponivel() { return temPerfis; },
    // nome para mostrar: o cadastrado, ou o começo do e-mail
    nome(e) {
      if (!e) return 'alguém';
      return nomes.get(String(e).toLowerCase()) || String(e).split('@')[0];
    },
    temNome(e) { return !!(e && nomes.has(String(e).toLowerCase())); },
    async salvarNome(e, nome) {
      nome = String(nome || '').trim().slice(0, 80);
      const { error } = await sb.from('perfis').upsert({ email: String(e).toLowerCase(), nome, atualizado_em: new Date().toISOString() });
      if (error) throw erro(error);
      if (nome) nomes.set(String(e).toLowerCase(), nome); else nomes.delete(String(e).toLowerCase());
    },
  };

  /* ---------------- administração (só administradores) ---------------- */
  const administracao = {
    // todas as contas criadas e os e-mails liberados, com papel e nome
    async listar() {
      const { data, error } = await sb.rpc('admin_usuarios');
      if (error) throw erro(error);
      return data || [];
    },
    // perfil: 'admin' | 'engenharia' | 'seguranca' | 'campo' | 'consulta' | 'nenhum' (bloqueia);
    // ofícios e obras: null = mantém como está
    async definirPerfil(email, perfil, oficios, obras) {
      const { error } = await sb.rpc('admin_definir_perfil', { alvo: email, novo_perfil: perfil,
        novos_oficios: oficios == null ? null : oficios, novas_obras: obras == null ? null : obras });
      if (error) throw erro(error);
    },
    // versão do banco (null = banco sem o banco.sql)
    async versaoBanco() {
      const { data, error } = await sb.rpc('banco_versao');
      return error ? null : data;
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
  #authTela .ak img{width:30px;height:30px;flex:none}
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
  .hctl .quem{font:600 .8rem var(--f-body,sans-serif);color:#d4e4ee;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    background:none;border:0;border-bottom:1px dashed rgba(255,255,255,.35);padding:0;cursor:pointer}
  .hctl .quem:hover{color:#fff}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const tela = document.createElement('div'); tela.id = 'authTela'; tela.setAttribute('role', 'dialog');
  tela.setAttribute('aria-modal', 'true'); tela.setAttribute('aria-label', 'Entrar');
  document.body.appendChild(tela);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // título, subtítulo e ícone da tela de login/carregamento, conforme a página aberta
  const MARCAS = {
    risco: { kick: 'Segurança do trabalho · NR-5', titulo: 'Mapa de Risco',
      icone: '<img src="icones/risco.svg" alt="">' },
    concretagem: { kick: 'Rastreabilidade do concreto', titulo: 'Mapa de Concretagem',
      icone: '<img src="icones/concretagem.svg" alt="">' },
    fachada: { kick: 'Revestimento e pintura', titulo: 'Mapa de Fachadas',
      icone: '<img src="icones/fachadas.svg" alt="">' },
    pendencias: { kick: 'Acabamentos · retrabalhos', titulo: 'Pendências de obra',
      icone: '<img src="icones/pendencias.svg" alt="">' },
    '': { kick: 'Engenharia e segurança', titulo: C.titulo || 'Ferramentas da Obra',
      icone: '<img src="icones/principal.svg" alt="">' }
  };
  const MARCA = MARCAS[ferramenta] || MARCAS[''];
  const topo = (titulo) => `<div class="ak">${MARCA.icone}<span>${esc(MARCA.kick)}</span></div><h1>${titulo}</h1>`;
  const nomeSistema = MARCA.titulo;
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

  function tSemFerramenta() {
    tela.hidden = false;
    const ve = FERR_NOMES.filter(f => podeVer(f[0])).map(f => '<b>' + f[1] + '</b>');
    const lista = ve.length > 1 ? ve.slice(0, -1).join(', ') + ' e ' + ve[ve.length - 1] : ve.join('');
    tela.innerHTML = `<div class="ac">${topo('Sem acesso a esta ferramenta')}
      <p>O seu perfil (${esc(PERFIS[perfil] || perfil)}) dá acesso a ${lista || 'nenhuma ferramenta'}.</p>
      <div class="ar"><a class="ab" href="index.html${obraId ? '?obra=' + encodeURIComponent(obraId) : ''}" style="text-decoration:none">Voltar</a><button class="al" id="sSair" type="button">Sair</button></div></div>`;
    tela.querySelector('#sSair').onclick = sair;
  }
  function tSemObra() {
    tela.hidden = false;
    tela.innerHTML = `<div class="ac">${topo('Sem acesso a esta obra')}
      <p>Você não faz parte desta obra. Peça a um administrador para incluir você nela.</p>
      <div class="ar"><a class="ab" href="index.html" style="text-decoration:none">Ver as minhas obras</a><button class="al" id="sSair" type="button">Sair</button></div></div>`;
    tela.querySelector('#sSair').onclick = sair;
  }
  const semRede = e => !navigator.onLine || /fetch|network|Failed|conex/i.test(String((e && e.message) || e));

  function tCarregando(t) {
    tela.hidden = false;
    tela.innerHTML = `<div class="ac">${topo(esc(nomeSistema))}<p>${esc(t || 'Verificando acesso…')}</p></div>`;
  }

  async function sair() { try { await sb.auth.signOut(); } catch (e) {} location.reload(); }

  // pergunta o nome da pessoa (primeiro acesso ou clique no nome no cabeçalho)
  function tNome(primeira, msg) {
    tela.hidden = false;
    const atual = pessoas.temNome(usuario.email) ? pessoas.nome(usuario.email) : '';
    tela.innerHTML = `<div class="ac">${topo(primeira ? 'Bem-vindo' : 'Seu nome')}
      <p>${primeira ? 'Como você quer ser chamado? ' : ''}Este nome aparece para a equipe no lugar do e-mail (<b>${esc(usuario.email)}</b>), por exemplo em “editada por”.</p>
      ${msg ? `<div class="am" role="alert">${esc(msg)}</div>` : ''}
      <form id="fNome" novalidate><label>Nome<input id="pNome" maxlength="80" autocomplete="name" value="${esc(atual)}" placeholder="Ex.: Lucas Lima"></label>
      <button class="ab" id="pOk">Salvar</button></form>
      <div class="ar"><button class="al" id="pPula" type="button">${primeira ? 'Agora não' : 'Cancelar'}</button></div></div>`;
    tela.querySelector('#pNome').focus();
    const seguir = () => { if (iniciou) { tela.hidden = true; tela.innerHTML = ''; atualizarQuem(); } else liberar(); };
    tela.querySelector('#pPula').onclick = () => { try { sessionStorage.setItem('mr_pulou_nome', '1'); } catch (e) {} seguir(); };
    tela.querySelector('#fNome').onsubmit = async ev => {
      ev.preventDefault(); const n = tela.querySelector('#pNome').value.trim();
      if (!n) { tNome(primeira, 'Escreva o seu nome.'); return; }
      const b = tela.querySelector('#pOk'); b.disabled = true; b.textContent = 'Salvando…';
      try { await pessoas.salvarNome(usuario.email, n); seguir(); }
      catch (e) { tNome(primeira, 'Não foi possível salvar: ' + e.message); }
    };
  }
  const rotQuem = () => pessoas.nome(usuario.email) + (perfil ? ' · ' + (PERFIS[perfil] || perfil) : '');
  function atualizarQuem() {
    const q = document.getElementById('bQuem'); if (!q) return;
    q.textContent = rotQuem();
  }

  function mostrarQuem() {
    const h = document.querySelector('.hctl'); if (!h || document.getElementById('bSair')) return;
    const q = document.createElement('button'); q.type = 'button'; q.id = 'bQuem'; q.className = 'quem';
    q.textContent = rotQuem();
    q.title = 'Conectado como ' + usuario.email + ' · perfil ' + (PERFIS[perfil] || perfil) + (ferramenta && ferramenta !== 'pendencias' && !podeEditar(ferramenta) ? ' (só visualizar)' : '') + (pessoas.disponivel() ? '. Clique para mudar o seu nome.' : '');
    if (pessoas.disponivel()) q.onclick = () => tNome(false);
    const b = document.createElement('button'); b.className = 'hbtn'; b.id = 'bSair'; b.textContent = 'Sair'; b.onclick = sair;
    h.appendChild(q);
    // "Sair" vai para o menu da engrenagem quando ele existe (app.js)
    if (window.AppObra && window.AppObra.paraMenu) window.AppObra.paraMenu(b); else h.appendChild(b);
    // resetar um mapa: só administradores (o conteúdo vai para a lixeira)
    if (!admin) { const r = document.getElementById('bReset'); if (r) r.hidden = true; }
  }

  async function entrou(sessao) {
    if (!sessao) { tLogin(); return; }
    usuario = sessao.user;
    if (precisaSenha) { tNovaSenha(); return; }
    if (iniciou) { tela.hidden = true; return; }
    const chave = 'mr_acesso_' + String(usuario.email).toLowerCase();
    // já entrou neste aparelho: abre a página direto com o acesso guardado
    // e confere no servidor por trás (se mudou, a página recarrega sozinha)
    let guardado = null; try { guardado = JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) {}
    if (guardado && guardado.perfil) {
      aplicarPerfil(guardado.perfil, guardado.oficios, guardado.obras);
      pessoas.usarGuardados();
      liberar();
      conferirPorTras(chave, guardado);
      return;
    }
    tCarregando('Verificando acesso…');
    // meu_acesso(): perfil, ofícios e obras liberadas (null = sem acesso)
    let { data, error } = await sb.rpc('meu_acesso');
    let antigo = false;
    if (error && !semRede(error) && /meu_acesso|function|schema cache/i.test(error.message || '')) {
      // banco ainda sem perfis (banco.sql não rodado): usa o acesso antigo
      antigo = true; ({ data, error } = await sb.rpc('papel_atual'));
    }
    if (error) {
      // sem sinal: usa o último acesso confirmado neste aparelho (para registrar pendências na obra)
      let ult = null; try { ult = JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) {}
      if (semRede(error) && ult && ult.perfil) {
        aplicarPerfil(ult.perfil, ult.oficios, ult.obras); offline = true;
        liberar(); return;
      }
      tLogin('Não foi possível verificar o acesso: ' + error.message); return;
    }
    if (antigo) {
      const p = typeof data === 'string' ? data : null;
      if (!p) { try { localStorage.removeItem(chave); } catch (e) {} tSemAcesso(); return; }
      let adm = false, cg = null, ds = [];
      try { const r = await sb.rpc('eh_admin'); adm = !r.error && r.data === true; } catch (e) {}
      try { const r = await sb.rpc('meu_cargo'); if (!r.error && r.data) { cg = r.data.cargo || null; ds = r.data.disciplinas || []; } } catch (e) {}
      aplicarPerfil(adm ? 'admin' : cg === 'encarregado' ? 'campo' : cg || (p === 'editor' ? 'engenharia' : 'consulta'), ds, null);
    } else {
      if (!data || !data.perfil) { try { localStorage.removeItem(chave); } catch (e) {} tSemAcesso(); return; }
      aplicarPerfil(data.perfil, data.oficios, data.obras);
    }
    try { localStorage.setItem(chave, JSON.stringify({ perfil, oficios: disciplinas, obras: obrasLib })); } catch (e) {}
    try { await pessoas.carregar(); } catch (e) {}
    let pulou = false; try { pulou = !!sessionStorage.getItem('mr_pulou_nome'); } catch (e) {}
    if (pessoas.disponivel() && !pessoas.temNome(usuario.email) && !pulou) { tNome(true); return; }
    liberar();
  }
  // confere o acesso guardado; se mudou (perfil, ofícios, obras) ou foi tirado, recarrega
  async function conferirPorTras(chave, guardado) {
    let { data, error } = await sb.rpc('meu_acesso');
    if (error && !semRede(error) && /meu_acesso|function|schema cache/i.test(error.message || '')) {
      // banco sem perfis: só confere se ainda tem acesso
      const r = await sb.rpc('papel_atual'); if (!r.error && !r.data) { try { localStorage.removeItem(chave); } catch (e) {} location.reload(); }
      return;
    }
    if (error) { if (semRede(error)) { offline = true; if (window.Nuvem) window.Nuvem.offline = true; } return; }
    if (!data || !data.perfil) { try { localStorage.removeItem(chave); } catch (e) {} location.reload(); return; }
    const novo = { perfil: data.perfil, oficios: Array.isArray(data.oficios) ? data.oficios : [], obras: data.perfil === 'admin' || !Array.isArray(data.obras) ? null : data.obras };
    const igual = JSON.stringify([novo.perfil, [...novo.oficios].sort(), novo.obras && [...novo.obras].sort()])
      === JSON.stringify([guardado.perfil, [...(guardado.oficios || [])].sort(), guardado.obras && [...guardado.obras].sort()]);
    try { localStorage.setItem(chave, JSON.stringify(novo)); } catch (e) {}
    if (!igual) { location.reload(); return; }
    try { await pessoas.carregar(); atualizarQuem(); } catch (e) {}
  }
  function liberar() {
    if (iniciou) return;
    // cada perfil vê só as suas ferramentas, e cada pessoa só as suas obras
    if (ferramenta && !podeVer(ferramenta)) { tSemFerramenta(); return; }
    if (obraId && !temObra(obraId)) { tSemObra(); return; }
    iniciou = true; tela.hidden = true; tela.innerHTML = '';
    window.Nuvem = { db, assets, obras, pessoas, blobUrl, ferramenta, obraId, painel, offline,
      // perfil e o que ele permite
      perfil, perfilNome: PERFIS[perfil] || perfil, PERFIS, oficios: disciplinas, obrasLiberadas: obrasLib,
      podeVer, podeEditar, temObra,
      // nomes antigos (as telas ainda usam): papel = edita a ferramenta desta página
      papel: ferramenta && ferramenta !== 'pendencias' ? (podeEditar(ferramenta) ? 'editor' : 'leitor') : papel,
      admin, cargo, disciplinas,
      administracao, usuario, sair, cliente: sb };
    mostrarQuem(); ligarAoVivo();
    pronto(window.Nuvem);
  }

  sb.auth.onAuthStateChange((ev, sessao) => {
    if (ev === 'PASSWORD_RECOVERY') { precisaSenha = true; usuario = sessao && sessao.user; tNovaSenha(); }
    else if (ev === 'SIGNED_OUT' && iniciou) location.reload();
  });

  sb.auth.getSession().then(({ data }) => entrou(data.session)).catch(() => tLogin());

  function mostrarFalha(t) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#22425c;color:#fff;padding:24px;font:16px system-ui;text-align:center';
    d.textContent = t; document.body.appendChild(d);
  }
})();
