/* =====================================================================
   Listas e regras das pendências: funções usadas pelo painel de
   Pendências e pela página "Listas e regras".
   - Listas: padrão da empresa (tabela pend_listas) ou próprias da obra
     (pend_config.listas). Itens desativados somem do formulário, mas
     continuam valendo nas pendências antigas e nos filtros.
   - Regras da obra (pend_config.regras):
       tipologias: [{id, nome, comodos:[...]}]
       finais:     {'01': idTipologia, ...}     (pelo final do apartamento)
       unidades:   {'801': idTipologia, ...}    (exceções, uma a uma)
       prazos:     {critica:1, alta:3, media:7, baixa:15}  (dias)
       obrigatorios: {descricao, causador, prazo, observacoes, ponto, bloqueios}
   ===================================================================== */
(function () {
  'use strict';
  const TIPOS = ['problema', 'comodo', 'servico', 'local', 'disciplina'];
  const PRAZOS = { critica: 1, alta: 3, media: 7, baixa: 15 };

  // "03-07, 10" → ["03","04","05","06","07","10"]
  function lerFinais(s) {
    const out = [];
    for (const t of String(s).split(/[,;\s]+/).filter(Boolean)) {
      const m = t.match(/^(\d{1,2})\s*[-–a]\s*(\d{1,2})$/);
      if (m) { for (let k = +m[1]; k <= +m[2]; k++) out.push(String(k).padStart(2, '0')); }
      else if (/^\d{1,2}$/.test(t)) out.push(t.padStart(2, '0'));
    }
    return [...new Set(out)];
  }
  // ["03","04","05","10"] → "03-05, 10"
  function finaisTxt(fs) {
    const n = [...new Set((fs || []).map(Number))].sort((a, b) => a - b); const partes = [];
    for (let i = 0; i < n.length;) { let j = i; while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
      partes.push(j - i >= 2 ? String(n[i]).padStart(2, '0') + '-' + String(n[j]).padStart(2, '0') : n.slice(i, j + 1).map(v => String(v).padStart(2, '0')).join(', ')); i = j + 1; }
    return partes.join(', ');
  }
  const finalDe = u => { const m = String(u || '').trim().match(/(\d{2})$/); return m ? m[1] : null; };
  // número do pavimento pelo nome ("Pavimento 04" → 4)
  const numeroPav = n => { const m = String(n || '').match(/(\d{1,3})\s*$/) || String(n || '').match(/(\d{1,3})/); return m ? +m[1] : null; };

  // item de lista sempre no mesmo formato
  function normItem(x, i) {
    const extra = Object.assign({}, x.extra || {});
    const ativo = x.ativo !== undefined ? x.ativo !== false : extra.ativo !== false;
    delete extra.ativo;
    return { valor: String(x.valor || '').trim(), ordem: x.ordem != null ? +x.ordem : i + 1, extra, ativo };
  }
  function normListas(obj) {
    const out = {}; for (const t of TIPOS) out[t] = ((obj && obj[t]) || []).map(normItem).filter(x => x.valor).sort((a, b) => a.ordem - b.ordem);
    return out;
  }
  // linhas de pend_listas → {problema:[...], ...}
  function deTabela(linhas) {
    const o = {}; for (const t of TIPOS) o[t] = [];
    for (const r of linhas || []) if (o[r.tipo]) o[r.tipo].push(r);
    return normListas(o);
  }
  // listas que valem na obra: as próprias (menos disciplinas, sempre do padrão) ou o padrão
  function efetivas(padrao, daObra) {
    if (!daObra) return padrao;
    // lista que a obra não tem (ex.: locais) vem do padrão
    const o = normListas(daObra); for (const t of TIPOS) if (!Array.isArray(daObra[t])) o[t] = padrao[t];
    o.disciplina = padrao.disciplina; return o;
  }
  const ativos = arr => (arr || []).filter(x => x.ativo !== false);

  // regras da obra; converte o formato antigo ({comodos:[{finais, comodos}]})
  function normRegras(r) {
    r = JSON.parse(JSON.stringify(r || {}));
    if (!Array.isArray(r.tipologias)) {
      r.tipologias = []; r.finais = r.finais || {};
      (r.comodos || []).forEach((x, i) => { const id = 't' + (i + 1); r.tipologias.push({ id, nome: 'Finais ' + finaisTxt(x.finais), comodos: (x.comodos || []).slice() }); (x.finais || []).forEach(f => { r.finais[f] = id; }); });
    }
    delete r.comodos;
    r.finais = r.finais || {}; r.unidades = r.unidades || {};
    r.prazos = Object.assign({}, PRAZOS, r.prazos || {});
    r.obrigatorios = Object.assign({ descricao: false, causador: false, prazo: false, observacoes: false, ponto: false, bloqueios: false }, r.obrigatorios || {});
    return r;
  }
  // tipologia do apartamento: exceção da unidade, senão a do final
  function tipologiaDe(regras, u) {
    const id = (regras.unidades || {})[String(u || '').trim()] || (regras.finais || {})[finalDe(u)];
    return id ? (regras.tipologias || []).find(t => t.id === id) || null : null;
  }

  // Liga os pavimentos da obra às plantas do IFC (que podem ter outros nomes).
  //   pavimentos: [{nome, planta?}] de baixo para cima; plantas: [{pavimento, elevacao}]
  //   1) "planta" escolhida à mão; 2) mesmo nome (sem acento/maiúsculas) ou os dois "térreo";
  //   3) os demais pela ordem de altura, contando a partir do pavimento já ligado mais próximo
  //      (térreo ligado → o próximo é o 2º pavimento, e assim por diante).
  // Devolve {nomeDoPavimento: nomeDaPlanta}.
  const normNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  function ordenarPlantas(plantas) {
    const nat = (a, b) => String(a.pavimento).localeCompare(String(b.pavimento), 'pt', { numeric: true });
    return (plantas || []).slice().sort((a, b) => {
      const ea = a.elevacao, eb = b.elevacao;
      if (ea != null && eb != null) return ea - eb; if (ea != null) return -1; if (eb != null) return 1; return nat(a, b);
    }).map(p => p.pavimento);
  }
  function mapaPlantas(pavimentos, plantas) {
    const ord = ordenarPlantas(plantas), pv = (pavimentos || []).map(p => p.nome);
    const mapa = {}, usada = new Set(), anc = [];   // anc: [índice do pavimento, índice da planta]
    pv.forEach((n, i) => { const esc = (pavimentos[i] || {}).planta; let j = esc ? ord.indexOf(esc) : -1;
      if (j < 0) j = ord.findIndex(k => !usada.has(k) && (normNome(k) === normNome(n) || (normNome(k).includes('terreo') && normNome(n).includes('terreo'))));
      if (j >= 0) { mapa[n] = ord[j]; usada.add(ord[j]); anc.push([i, j]); } });
    if (!anc.length && ord.length) anc.push([0, 0]);
    pv.forEach((n, i) => { if (mapa[n]) return;
      let a = null; for (const x of anc) if (x[0] <= i) a = x; if (!a) a = anc.find(x => x[0] > i) || null; if (!a) return;
      const j = a[1] + (i - a[0]); if (j >= 0 && j < ord.length && !usada.has(ord[j])) { mapa[n] = ord[j]; usada.add(ord[j]); } });
    return mapa;
  }

  window.ListasObra = { TIPOS, PRAZOS, lerFinais, finaisTxt, finalDe, numeroPav, normItem, normListas, deTabela, efetivas, ativos, normRegras, tipologiaDe, normNome, ordenarPlantas, mapaPlantas };
})();
