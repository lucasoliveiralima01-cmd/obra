/* =====================================================================
   Leitura dos PDFs do planejamento (gerados pelo Painel Pavei)
   - Médio prazo: seções (disciplinas) com Atividade · Local · Início · Término · Equipe · Situação,
     os avisos amarelos de cada seção e os Avisos gerais.
   - PCP (plano semanal): frentes (equipe · empresa), pessoas, itens e os dias marcados (2ª a Sáb).
   Lê o texto do PDF com a posição de cada palavra (pdf.js), monta as linhas e separa as colunas
   pelas posições do cabeçalho de cada tabela. Nada é adivinhado em silêncio: o que não deu para
   ler vai em "problemas", para a pessoa corrigir na revisão.
   Funciona no navegador (window.PlanoPDF) e no Node (module.exports), para os testes.
   ===================================================================== */
(function (root) {
  'use strict';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  // dd/mm/aaaa → aaaa-mm-dd (data que não existe → null)
  function dataBR(t) {
    const m = String(t || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3]; const o = new Date(Date.UTC(y, mo - 1, d));
    if (o.getUTCFullYear() !== y || o.getUTCMonth() !== mo - 1 || o.getUTCDate() !== d) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  /* ---------- PDF → páginas com as palavras e suas posições ---------- */
  let carregando = null;
  function pdfjs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (carregando) return carregando;
    carregando = new Promise((ok, erro) => {
      const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
      s.onload = () => { root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(root.pdfjsLib); };
      s.onerror = () => { carregando = null; erro(new Error('Não foi possível carregar o leitor de PDF (sem internet?).')); };
      document.head.appendChild(s);
    });
    return carregando;
  }
  async function paginas(dados, lib) {
    lib = lib || await pdfjs();
    const doc = await lib.getDocument({ data: dados }).promise; const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
      const items = [];
      for (const it of tc.items) { const s = (it.str || '').trim(); if (!s) continue;
        items.push({ s, x: it.transform[4], y: vp.height - it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]), f: it.fontName }); }
      out.push({ n: p, w: vp.width, h: vp.height, items });
    }
    return out;
  }
  // agrupa as palavras em linhas (mesma altura, com folga) e ordena da esquerda para a direita
  function linhas(pg, tol) {
    const its = pg.items.filter(i => i.y > 30 && i.y < pg.h - 20).sort((a, b) => a.y - b.y || a.x - b.x);   // sem cabeçalho e rodapé do navegador
    const L = [];
    for (const i of its) { const l = L.length && Math.abs(L[L.length - 1].y - i.y) <= tol ? L[L.length - 1] : null;
      if (l) l.items.push(i); else L.push({ y: i.y, items: [i], pag: pg.n }); }
    L.forEach(l => { l.items.sort((a, b) => a.x - b.x); l.h = Math.max(...l.items.map(i => i.h)); l.txt = l.items.map(i => i.s).join(' '); });
    return L;
  }
  const todasLinhas = (pags, tol) => pags.flatMap(p => linhas(p, tol));
  function tipo(pags) {
    const t = norm(pags.slice(0, 1).flatMap(p => p.items.map(i => i.s)).join(' '));
    if (/PLANEJAMENTO DE MEDIO PRAZO/.test(t)) return 'mp';
    if (/PLANO SEMANAL|PCP/.test(t) && /\b2ª|\b2A\b|SEMANA \d/.test(t)) return 'pcp';
    return null;
  }

  /* ---------- médio prazo ---------- */
  const COLS_MP = { ATIVIDADE: 'atividade', LOCAL: 'local', INICIO: 'inicio', TERMINO: 'termino', EQUIPE: 'equipe', SITUACAO: 'situacao' };
  function lerMP(pags) {
    const L = todasLinhas(pags, 2.2);
    const R = { tipo: 'mp', titulo: '', obra: '', reuniao: null, proxima: null, participantes: '', emitido: '', grupos: [], gerais: [], problemas: [] };
    const hs = L.filter(l => l.items.length >= 3).map(l => l.h).sort((a, b) => a - b); const hRow = hs.length ? hs[hs.length >> 1] : 8;
    let g = null, cols = null, ult = null, nota = null, notaY = 0, gerais = false, fonteTit = null;
    const novoGrupo = nome => { g = { nome, linhas: [], notas: [] }; R.grupos.push(g); cols = null; ult = null; nota = null; };
    for (let k = 0; k < L.length; k++) {
      const l = L[k], t = norm(l.txt);
      // título e cabeçalho do documento
      if (!R.titulo && /PLANEJAMENTO DE MEDIO PRAZO/.test(t)) { R.titulo = l.txt; const m = l.txt.split(/—|–| - /); R.obra = (m[1] || '').trim(); continue; }
      if (/^REUNIAO DE /.test(t)) { const d = l.txt.match(/(\d{2}\/\d{2}\/\d{4})/g) || []; R.reuniao = dataBR(d[0]); R.proxima = dataBR(d[1]); continue; }
      if (/^PARTICIPANTES/.test(t)) { R.participantes = l.txt.replace(/^Participantes:\s*/i, ''); continue; }
      if (/^EMITIDO PELO/.test(t)) { R.emitido = l.txt; gerais = false; continue; }
      // cabeçalho de uma tabela: guarda onde começa cada coluna
      const nh = l.items.map(i => norm(i.s));
      if (nh.includes('ATIVIDADE') && nh.includes('SITUACAO')) {
        cols = l.items.map(i => ({ k: COLS_MP[norm(i.s)], x: i.x })).filter(c => c.k).sort((a, b) => a.x - b.x);
        if (!g) novoGrupo('(sem nome)'); continue;
      }
      // título de seção: uma palavra/frase sozinha, maior que o texto das linhas
      if (l.items.length === 1 && l.h > hRow * 1.08 && !/^\d/.test(t)) {
        fonteTit = l.items[0].f;
        if (t === 'AVISOS GERAIS') { gerais = true; g = null; cols = null; continue; }
        gerais = false; novoGrupo(l.txt.trim()); continue;
      }
      if (gerais) { R.gerais.push(l.txt.trim()); continue; }
      if (!g || !cols) { if (t) R.problemas.push({ pag: l.pag, txt: l.txt, motivo: 'Linha fora de uma tabela' }); continue; }
      // separa as palavras pelas colunas
      const v = {}; for (const i of l.items) { let c = cols[0]; for (const cc of cols) if (i.x >= cc.x - 1.5) c = cc; v[c.k] = (v[c.k] ? v[c.k] + ' ' : '') + i.s; }
      const so = Object.keys(v);
      // aviso amarelo da seção: texto em negrito só na 1ª coluna (sem situação)
      const negrito = fonteTit && l.items[0].f === fonteTit;
      if (!v.situacao && so.length === 1 && so[0] === 'atividade' && (negrito || nota)) {
        const perto = nota && l.y - notaY < hRow * 1.45;
        if (perto) nota.texto += ' ' + l.txt.trim(); else if (negrito) { nota = { texto: l.txt.trim() }; g.notas.push(nota); }
        else { if (ult) ult.atividade += ' ' + l.txt.trim(); }
        notaY = l.y; continue;
      }
      nota = null;
      if (v.situacao) {   // linha nova (toda linha da tabela tem a situação)
        ult = { atividade: (v.atividade || '').trim(), local: (v.local || '').trim(), inicioTxt: (v.inicio || '').trim(), terminoTxt: (v.termino || '').trim(),
          equipe: (v.equipe || '').trim(), situacao: v.situacao.trim(), pag: l.pag };
        g.linhas.push(ult);
      } else if (ult) {   // continuação (texto quebrado em 2 linhas)
        for (const c of ['atividade', 'local', 'equipe', 'inicioTxt', 'terminoTxt']) { const kk = c.replace('Txt', ''); if (v[kk]) ult[c] = (ult[c] + ' ' + v[kk]).trim(); }
      } else R.problemas.push({ pag: l.pag, txt: l.txt, motivo: 'Linha sem atividade' });
    }
    for (const gg of R.grupos) for (const r of gg.linhas) {
      r.inicio = dataBR(r.inicioTxt); r.termino = dataBR(r.terminoTxt);
      r.concluida = /^CONCLUID/.test(norm(r.situacao));
    }
    return R;
  }

  /* ---------- PCP (plano semanal) ---------- */
  const DIAS = ['2ª', '3ª', '4ª', '5ª', '6ª', 'SÁB'];
  function lerPCP(pags) {
    const L = todasLinhas(pags, 3);
    const R = { tipo: 'pcp', titulo: '', semana: null, frentes: [], problemas: [] };
    let F = null, cols = null, ult = null;
    for (const l of L) {
      const t = norm(l.txt);
      if (!R.titulo && /PLANO SEMANAL/.test(t)) { R.titulo = l.items.filter(i => /plano semanal/i.test(i.s)).map(i => i.s).join(' ') || l.txt; }
      if (!R.semana) { const m = l.txt.match(/Semana\s+(\d{1,2})\/(\d{1,2})\s+a\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
        if (m) { const y2 = +m[5], y1 = +m[2] > +m[4] ? y2 - 1 : y2; R.semana = { ini: dataBR(m[1] + '/' + m[2] + '/' + y1), fim: dataBR(m[3] + '/' + m[4] + '/' + y2) }; continue; } }
      const nh = l.items.map(i => i.s.toUpperCase());
      if (nh[0] === 'ID' && nh.includes('2ª')) {   // cabeçalho de uma frente
        cols = { dias: DIAS.map(d => { const i = l.items.find(x => x.s.toUpperCase() === d); return i ? i.x + i.w / 2 : null; }),
          ok: (l.items.find(x => norm(x.s) === 'OK') || {}).x, motivo: (l.items.find(x => norm(x.s) === 'MOTIVO') || {}).x, ppc: (l.items.find(x => norm(x.s) === 'PPC') || {}).x,
          txt: (l.items[1] || {}).x || 60 };
        const nome = l.items.filter(i => i.x >= cols.txt - 1 && i.x < (cols.dias[0] || 400) - 20).map(i => i.s).join(' ');
        const m = nome.match(/^(.*?)\s*·\s*(.*?)(?:\s*\((\d+)\))?$/);
        F = { nome: (m ? m[1] : nome).trim(), empresa: m ? (m[2] || '').trim() : '', n: m && m[3] ? +m[3] : null, pessoas: '', itens: [], ppc: '' };
        R.frentes.push(F); ult = null; continue;
      }
      if (!F || !cols) continue;
      if (/PPC DA FRENTE/.test(t)) { const p = l.items.filter(i => i.x > (cols.motivo || 700) - 5 && !/ppc da frente/i.test(i.s)).map(i => i.s).join(' '); F.ppc = p === '—' ? '' : p; F = null; cols = null; continue; }
      const id = l.items[0] && l.items[0].x < cols.txt - 5 && /^\d+$/.test(l.items[0].s) ? +l.items[0].s : null;
      const texto = l.items.filter(i => i.x >= cols.txt - 1 && i.x < (cols.dias[0] || 400) - 15).map(i => i.s).join(' ').trim();
      const dias = []; let ok = '', motivo = '';
      for (const i of l.items) { const cx = i.x + i.w / 2;
        if (cols.ok != null && i.x >= cols.ok - 6 && (cols.motivo == null || i.x < cols.motivo - 4)) { ok += i.s; continue; }
        if (cols.motivo != null && i.x >= cols.motivo - 4 && (cols.ppc == null || i.x < cols.ppc - 4)) { motivo += (motivo ? ' ' : '') + i.s; continue; }
        if (/^x$/i.test(i.s)) { let b = -1, bd = 14; cols.dias.forEach((d, j) => { if (d != null && Math.abs(d - cx) < bd) { bd = Math.abs(d - cx); b = j; } }); if (b >= 0 && !dias.includes(b)) dias.push(b); } }
      if (id != null) {
        if (!texto && !dias.length) { ult = null; continue; }   // linha vazia do modelo
        ult = { id, texto, dias: dias.sort(), ok: ok.trim(), motivo: motivo.trim() }; F.itens.push(ult);
      } else if (ult) { if (texto) ult.texto = (ult.texto + ' ' + texto).trim(); dias.forEach(d => { if (!ult.dias.includes(d)) ult.dias.push(d); }); ult.dias.sort(); }
      else if (!F.itens.length && texto) F.pessoas = (F.pessoas ? F.pessoas + ' ' : '') + texto;
    }
    if (!R.semana) R.problemas.push({ motivo: 'Não achei a semana (ex.: "Semana 16/11 a 21/11/2026") no PDF.' });
    return R;
  }

  /* ---------- locais e pavimentos ---------- */
  // "8º", "3°", "10", "4º AO 7º", "2º E 3°", "8º AO ROOF", "TÉRREO", "ROOF", "COB" → nomes de pavimento da obra
  // pavs: lista de nomes cadastrados (na ordem do prédio). Devolve { pavs: [...], geral: bool } ou null (não entendeu)
  function numPav(nome) { const m = norm(nome).match(/(\d+)/); return m ? +m[1] : null; }
  function tokenPav(tok, pavs) {
    const t = norm(tok).replace(/[º°ª.]/g, '').trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) { const n = +t; const p = pavs.find(x => numPav(x) === n && !/SUBSOLO|GARAGEM G/.test(norm(x))); return p ? [p] : null; }
    if (/^(TERREO|TER|TERR)$/.test(t)) { const p = pavs.find(x => /TERREO/.test(norm(x))); return p ? [p] : null; }
    if (/^(ROOF|ROOFTOP|ROOFT|COB|COBERT|COBERTURA|ATICO)$/.test(t)) { const p = pavs.find(x => /COBERTURA|ROOF|ATICO/.test(norm(x))); return p ? [p] : null; }
    return null;
  }
  function pavimentosDe(local, pavs) {
    const t = norm(local);
    if (!t) return { pavs: [], geral: true };
    const partes = t.split(/\s+E\s+|,|\//).map(s => s.trim()).filter(Boolean); const out = [];
    for (const p of partes) {
      const r = p.split(/\s+(?:AO|A|ATE)\s+/);
      if (r.length === 2) { const a = tokenPav(r[0], pavs), b = tokenPav(r[1], pavs); if (!a || !b) return null;
        let i = pavs.indexOf(a[0]), j = pavs.indexOf(b[0]); if (i > j) [i, j] = [j, i]; out.push(...pavs.slice(i, j + 1)); continue; }
      const a = tokenPav(p, pavs); if (!a) return null; out.push(...a);
    }
    return { pavs: [...new Set(out)], geral: false };
  }
  // locais que não são pavimento (a atividade fica sem pavimento, sem erro)
  const LOCAL_GERAL = /^(GERAL|FACH|FACHADA|FACHADAS|PISCINA|SACADAS?|VIZINHO|ELEVAD|ELEVADORES?|RESERVAT|RESERVATORIO|CHURRASQUEIRAS?|GARAGEM|EXTERNO|EXTERNA|ANDAIME|CANTEIRO)$/;
  // pavimentos citados num texto livre (PCP): "5ºPAV", "8º PAVIMENTO", "4º ANDAR", "APTO 412", "TÉRREO", "ROOFTOP"
  function pavimentosNoTexto(txt, pavs) {
    const t = norm(txt); const out = new Set();
    for (const m of t.matchAll(/(\d{1,2})\s*[º°]?\s*(?:PAV(?:IMENTO)?|ANDAR|ANDARES)\b/g)) { const p = tokenPav(m[1], pavs); if (p) out.add(p[0]); }
    for (const m of t.matchAll(/(\d{1,2})\s*[º°]?\s*(?:AO|A)\s*(\d{1,2})\s*[º°]?\s*(?:PAV|ANDAR)/g)) { const a = tokenPav(m[1], pavs), b = tokenPav(m[2], pavs); if (a && b) { let i = pavs.indexOf(a[0]), j = pavs.indexOf(b[0]); if (i > j) [i, j] = [j, i]; pavs.slice(i, j + 1).forEach(x => out.add(x)); } }
    for (const m of t.matchAll(/APTOS?\.?\s*(\d{3,4})/g)) { const n = Math.floor(+m[1] / 100); const p = tokenPav(String(n), pavs); if (p) out.add(p[0]); }
    if (/\bTERREO\b/.test(t)) { const p = tokenPav('TERREO', pavs); if (p) out.add(p[0]); }
    if (/\bROOF(TOP)?\b|\bCOBERTURA\b/.test(t)) { const p = tokenPav('ROOF', pavs); if (p) out.add(p[0]); }
    return [...out].sort((a, b) => pavs.indexOf(a) - pavs.indexOf(b));
  }

  const API = { paginas, tipo, lerMP, lerPCP, pavimentosDe, pavimentosNoTexto, LOCAL_GERAL, norm, dataBR, linhas };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PlanoPDF = API;
})(typeof window !== 'undefined' ? window : globalThis);
