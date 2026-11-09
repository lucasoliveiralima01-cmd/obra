/* =====================================================================
   Peças comuns a todas as páginas
   - App instalável: registra o sw.js e mostra o botão "Instalar app".
   - Tema: automático (segue o aparelho), claro ou escuro.
   - Menu da engrenagem (configurações) no topo: junta as ações secundárias (botões com data-menu).
   - Nas ferramentas: abas para trocar de ferramenta na mesma obra e o
     nome da obra vira um seletor para trocar de obra.
   ===================================================================== */
(function () {
  'use strict';
  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FERR = [
    { id: 'risco', nome: 'Riscos', pag: 'risco.html' },
    { id: 'concretagem', nome: 'Concretagens', pag: 'concretagem.html' },
    { id: 'fachada', nome: 'Fachadas', pag: 'fachadas.html' },
    { id: 'pendencias', nome: 'Pendências', pag: 'pendencias.html' }
  ];

  /* ---------------- tema ---------------- */
  const lerTema = () => { try { return localStorage.getItem('obra_tema') || ''; } catch (e) { return ''; } };
  function aplicarTema(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('obra_tema', t || ''); } catch (e) {}
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = '#22425c';
    document.querySelectorAll('[data-tema]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tema === (t || ''))));
  }
  aplicarTema(lerTema());

  /* ---------------- estilos das peças ---------------- */
  const css = `
  .mo-btn{line-height:1;padding:5px 8px!important}.mo-btn svg{display:block}
  .mo-painel{position:fixed;z-index:60;min-width:230px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 80px);overflow:auto;background:var(--panel,#fff);color:var(--ink,#14222e);
    border:1px solid var(--line,#d3dce3);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.28);padding:6px;display:grid;gap:2px}
  .mo-painel .hbtn,.mo-painel a.hbtn{all:unset;box-sizing:border-box;display:flex;gap:8px;align-items:center;width:100%;padding:9px 10px;border-radius:7px;cursor:pointer;
    font:600 .9rem var(--f-body,system-ui,sans-serif);color:var(--ink,#14222e)}
  .mo-painel .hbtn:hover,.mo-painel .hbtn:focus-visible{background:var(--accent-soft,#dcebf2)}
  .mo-painel .hbtn[hidden]{display:none!important}
  .mo-painel .mo-est{margin-left:auto;padding-left:14px;font:600 .8rem var(--f-body,sans-serif);color:var(--accent,#074669)}
  .mo-painel .mo-est.off{color:var(--muted,#5a6b78)}
  .hctl>.hbtn .mo-est{margin-left:6px;opacity:.8}
  .mo-painel .mo-sep{height:1px;background:var(--line,#d3dce3);margin:4px 2px}
  .mo-painel .mo-tit{font:600 .68rem var(--f-disp,sans-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#5a6b78);padding:4px 10px 2px}
  .mo-tema{display:flex;gap:4px;padding:2px 6px 4px}
  .mo-tema button{flex:1;background:var(--bg,#eef2f5);border:1px solid var(--line,#d3dce3);border-radius:7px;padding:6px 4px;font:600 .8rem var(--f-body,sans-serif);color:var(--muted,#5a6b78);cursor:pointer}
  .mo-tema button[aria-pressed="true"]{background:var(--accent,#074669);border-color:var(--accent,#074669);color:var(--accent-ink,#fff)}
  .mo-abas{display:inline-flex;gap:2px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:2px;flex-wrap:wrap}
  .mo-abas a{color:#d4e4ee;text-decoration:none;font:600 .8rem var(--f-body,sans-serif);padding:4px 10px;border-radius:6px;white-space:nowrap}
  .mo-abas a:hover{background:rgba(255,255,255,.15);color:#fff}
  .mo-abas a[aria-current="page"]{background:#fff;color:#22425c}
  #obraNome.mo-trocar{cursor:pointer;background:none;border:0;border-bottom:1px dashed rgba(255,255,255,.35);padding:0;color:#d4e4ee;font:inherit;font-size:.82rem;text-align:left}
  #obraNome.mo-trocar::after{content:" ▾";opacity:.8}
  #obraNome.mo-trocar:hover{color:#fff}
  .mo-obras{display:grid;gap:2px;max-height:52dvh;overflow:auto}
  .mo-obras a{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:7px;color:var(--ink,#14222e);text-decoration:none;font:600 .92rem var(--f-body,sans-serif)}
  .mo-obras a:hover{background:var(--accent-soft,#dcebf2)}
  .mo-obras a[aria-current="true"]{background:var(--accent-soft,#dcebf2)}
  .mo-obras a[aria-current="true"]::after{content:"atual";font:500 .72rem var(--f-mono,monospace);color:var(--muted,#5a6b78)}
  .mo-busca{background:var(--bg,#eef2f5);border:1px solid var(--line,#d3dce3);border-radius:7px;padding:8px 10px;margin:2px 4px 6px;color:var(--ink,#14222e);font:inherit}
  .mo-trilha{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;padding:8px max(12px,env(safe-area-inset-right,0px)) 0 max(12px,env(safe-area-inset-left,0px))}
  .mo-crumbs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font:.86rem var(--f-body,sans-serif);color:var(--muted,#5a6b78)}
  .mo-crumbs a{font-weight:600;text-decoration:none;color:var(--accent,#074669)} .mo-crumbs a:hover{text-decoration:underline}
  .mo-acoes{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .mo-acoes:empty{display:none}
  .mo-trilha .hbtn{background:var(--panel,#fff);color:var(--ink,#14222e);border:1px solid var(--line,#d3dce3);border-radius:8px;padding:6px 14px;font:600 .86rem var(--f-body,sans-serif);display:inline-flex;gap:6px;align-items:center;white-space:nowrap;cursor:pointer}
  .mo-trilha .hbtn:hover{border-color:var(--accent,#074669);background:var(--panel,#fff)}
  .mo-trilha .hbtn[hidden]{display:none}
  .mo-trilha .hbtn.pendchip{background:var(--warn-soft,#fbecd2);color:var(--warn,#b86e00);border-color:var(--warn,#b86e00)}
  .mo-trilha .hbtn.alerta{background:var(--bad-soft,#f8e0dc);color:var(--bad,#c23b2f);border-color:var(--bad,#c23b2f)}
  @media (max-width:640px){.mo-abas{width:100%;justify-content:space-between;order:3}.mo-abas a{flex:1;text-align:center;padding:6px 4px}
    .brand .hctl{width:auto;margin-left:auto;order:2}
    .brand .ttl{width:auto;flex:1 1 0;min-width:0}
    .brand #bQuem{display:none}
    .mo-trilha .hbtn{padding:5px 10px;font-size:.8rem}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------------- janelinha flutuante (menu e lista de obras) ---------------- */
  let aberto = null;
  // os botões do menu ficam guardados (escondidos) na página: assim continuam
  // achados pelo id e com as ações de sempre
  let guarda = null;
  const guardar = b => { if (!guarda) { guarda = document.createElement('div'); guarda.id = 'moGuarda'; guarda.hidden = true; document.body.appendChild(guarda); } guarda.appendChild(b); };
  function fechar() { if (aberto) { aberto.querySelectorAll('.hbtn[data-guardado]').forEach(guardar); aberto.remove(); aberto = null; } }
  function abrirPainel(ancora, conteudo) {
    fechar();
    const p = document.createElement('div'); p.className = 'mo-painel'; p.setAttribute('role', 'menu');
    if (typeof conteudo === 'string') p.innerHTML = conteudo; else p.appendChild(conteudo);
    document.body.appendChild(p); aberto = p;
    const r = ancora.getBoundingClientRect(); const w = p.offsetWidth;
    p.style.top = Math.round(r.bottom + 6) + 'px';
    p.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
    if (r.left + w < window.innerWidth - 8 && ancora.id === 'obraNome') p.style.left = Math.round(Math.max(8, r.left)) + 'px';
    return p;
  }
  document.addEventListener('click', ev => { if (aberto && !aberto.contains(ev.target) && !ev.target.closest('.mo-btn,#obraNome')) fechar(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') fechar(); });
  window.addEventListener('resize', fechar);

  /* ---------------- menu "⋯" ---------------- */
  const itens = [];   // botões guardados no menu (mantêm as ações originais)
  const extras = [];  // itens criados aqui (ex.: dados da obra)
  function paraMenu(b) { if (!b || itens.includes(b)) return; itens.push(b); b.dataset.guardado = '1'; guardar(b); garantirBotao(); }
  function itemMenu(rotulo, acao) { const b = document.createElement('button'); b.type = 'button'; b.className = 'hbtn'; b.textContent = rotulo; b.onclick = acao; b.dataset.guardado = '1'; extras.push(b); guardar(b); garantirBotao(); return b; }
  function garantirBotao() {
    if (document.getElementById('bMais')) return;
    const h = document.querySelector('.hctl'); if (!h) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hbtn mo-btn'; b.id = 'bMais';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M10.3 2.8h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9-2.6-.5v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    b.title = 'Configurações'; b.setAttribute('aria-label', 'Configurações'); b.setAttribute('aria-haspopup', 'menu');
    b.onclick = ev => {
      ev.stopPropagation(); if (aberto && aberto.dataset.menu) { fechar(); return; }
      const box = document.createElement('div'); box.style.display = 'contents';
      // "Sair" sempre por último
      const vis = itens.concat(extras).filter(x => !x.hidden).sort((a, b) => (a.id === 'bSair') - (b.id === 'bSair'));
      vis.forEach(x => { box.appendChild(x); x.addEventListener('click', fechar, { once: true }); });
      if (vis.length) { const s = document.createElement('div'); s.className = 'mo-sep'; box.appendChild(s); }
      const t = document.createElement('div'); t.innerHTML = '<div class="mo-tit">Tema</div><div class="mo-tema"><button type="button" data-tema="">Automático</button><button type="button" data-tema="light">Claro</button><button type="button" data-tema="dark">Escuro</button></div>';
      box.appendChild(t);
      const p = abrirPainel(b, box); p.dataset.menu = '1';
      p.querySelectorAll('[data-tema]').forEach(x => x.onclick = () => aplicarTema(x.dataset.tema));
      aplicarTema(lerTema());
    };
    // fica antes do nome e do "Sair"
    const quem = document.getElementById('bQuem'); if (quem) h.insertBefore(b, quem); else h.appendChild(b);
  }
  function montarMenu() {
    document.querySelectorAll('.hctl [data-menu]').forEach(paraMenu);
    garantirBotao();
  }

  /* ---------------- caminho e ações principais (nos mapas) ---------------- */
  function montarTrilha(id, atual, temObra) {
    const topo = document.querySelector('header.brand'); if (!topo || document.querySelector('.mo-trilha')) return;
    const bo = document.getElementById('bObras'); if (bo) bo.hidden = true;
    const nomeF = (FERR.find(f => f.id === atual) || {}).nome || '';
    const t = document.createElement('div'); t.className = 'mo-trilha';
    t.innerHTML = `<nav class="mo-crumbs" aria-label="Caminho"><a href="index.html">Obras</a><span>›</span>${temObra ? `<a href="index.html?obra=${encodeURIComponent(id)}" class="mo-cobra"></a>` : '<span class="mo-cobra"></span>'}<span>›</span><span>${esc(nomeF)}</span></nav><div class="mo-acoes"></div>`;
    const ac = t.querySelector('.mo-acoes');
    document.querySelectorAll('.hctl [data-barra]').forEach(b => ac.appendChild(b));
    topo.after(t);
    const pai = t.parentElement; if (pai && pai.classList.contains('app')) pai.style.gridTemplateRows = 'auto auto 1fr';
    // nome da obra: o cadastrado no banco; enquanto não chega, o do topo
    const on = document.getElementById('obraNome'), cob = t.querySelector('.mo-cobra');
    const provis = x => !x || /^(Carregando|Definir nome|Obra$)/.test(x);
    let real = '';
    const copia = () => {
      const topoTxt = on ? on.textContent.trim() : '';
      cob.textContent = real || (provis(topoTxt) ? 'Obra' : topoTxt);
      // o topo também mostra o nome cadastrado quando a página não tem um
      if (on && real && provis(topoTxt)) on.textContent = real;
    };
    copia(); if (on) new MutationObserver(copia).observe(on, { childList: true, characterData: true, subtree: true });
    Promise.resolve(window.NUVEM_PRONTA).then(nv => nv && nv.obras ? nv.obras.listar() : []).then(l => { const o = (l || []).find(x => x.id === id); if (o) { real = o.nome; copia(); } }).catch(() => {});
  }

  /* ---------------- abas e troca de obra (nas ferramentas) ---------------- */
  async function montarTroca(nv) {
    if (!nv || !nv.obraId || !nv.ferramenta) return;
    const id = nv.obraId, atual = nv.ferramenta;
    // só as ferramentas do perfil (Segurança: Risco e Pendências; Campo: só Pendências)
    const visiveis = FERR.filter(f => (nv.podeVer ? nv.podeVer(f.id) : !(nv.cargo === 'encarregado' && f.id !== 'pendencias')));
    // caminho "Obras › Obra › Ferramenta" logo abaixo do topo, com as ações principais da página (botões com data-barra)
    if (!document.querySelector('.crumbs')) montarTrilha(id, atual, visiveis.length > 1);
    // abas das ferramentas da mesma obra
    const ttl = document.querySelector('.brand .ttl');
    if (ttl && visiveis.length > 1 && !document.querySelector('.mo-abas')) {
      const n = document.createElement('nav'); n.className = 'mo-abas'; n.setAttribute('aria-label', 'Ferramentas desta obra');
      n.innerHTML = visiveis.map(f => `<a href="${f.pag}?obra=${encodeURIComponent(id)}" ${f.id === atual ? 'aria-current="page"' : ''}>${esc(f.nome)}</a>`).join('');
      ttl.after(n);
    }
    // nome da obra vira o seletor de obra; o que ele fazia antes vai para o menu
    const on = document.getElementById('obraNome'); if (!on) return;
    const antigo = on.onclick;
    if (antigo) itemMenu(atual === 'concretagem' ? 'Obra e concreteira padrão…' : 'Renomear a obra…', antigo);
    on.onclick = null; on.classList.add('mo-trocar'); on.setAttribute('role', 'button'); on.tabIndex = 0;
    on.title = 'Trocar de obra';
    let obras = null;
    const abrir = async ev => {
      if (ev) ev.stopPropagation();
      if (aberto && aberto.dataset.obras) { fechar(); return; }
      const box = document.createElement('div'); box.style.display = 'contents';
      box.innerHTML = '<div class="mo-tit">Trocar de obra</div><input class="mo-busca" type="search" placeholder="Buscar obra…" aria-label="Buscar obra"><div class="mo-obras"><span class="mo-tit" style="text-transform:none;letter-spacing:0">Carregando…</span></div><div class="mo-sep"></div><a class="hbtn" href="index.html">Ver todas as obras</a>';
      const p = abrirPainel(on, box); p.dataset.obras = '1';
      const pag = (FERR.find(f => f.id === atual) || {}).pag || 'index.html';
      const lista = p.querySelector('.mo-obras'), busca = p.querySelector('.mo-busca');
      const desenhar = () => { const q = busca.value.trim().toLowerCase(); const vis = (obras || []).filter(o => !q || o.nome.toLowerCase().includes(q));
        lista.innerHTML = vis.length ? vis.map(o => `<a href="${pag}?obra=${encodeURIComponent(o.id)}" aria-current="${o.id === id}">${esc(o.nome)}</a>`).join('') : '<span class="mo-tit" style="text-transform:none;letter-spacing:0">Nenhuma obra encontrada.</span>'; };
      busca.oninput = desenhar;
      try { if (!obras) obras = await nv.obras.listar(); desenhar(); }
      catch (e) { lista.innerHTML = '<span class="mo-tit" style="text-transform:none;letter-spacing:0">Sem conexão para listar as obras.</span>'; }
      if (window.matchMedia('(pointer:fine)').matches) busca.focus();
    };
    on.addEventListener('click', abrir);
    on.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(ev); } });
  }

  /* ---------------- instalar como app ---------------- */
  let pedido = null;
  function botaoInstalar() {
    if (!pedido || instalado() || document.getElementById('bInstalar')) return;
    const h = document.querySelector('.hctl'); if (!h) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hbtn'; b.id = 'bInstalar';
    b.textContent = '⬇ Instalar app'; b.title = 'Instala o painel como um aplicativo neste aparelho';
    b.onclick = async () => { const p = pedido; pedido = null; b.remove(); try { p.prompt(); await p.userChoice; } catch (e) {} };
    h.insertBefore(b, h.firstChild);
  }
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); pedido = ev; botaoInstalar(); });
  window.addEventListener('appinstalled', () => { pedido = null; const b = document.getElementById('bInstalar'); if (b) b.remove(); });

  window.AppObra = { ehIOS, instalado, registro: null, paraMenu, itemMenu, aplicarTema };
  if ('serviceWorker' in navigator) window.AppObra.registro = navigator.serviceWorker.register('sw.js').catch(e => { console.warn('sw', e); return null; });

  function iniciar() {
    montarMenu(); botaoInstalar();
    Promise.resolve(window.NUVEM_PRONTA).then(nv => { montarTroca(nv); garantirBotao(); }).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
