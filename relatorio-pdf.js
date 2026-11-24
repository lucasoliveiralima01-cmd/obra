/* =====================================================================
   Relatórios de pendências em PDF (jsPDF): Consolidado (duas versões:
   "Em aberto" e "Pós-correção", dois cartões por página), Individual (uma
   pendência por página) e Fotográfico (um cartão por pendência com as fotos dela).
   Este arquivo só desenha. Quem chama (pendencias.html) entrega os dados
   já prontos, com as fotos e a planta carregadas (imagem + tamanho).

   Regras do layout:
   - A4 vertical, medidas fixas em milímetros (configuradas em MED).
   - O tamanho das fotos nunca muda a altura de um bloco: cada área de
     foto tem tamanho fixo e as fotos se encaixam dentro dela (como
     object-fit: contain), em grade de 1, 2 ou 2×2.
   - Mais de 4 fotos numa categoria, textos longos: vão para os anexos,
     identificados pela pendência. Nada é descartado.
   - Foto que não carregou aparece como "Foto não carregada" no lugar dela.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- cores e medidas ---------------- */
  const COR = {
    azul: [16, 58, 92], azulClaro: [33, 98, 140], tinta: [26, 36, 46], cinza: [104, 118, 130], cinzaClaro: [150, 162, 172],
    linha: [214, 222, 228], fundo: [241, 245, 248], branco: [255, 255, 255]
  };
  const SELO = {   // status: fundo, texto
    avaliacao: [[221, 234, 245], [33, 98, 140]], aberta: [[251, 226, 222], [178, 46, 34]], em_correcao: [[252, 238, 212], [160, 96, 0]],
    corrigida: [[222, 233, 246], [47, 111, 176]], fechada: [[224, 243, 230], [30, 120, 66]]
  };
  const COR_PRI = { critica: [178, 46, 34], alta: [176, 104, 0], media: [26, 36, 46], baixa: [104, 118, 130] };
  const PG = { W: 210, H: 297, M: 14 };
  PG.L = PG.W - 2 * PG.M;   // largura útil (182 mm)
  // tudo em mm, a partir do topo da página
  const MED = {
    cab: { logoX: PG.M, logoY: 9, logoW: 52, logoH: 17, barraY: 29, linhaY: 37, obraY: 45, fim: 63 },
    rod: { linhaY: 283, textoY: 288 },
    ind: {
      idY: 69, titY: 77, locY: 83.5, descY: 89, descLinhas: 2,
      cards1Y: 97, cards2Y: 113, cardH: 13.5,
      sec1Y: 135, fotoY: 139, fotoH: 64,
      sec2Y: 211, plantaY: 215, plantaH: 34,
      sec3Y: 257, encY: 261, encH: 19
    },
    con: { tituloY: 69, bloco1Y: 74, blocoH: 100, gap: 5, fotoY: 34, fotoH: 44 }
  };

  /* ---------------- ajudas de texto ---------------- */
  function fonte(pdf, estilo, tam, cor) { pdf.setFont('helvetica', estilo); pdf.setFontSize(tam); pdf.setTextColor(...(cor || COR.tinta)); }
  // corta o texto em no máximo n linhas na largura w; diz se sobrou
  function caber(pdf, txt, w, n) {
    const ls = pdf.splitTextToSize(String(txt || ''), w);
    if (ls.length <= n) return { ls, cortou: false };
    const r = ls.slice(0, n); let ult = r[n - 1];
    while (ult.length && pdf.getTextWidth(ult + '…') > w) ult = ult.slice(0, -1);
    r[n - 1] = ult.replace(/\s+$/, '') + '…'; return { ls: r, cortou: true };
  }
  const uma = (pdf, txt, w) => caber(pdf, txt, w, 1).ls[0] || '';

  /* ---------------- componentes ---------------- */
  // cabeçalho institucional: logo, título, subtítulo, obra, endereço e emissão
  function cabecalho(pdf, o, subtitulo) {
    const c = MED.cab;
    if (o.logo) { let h = c.logoH, w = h * o.logo.r; if (w > c.logoW) { w = c.logoW; h = w / o.logo.r; } pdf.addImage(o.logo.d, o.logo.tipo || 'PNG', c.logoX, c.logoY + (c.logoH - h) / 2, w, h); }
    else { fonte(pdf, 'bold', 15, COR.azul); pdf.text(uma(pdf, o.empresa || o.obra, c.logoW + 20), c.logoX, c.logoY + 11); }
    pdf.setFillColor(...COR.azul); pdf.rect(c.logoX, c.barraY, c.logoW, 1, 'F');
    fonte(pdf, 'bold', 13.5, COR.tinta); pdf.text('RELATÓRIO DE PENDÊNCIAS', PG.W - PG.M, 17, { align: 'right' });
    fonte(pdf, 'normal', 8, COR.cinza); pdf.text(uma(pdf, subtitulo, 110), PG.W - PG.M, 22.5, { align: 'right' });
    pdf.setDrawColor(...COR.azul); pdf.setLineWidth(0.6); pdf.line(PG.M, c.linhaY, PG.W - PG.M, c.linhaY);
    rotulo(pdf, 'OBRA', PG.M, c.obraY); fonte(pdf, 'bold', 10, COR.tinta); pdf.text(uma(pdf, o.obra, 95), PG.M, c.obraY + 5);
    if (o.endereco) { fonte(pdf, 'normal', 8, COR.cinza); pdf.text(uma(pdf, o.endereco, 100), PG.M, c.obraY + 10); }
    rotulo(pdf, 'EMISSÃO', 118, c.obraY); fonte(pdf, 'bold', 10, COR.tinta); pdf.text(o.emissao, 118, c.obraY + 5);
  }
  function rotulo(pdf, txt, x, y, cor) { fonte(pdf, 'bold', 6.6, cor || COR.cinza); pdf.text(String(txt).toUpperCase(), x, y); }
  // rodapé: empresa, identificação do relatório e página
  function rodape(pdf, o, modelo, pag, tot) {
    const r = MED.rod;
    pdf.setDrawColor(...COR.azul); pdf.setLineWidth(0.6); pdf.line(PG.M, r.linhaY, PG.W - PG.M, r.linhaY);
    fonte(pdf, 'normal', 7.5, COR.cinza);
    pdf.text(uma(pdf, (o.empresa ? o.empresa + ' | ' : '') + 'Controle de pendências', 120), PG.M, r.textoY);
    pdf.text(modelo + '  •  Página ' + pag + ' de ' + tot, PG.W - PG.M, r.textoY, { align: 'right' });
  }
  // selo do status (pílula colorida)
  function selo(pdf, status, txt, xDir, y, w) {
    const [fd, tx] = SELO[status] || [COR.fundo, COR.cinza]; w = w || 34;
    pdf.setFillColor(...fd); pdf.roundedRect(xDir - w, y, w, 7, 1.6, 1.6, 'F');
    fonte(pdf, 'bold', 7.6, tx); pdf.text(String(txt).toUpperCase(), xDir - w / 2, y + 4.7, { align: 'center' });
  }
  // cartão de informação (rótulo + valor de uma linha)
  function cartao(pdf, x, y, w, h, rot, val, corVal) {
    pdf.setFillColor(...COR.fundo); pdf.roundedRect(x, y, w, h, 1.6, 1.6, 'F');
    rotulo(pdf, rot, x + 4, y + 4.8); fonte(pdf, 'bold', 8.8, corVal || COR.tinta); pdf.text(uma(pdf, val || '—', w - 8), x + 4, y + 10.2);
  }
  function tituloSecao(pdf, num, txt, y) {
    pdf.setFillColor(...COR.azul); pdf.rect(PG.M, y - 4.2, 1.1, 5.4, 'F');
    fonte(pdf, 'bold', 10, COR.azul); pdf.text(num + '  ' + txt.toUpperCase(), PG.M + 4, y);
  }
  // uma foto dentro de uma célula, sem cortar nem esticar (contain), centralizada
  function fotoNaCelula(pdf, im, x, y, w, h) {
    pdf.setFillColor(...COR.fundo); pdf.rect(x, y, w, h, 'F');
    if (!im || im.erro) { fonte(pdf, 'normal', 7, COR.cinza); pdf.text(im && im.erro ? 'Foto não carregada' : '', x + w / 2, y + h / 2 + 1, { align: 'center' }); return; }
    const r = im.w / im.h; let iw = w, ih = w / r; if (ih > h) { ih = h; iw = h * r; }
    pdf.addImage(im.d, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  // grade adaptável: 0 = aviso; 1 = grande; 2 = lado a lado; 3 ou 4 = 2×2 (até 4; o resto vai para os anexos)
  function gradeFotos(pdf, fotos, x, y, w, h) {
    const g = 2, L = fotos.slice(0, 4);
    if (!L.length) { pdf.setFillColor(...COR.fundo); pdf.rect(x, y, w, h, 'F'); fonte(pdf, 'normal', 8, COR.cinzaClaro); pdf.text('Sem registro fotográfico', x + w / 2, y + h / 2 + 1, { align: 'center' }); return; }
    if (L.length === 1) return fotoNaCelula(pdf, L[0], x, y, w, h);
    if (L.length === 2) { const cw = (w - g) / 2; L.forEach((im, i) => fotoNaCelula(pdf, im, x + i * (cw + g), y, cw, h)); return; }
    const cw = (w - g) / 2, ch = (h - g) / 2;
    for (let i = 0; i < 4; i++) { const cx = x + (i % 2) * (cw + g), cy = y + Math.floor(i / 2) * (ch + g); if (L[i]) fotoNaCelula(pdf, L[i], cx, cy, cw, ch); else { pdf.setFillColor(...COR.fundo); pdf.rect(cx, cy, cw, ch, 'F'); } }
  }
  // quadro ANTES ou DEPOIS: moldura fixa, título e a grade
  function quadroFotos(pdf, rot, fotos, x, y, w, h) {
    pdf.setDrawColor(...COR.linha); pdf.setLineWidth(0.35); pdf.roundedRect(x, y, w, h, 2, 2, 'S');
    const mais = fotos.length > 4 ? '  ·  +' + (fotos.length - 4) + ' nos anexos' : '';
    fonte(pdf, 'bold', 7.8, COR.azul); pdf.text(uma(pdf, rot + mais, w - 8), x + 4, y + 5.6);
    gradeFotos(pdf, fotos, x + 4, y + 8.5, w - 8, h - 12.5);
  }
  // planta: imagem inteira ajustada no espaço reservado, com o alfinete já desenhado nela
  function plantaArea(pdf, pl, msg, x, y, w, h) {
    pdf.setFillColor(...COR.fundo); pdf.roundedRect(x, y, w, h, 2, 2, 'F');
    if (!pl || pl.erro) { fonte(pdf, 'normal', 8, COR.cinzaClaro); pdf.text(pl && pl.erro ? 'Planta não carregada' : msg || 'Local não marcado na planta', x + w / 2, y + h / 2 + 1, { align: 'center' }); return; }
    const pad = 3, aw = w - 2 * pad, ah = h - 2 * pad, r = pl.w / pl.h; let iw = aw, ih = aw / r; if (ih > ah) { ih = ah; iw = ah * r; }
    pdf.addImage(pl.d, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  /* ---------------- anexos: fotos excedentes e textos longos ---------------- */
  function anexosPaginas(pdf, o, modelo, lista) {
    // lista: [{ p, itens: [{tipo:'texto', rot, txt} | {tipo:'foto', rot, im}] }]
    let y = 0, abriu = false;
    const novo2 = true;
    const nova = sub => { pdf.addPage(); if (novo2) { cab2(pdf, o, modelo + ' · anexos', lista.length); y = L2.card1 + 2; } else { cabecalho(pdf, o, sub); y = MED.cab.fim + 6; } abriu = true; };
    const limite = MED.rod.linhaY - 6;
    for (const { p, itens } of lista) {
      if (!itens.length) continue;
      const sub = lista.length === 1 ? 'ANEXOS  •  Pendência ' + p.numeroTxt : 'ANEXOS  •  Fotos extras e textos completos';
      if (!abriu || y > limite - 40) nova(sub); else y += 4;
      fonte(pdf, 'bold', 10, COR.azul); pdf.text(uma(pdf, 'ANEXO  —  PENDÊNCIA ' + p.numeroTxt.toUpperCase() + '  ·  ' + p.titulo, PG.L), PG.M, y); y += 6;
      for (const it of itens.filter(i => i.tipo === 'texto')) {
        fonte(pdf, 'normal', 8.4, COR.tinta); const ls = pdf.splitTextToSize(it.txt, PG.L);
        let i = 0; if (y > limite - 12) nova(sub);
        rotulo(pdf, it.rot, PG.M, y); y += 4.5;
        while (i < ls.length) { if (y > limite) { nova(sub); rotulo(pdf, it.rot + ' (continuação)', PG.M, y); y += 4.5; } fonte(pdf, 'normal', 8.4, COR.tinta); pdf.text(ls[i], PG.M, y); y += 4; i++; }
        y += 3;
      }
      const fotos = itens.filter(i => i.tipo === 'foto');
      const col = 3, g = 4, cw = (PG.L - (col - 1) * g) / col, ch = 52, cap = 5;
      for (let i = 0; i < fotos.length; i++) {
        if (i && i % col === 0) y += ch + cap + g;
        if (i % col === 0 && y + ch + cap > limite) { nova(sub); }
        const x = PG.M + (i % col) * (cw + g);
        fotoNaCelula(pdf, fotos[i].im, x, y, cw, ch);
        fonte(pdf, 'normal', 7.4, COR.cinza); pdf.text(uma(pdf, fotos[i].rot, cw), x + cw / 2, y + ch + 3.6, { align: 'center' });
      }
      if (fotos.length) y += ch + cap + g;
    }
  }
  // fotos além das 4 do quadro principal
  function excedentes(p) {
    const r = [];
    for (const [k, rot] of [['antes', 'Antes'], ['depois', 'Depois']]) p.fotos[k].slice(4).forEach((im, i) => r.push({ tipo: 'foto', rot: rot + ' ' + (i + 5) + ' de ' + p.fotos[k].length, im }));
    return r;
  }


  /* ================= Consolidado: versões "Em aberto" e "Pós-correção" ================= */
  const C2 = {
    navy: [16, 52, 84], tinta: [28, 36, 46], cinza: [96, 110, 124], rot: [72, 86, 102], borda: [208, 216, 224], faixa: [237, 241, 245], painel: [242, 245, 248],
    pill: { aberto: [[253, 238, 214], [150, 82, 0]], avaliacao: [[230, 232, 250], [80, 70, 170]], corrigida: [[222, 233, 246], [40, 100, 168]], fechada: [[226, 244, 231], [30, 120, 62]] },
    chip: { reg: [[226, 236, 247], [22, 70, 120]], cor: [[253, 240, 222], [176, 96, 0]], fec: [[228, 244, 231], [30, 120, 62]], nada: [[238, 240, 243], [140, 150, 160]] }
  };
  const L2 = { cabTit: 18, cabSub: 24.5, cabLinha: 30.5, obraY: 38.5, card1: 46, cardH: 114, gap: 6, rodLinha: 284, rodTxt: 289.5 };
  const PILL_TXT = { aberta: 'EM ABERTO', em_correcao: 'EM CORREÇÃO', avaliacao: 'EM AVALIAÇÃO', corrigida: 'CORRIGIDA', fechada: 'FECHADA' };
  function cab2(pdf, o, versaoTxt, n) {
    if (o.logo) { let h = 15, w = h * o.logo.r; if (w > 50) { w = 50; h = w / o.logo.r; } pdf.addImage(o.logo.d, o.logo.tipo || 'PNG', PG.M, 9 + (15 - h) / 2, w, h); }
    else { fonte(pdf, 'bold', 16, C2.navy); pdf.text(uma(pdf, o.empresa || o.obra, 80), PG.M, 20); }
    fonte(pdf, 'bold', 15, C2.tinta); pdf.text(uma(pdf, (o.titulo || 'RELATÓRIO DE PENDÊNCIAS').toUpperCase(), 120), PG.W - PG.M, L2.cabTit, { align: 'right' });
    fonte(pdf, 'normal', 10, [70, 100, 130]); pdf.text(versaoTxt.toUpperCase() + (n == null ? '' : '   |   ' + n + ' registro' + (n === 1 ? '' : 's')), PG.W - PG.M, L2.cabSub, { align: 'right' });
    pdf.setDrawColor(...C2.navy); pdf.setLineWidth(0.7); pdf.line(PG.M, L2.cabLinha, PG.W - PG.M, L2.cabLinha);
    // OBRA Start  |  endereço  |  EMISSÃO: data
    let x = PG.M; const y = L2.obraY, sep = () => { fonte(pdf, 'normal', 10, C2.cinza); pdf.text('|', x + 2.5, y); x += 7.5; };
    fonte(pdf, 'bold', 8, C2.rot); pdf.text('OBRA', x, y); x += pdf.getTextWidth('OBRA') + 3;
    fonte(pdf, 'bold', 10.5, C2.tinta); const ob = uma(pdf, o.obra, 50); pdf.text(ob, x, y); x += pdf.getTextWidth(ob) + 2; sep();
    if (o.endereco) { fonte(pdf, 'normal', 9.4, [70, 80, 92]); const en = uma(pdf, o.endereco, 78); pdf.text(en, x, y); x += pdf.getTextWidth(en) + 2; sep(); }
    fonte(pdf, 'bold', 8, C2.rot); pdf.text('EMISSÃO:', x, y); x += pdf.getTextWidth('EMISSÃO:') + 1.6; fonte(pdf, 'normal', 9.4, [70, 80, 92]); pdf.text(o.emissao, x, y);
  }
  function rod2(pdf, o, versaoTxt, pag, tot) {
    pdf.setDrawColor(...C2.borda); pdf.setLineWidth(0.3); pdf.line(PG.M, L2.rodLinha, PG.W - PG.M, L2.rodLinha);
    fonte(pdf, 'normal', 8, C2.cinza);
    pdf.text(uma(pdf, (o.empresa ? o.empresa + '   |   ' : '') + 'Controle de pendências', 120), PG.M, L2.rodTxt);
    pdf.text(versaoTxt + '   |   Página ' + pag + ' de ' + tot, PG.W - PG.M, L2.rodTxt, { align: 'right' });
  }
  function pill(pdf, p, xDir, y) {
    const k = p.status === 'aberta' || p.status === 'em_correcao' ? 'aberto' : p.status; const [fd, tx] = C2.pill[k] || C2.pill.aberto;
    const t = PILL_TXT[p.status] || String(p.statusTxt || '').toUpperCase(); fonte(pdf, 'bold', 8.4, tx); const w = Math.max(30, pdf.getTextWidth(t) + 10);
    pdf.setFillColor(...fd); pdf.roundedRect(xDir - w, y, w, 7, 2, 2, 'F'); pdf.text(t, xDir - w / 2, y + 4.8, { align: 'center' });
  }
  function moldura(pdf, y, H) {
    const X = PG.M, W = PG.L;
    // faixa azul no topo, recortada pela própria moldura (segue a curva dos cantos)
    pdf.saveGraphicsState(); pdf.roundedRect(X, y, W, H, 2.5, 2.5, null); pdf.clip(); pdf.discardPath();
    pdf.setFillColor(...C2.navy); pdf.rect(X - 1, y - 1, W + 2, 3.2, 'F');
    pdf.restoreGraphicsState();
    pdf.setDrawColor(...C2.borda); pdf.setLineWidth(0.35); pdf.roundedRect(X, y, W, H, 2.5, 2.5, 'S');
  }
  // número e título: o título não é cortado (a letra diminui um pouco e, se preciso, vai para 2 linhas)
  function medirTopo(pdf, p, iw, cont) {
    const id = p.numeroTxt + (cont ? ' (continuação)' : '');
    fonte(pdf, 'bold', 13, C2.navy); const wid = pdf.getTextWidth(id) + 3.2, larg = iw - 35 - wid;
    for (let tam = 12; tam >= 10; tam -= 0.5) { fonte(pdf, 'bold', tam, C2.tinta); if (pdf.getTextWidth(p.titulo) <= larg) return { id, wid, tam, ls: [p.titulo], dy: 0, cortou: false }; }
    fonte(pdf, 'bold', 10.5, C2.tinta); const c = caber(pdf, p.titulo, larg, 2);
    return { id, wid, tam: 10.5, ls: c.ls, dy: (c.ls.length - 1) * 4.6, cortou: c.cortou };
  }
  function alfinete(pdf, x, y, cor) {
    pdf.setFillColor(...cor); pdf.circle(x + 1.25, y - 2.75, 1.25, 'F'); pdf.triangle(x + 0.15, y - 2.35, x + 2.35, y - 2.35, x + 1.25, y + 0.15, 'F');
    pdf.setFillColor(255, 255, 255); pdf.circle(x + 1.25, y - 2.75, 0.45, 'F');
  }
  // topo do cartão; devolve quanto ele cresceu (título em 2 linhas)
  function topoCard(pdf, p, y, ix, iw, anexos, o) {
    o = o || {}; const m = medirTopo(pdf, p, iw, o.cont);
    fonte(pdf, 'bold', 13, C2.navy); pdf.text(m.id, ix, y + 9.8);
    pill(pdf, p, ix + iw, y + 4.4);
    fonte(pdf, 'bold', m.tam, C2.tinta); m.ls.forEach((l, i) => pdf.text(l, ix + m.wid, y + 9.8 + i * 4.6));
    if (anexos && (m.cortou || (p.descricao && p.descricao !== p.titulo))) anexos.push({ tipo: 'texto', rot: 'Descrição completa', txt: p.descricao || p.titulo });
    const ly = y + 15.8 + m.dy; alfinete(pdf, ix, ly, C2.navy);
    fonte(pdf, 'bold', 10, C2.navy); const loc = uma(pdf, p.localTxt || '—', iw - 4); pdf.text(loc, ix + 3.6, ly);
    if (o.extra) { const lw = pdf.getTextWidth(loc); fonte(pdf, 'normal', 9, C2.cinza); pdf.text(uma(pdf, '   ·   ' + o.extra, iw - 4 - lw), ix + 3.6 + lw, ly); }
    return m.dy;
  }
  // faixa cinza com colunas (rótulo, valor e uma linha menor opcional)
  function faixa(pdf, x, y, w, h, cols, anexos) {
    pdf.setFillColor(...C2.faixa); pdf.roundedRect(x, y, w, h, 2.2, 2.2, 'F');
    const tot = cols.reduce((a, c) => a + c.peso, 0), comSub = cols.some(c => c.sub); let cx = x;
    // largura de cada coluna pelo que ela precisa mostrar (rótulo e valor inteiros); o que sobra é dividido pelo peso
    const precisa = cols.map(c => { const ps = (Array.isArray(c.val) ? c.val : [{ t: c.val || '—' }]).filter(q => q && q.t);
      fonte(pdf, 'normal', 9.2, C2.tinta); const v = ps.reduce((a, q) => a + pdf.getTextWidth(q.t), 0);
      fonte(pdf, 'bold', 7.2, C2.rot); const r = pdf.getTextWidth(c.rot.toUpperCase());
      fonte(pdf, 'normal', 7.2, C2.cinza); const sb = c.sub ? pdf.getTextWidth(c.sub) : 0; return Math.max(v, r, sb) + 9.5; });
    const somaP = precisa.reduce((a, n) => a + n, 0);
    const largs = somaP <= w ? precisa.map((n, i) => n + (w - somaP) * cols[i].peso / tot) : precisa.map(n => w * n / somaP);
    const yr = comSub ? (h < 18 ? 4.75 : 5.4) : h / 2 - 1.5, yv = comSub ? (h < 18 ? 9.3 : 10.6) : h / 2 + 3.4;
    cols.forEach((c, i) => {
      const cw = largs[i], px = cx + (i ? 4.5 : 5.5), lw = cw - 8;
      if (i) { pdf.setDrawColor(196, 206, 216); pdf.setLineWidth(0.3); pdf.line(cx, y + 2.6, cx, y + h - 2.6); }
      fonte(pdf, 'bold', 7.2, C2.rot); pdf.text(c.rot.toUpperCase(), px, y + yr);
      const partes = (Array.isArray(c.val) ? c.val : [{ t: c.val || '—', cor: c.cor }]).filter(q => q && q.t);
      const larg = tam => { fonte(pdf, 'normal', tam, C2.tinta); return partes.reduce((a, q) => a + pdf.getTextWidth(q.t), 0); };
      let tam = 9.2; while (tam > 8.2 && larg(tam) > lw) tam -= 0.2;
      let vx = px, sobra = lw;
      partes.forEach((q, k) => {
        fonte(pdf, 'normal', tam, q.cor || C2.tinta);
        const ult = k === partes.length - 1, t = ult ? uma(pdf, q.t, sobra) : q.t;
        if (ult && t !== q.t && anexos && !Array.isArray(c.val)) anexos.push({ tipo: 'texto', rot: c.rot, txt: q.t });
        pdf.text(t, vx, y + yv); const tw = pdf.getTextWidth(t); vx += tw; sobra -= tw;
      });
      if (c.sub) { fonte(pdf, 'normal', 7.2, c.subCor || C2.cinza); pdf.text(uma(pdf, c.sub, lw), px, y + 14.8 * (h < 18 ? 0.88 : 1)); }
      cx += cw;
    });
  }
  // colunas padrão: serviço, prioridade com o prazo, responsável e registro com quem abriu
  const colsPend = p => [
    { rot: 'Serviço', val: p.servico, peso: 25 },
    { rot: 'Prioridade', val: [{ t: p.prioridadeTxt, cor: COR_PRI[p.prioridade] }, p.prazoTxt ? { t: '  ·  ' + p.prazoTxt, cor: p.atrasada ? [178, 46, 34] : C2.cinza } : null], peso: 28 },
    { rot: 'Responsável', val: p.respOficio || p.responsavel, peso: 19 },
    { rot: 'Registro', val: [{ t: String(p.regEm || '').replace(/\/\d{2}(\d{2}) /, '/$1 ') }, p.regPor ? { t: '  ·  ' + p.regPor, cor: C2.cinza } : null], peso: 28 }];
  // foto inteira dentro da área (nada é cortado), centralizada; o fundo claro mostra a área
  function fotoCobre(pdf, im, x, y, w, h, semFundo) {
    if (!semFundo) { pdf.setFillColor(233, 238, 242); pdf.roundedRect(x, y, w, h, 1.4, 1.4, 'F'); }
    if (!im || im.erro) { fonte(pdf, 'normal', 7.5, C2.cinza); pdf.text(im && im.erro ? 'Foto não carregada' : '', x + w / 2, y + h / 2 + 1, { align: 'center' }); return; }
    const r = im.w / im.h; let iw = w, ih = w / r; if (ih > h) { ih = h; iw = h * r; }
    pdf.addImage(im.d, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  // fotos lado a lado, todas com a mesma altura e a largura de cada uma pelo formato dela (nada cortado)
  function fileira(pdf, fotos, x, y, w, h, g) {
    const rs = fotos.map(im => im && !im.erro && im.w ? im.w / im.h : 4 / 3);
    let ah = h; const soma = rs.reduce((a, r) => a + r * ah, 0) + g * (fotos.length - 1);
    if (soma > w) ah = (w - g * (fotos.length - 1)) / rs.reduce((a, r) => a + r, 0);
    const tot = rs.reduce((a, r) => a + r * ah, 0) + g * (fotos.length - 1);
    let cx = x + (w - tot) / 2; const cy = y + (h - ah) / 2;
    fotos.forEach((im, i) => { const fw = rs[i] * ah; fotoCobre(pdf, im, cx, cy, fw, ah, !im || im.erro ? false : true); cx += fw + g; });
    return { x: x + (w - tot) / 2, y: cy, w: tot, h: ah, ws: rs.map(r => r * ah) };
  }
  function semFotos(pdf, x, y, w, h, txt) { fonte(pdf, 'normal', 8.4, [150, 160, 170]); pdf.text(txt, x + w / 2, y + h / 2 + 1, { align: 'center' }); }
  // painel com título e fotos: em fileira (até 4 lado a lado) ou em grade (1, 2 lado a lado, 2×2)
  function painelFotos(pdf, tit, fotos, x, y, w, h, modo) {
    pdf.setFillColor(...C2.painel); pdf.setDrawColor(222, 229, 235); pdf.setLineWidth(0.3); pdf.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
    const mais = fotos.length > 4 ? '   +' + (fotos.length - 4) + ' nos anexos' : '';
    fonte(pdf, 'bold', 8.8, C2.navy); pdf.text(tit, x + 4, y + 5.6); if (mais) { const tw = pdf.getTextWidth(tit); fonte(pdf, 'normal', 7.4, C2.cinza); pdf.text(mais, x + 4 + tw, y + 5.6); }
    const ax = x + 3, ay = y + 8, aw = w - 6, ah = h - 11, L = fotos.slice(0, 4), g = 3;
    if (!L.length) return semFotos(pdf, ax, ay, aw, ah, 'Sem registro fotográfico');
    // 1 ou 2 fotos (ou em fileira): lado a lado, cada uma no seu formato; 3 e 4: duas fileiras
    if (modo === 'fileira' || L.length <= 2) { fileira(pdf, L, ax, ay, aw, ah, g); return; }
    const ch = (ah - g) / 2; fileira(pdf, L.slice(0, 2), ax, ay, aw, ch, g); fileira(pdf, L.slice(2), ax, ay + ch + g, aw, ch, g);
  }
  // ícones simples (linhas), na cor do texto
  function icone(pdf, tipo, x, y, cor) {
    pdf.setDrawColor(...cor); pdf.setLineWidth(0.35); pdf.setLineCap && pdf.setLineCap('round');
    if (tipo === 'doc') { pdf.roundedRect(x, y - 3.4, 2.9, 3.6, 0.4, 0.4, 'S'); pdf.line(x + 0.7, y - 2.3, x + 2.2, y - 2.3); pdf.line(x + 0.7, y - 1.4, x + 2.2, y - 1.4); pdf.line(x + 0.7, y - 0.5, x + 1.8, y - 0.5); }
    else if (tipo === 'chave') { pdf.circle(x + 2.3, y - 2.5, 0.95, 'S'); pdf.setLineWidth(0.55); pdf.line(x + 1.6, y - 1.8, x + 0.3, y - 0.3); pdf.setLineWidth(0.35); }
    else if (tipo === 'ok') { pdf.circle(x + 1.6, y - 1.6, 1.7, 'S'); pdf.line(x + 0.85, y - 1.65, x + 1.45, y - 1.05); pdf.line(x + 1.45, y - 1.05, x + 2.45, y - 2.25); }
    else if (tipo === 'pessoa') { pdf.circle(x + 1, y - 2, 0.65, 'S'); pdf.line(x + 0.1, y, x + 0.4, y - 0.8); pdf.line(x + 0.4, y - 0.8, x + 1.6, y - 0.8); pdf.line(x + 1.6, y - 0.8, x + 1.9, y); }
    else if (tipo === 'cal') { pdf.roundedRect(x, y - 2.6, 2.4, 2.4, 0.3, 0.3, 'S'); pdf.line(x, y - 1.8, x + 2.4, y - 1.8); pdf.line(x + 0.6, y - 2.9, x + 0.6, y - 2.4); pdf.line(x + 1.8, y - 2.9, x + 1.8, y - 2.4); }
  }
  function chip(pdf, k, tit, ic, quem, quando, x, y, w, h) {
    const [fd, tx] = C2.chip[k]; pdf.setFillColor(...fd); pdf.roundedRect(x, y, w, h, 2.2, 2.2, 'F');
    icone(pdf, ic, x + 3.2, y + 6, tx); fonte(pdf, 'bold', 8.8, tx); pdf.text(tit, x + 7.6, y + 5.6);
    const cinza = k === 'nada' ? tx : [70, 80, 92];
    icone(pdf, 'pessoa', x + 3.4, y + 11, cinza); fonte(pdf, 'normal', 7.8, cinza); pdf.text(uma(pdf, quem || '—', w - 9), x + 7.6, y + 10.8);
    icone(pdf, 'cal', x + 3.3, y + 16, cinza); fonte(pdf, 'normal', 7.8, cinza); pdf.text(uma(pdf, quando || '—', w - 9), x + 7.6, y + 15.8);
  }
  function seta(pdf, x, y) { pdf.setDrawColor(70, 80, 92); pdf.setLineWidth(0.4); pdf.line(x, y, x + 3.6, y); pdf.line(x + 2.4, y - 1.1, x + 3.6, y); pdf.line(x + 2.4, y + 1.1, x + 3.6, y); }

  function cardAberto(pdf, p, y, anexos) {
    const H = L2.cardH, ix = PG.M + 5.5, iw = PG.L - 11;
    moldura(pdf, y, H); const dy = topoCard(pdf, p, y, ix, iw, anexos);
    faixa(pdf, ix, y + 19 + dy, iw, 12, colsPend(p), anexos);
    painelFotos(pdf, 'REGISTRO FOTOGRÁFICO  /  ANTES', p.fotos.antes, ix, y + 33.5 + dy, iw, H - 37.5 - dy, 'fileira');
    return { y0: y, y1: y + H };
  }
  function cardPos(pdf, p, y, anexos) {
    const H = L2.cardH, ix = PG.M + 5.5, iw = PG.L - 11, g = 5, w2 = (iw - g) / 2;
    moldura(pdf, y, H); const dy = topoCard(pdf, p, y, ix, iw, anexos);
    painelFotos(pdf, 'ANTES', p.fotos.antes, ix, y + 19.5 + dy, w2, 54 - dy, 'grade');
    painelFotos(pdf, 'DEPOIS', p.fotos.depois, ix + w2 + g, y + 19.5 + dy, w2, 54 - dy, 'grade');
    faixa(pdf, ix, y + 76, iw, 12, [
      { rot: 'Serviço', val: p.servico, peso: 34 }, { rot: 'Prioridade', val: p.prioridadeTxt, cor: COR_PRI[p.prioridade], peso: 26 },
      { rot: 'Responsável', val: p.respOficio || p.responsavel, peso: 40 }], anexos);
    pdf.setDrawColor(...C2.borda); pdf.setLineWidth(0.3); pdf.line(ix, y + 90.5, ix + iw, y + 90.5);
    // correção (texto) e linha do tempo
    const by = y + 93, bh = 17.5, cw = 46;
    fonte(pdf, 'bold', 9.6, C2.navy); pdf.text('CORREÇÃO', ix, by + 5);
    const txt = p.correcao && p.correcao.texto ? p.correcao.texto : 'Sem descrição da correção.';
    fonte(pdf, 'normal', 8.6, C2.tinta); const c = caber(pdf, txt, cw - 2, 3); pdf.text(c.ls, ix, by + 10);
    if (c.cortou) anexos.push({ tipo: 'texto', rot: 'Correção informada (completa)', txt });
    pdf.setDrawColor(...C2.borda); pdf.line(ix + cw + 1.5, by, ix + cw + 1.5, by + bh);
    const x0 = ix + cw + 5, sw = 7.2, chw = (ix + iw - x0 - 2 * sw) / 3;
    chip(pdf, 'reg', 'REGISTRADA', 'doc', p.regPor, p.regEm, x0, by, chw, bh);
    seta(pdf, x0 + chw + 1.8, by + bh / 2);
    chip(pdf, p.correcao ? 'cor' : 'nada', 'CORRIGIDA', 'chave', p.correcao && p.correcao.por, p.correcao ? p.correcao.em : 'Aguardando', x0 + chw + sw, by, chw, bh);
    seta(pdf, x0 + 2 * chw + sw + 1.8, by + bh / 2);
    chip(pdf, p.fechamento ? 'fec' : 'nada', 'FECHADA', 'ok', p.fechamento && p.fechamento.por, p.fechamento ? p.fechamento.em : 'Aguardando', x0 + 2 * (chw + sw), by, chw, bh);
    return { y0: y, y1: y + H };
  }
  function gerarConsolidado(versao, pends, o) {
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const vt = versao === 'pos' ? 'Pós-correção' : 'Em aberto', layout = [], todos = [];
    pdf.setProperties({ title: 'Relatório de pendências · ' + vt + ' · ' + o.obra, subject: 'Pendências da obra ' + o.obra + ' (' + pends.length + ')', author: o.empresa || '', creator: 'Ferramentas da Obra' });
    for (let i = 0; i < pends.length; i += 2) {
      if (i) pdf.addPage();
      cab2(pdf, o, vt, pends.length);
      for (let k = 0; k < 2 && i + k < pends.length; k++) {
        const p = pends[i + k], y0 = L2.card1 + k * (L2.cardH + L2.gap), anexos = [];
        const r = versao === 'pos' ? cardPos(pdf, p, y0, anexos) : cardAberto(pdf, p, y0, anexos);
        layout.push({ pend: p.numeroTxt, pagina: pdf.getNumberOfPages(), y0: r.y0, y1: r.y1 });
        const ex = versao === 'pos' ? excedentes(p) : p.fotos.antes.slice(4).map((im, j) => ({ tipo: 'foto', rot: 'Antes ' + (j + 5) + ' de ' + p.fotos.antes.length, im }));
        todos.push({ p, itens: anexos.concat(ex) });
      }
    }
    if (todos.some(x => x.itens.length)) anexosPaginas(pdf, o, vt, todos);
    const tot = pdf.getNumberOfPages();
    for (let k = 1; k <= tot; k++) { pdf.setPage(k); rod2(pdf, o, vt, k, tot); }
    return { pdf, layout };
  }


  /* ================= Individual: uma pendência por página, no mesmo visual ================= */
  function linhaTempo(pdf, p, ix, iw, by, bh, anexos) {
    const cw = 50;
    fonte(pdf, 'bold', 9.6, C2.navy); pdf.text('CORREÇÃO', ix, by + 5);
    const txt = p.correcao && p.correcao.texto ? p.correcao.texto : (p.correcao ? 'Sem descrição da correção.' : 'Ainda não corrigida.');
    fonte(pdf, 'normal', 8.6, C2.tinta); const c = caber(pdf, txt, cw - 2, 3); pdf.text(c.ls, ix, by + 10);
    if (c.cortou) anexos.push({ tipo: 'texto', rot: 'Correção informada (completa)', txt });
    pdf.setDrawColor(...C2.borda); pdf.setLineWidth(0.3); pdf.line(ix + cw + 1.5, by, ix + cw + 1.5, by + bh);
    const x0 = ix + cw + 5, sw = 7.2, chw = (ix + iw - x0 - 2 * sw) / 3;
    chip(pdf, 'reg', 'REGISTRADA', 'doc', p.regPor, p.regEm, x0, by, chw, bh);
    seta(pdf, x0 + chw + 1.8, by + bh / 2);
    chip(pdf, p.correcao ? 'cor' : 'nada', 'CORRIGIDA', 'chave', p.correcao && p.correcao.por, p.correcao ? p.correcao.em : 'Aguardando', x0 + chw + sw, by, chw, bh);
    seta(pdf, x0 + 2 * chw + sw + 1.8, by + bh / 2);
    chip(pdf, p.fechamento ? 'fec' : 'nada', 'FECHADA', 'ok', p.fechamento && p.fechamento.por, p.fechamento ? p.fechamento.em : 'Aguardando', x0 + 2 * (chw + sw), by, chw, bh);
  }
  function painelPlanta(pdf, pl, msg, x, y, w, h) {
    pdf.setFillColor(...C2.painel); pdf.setDrawColor(222, 229, 235); pdf.setLineWidth(0.3); pdf.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
    fonte(pdf, 'bold', 9.6, C2.navy); pdf.text('LOCALIZAÇÃO NA PLANTA', x + 4.5, y + 6.6);
    const ax = x + 4, ay = y + 10, aw = w - 8, ah = h - 14;
    if (!pl || pl.erro) return semFotos(pdf, ax, ay, aw, ah, pl && pl.erro ? 'Planta não carregada' : msg || 'Local não marcado na planta');
    const r = pl.w / pl.h; let iw = aw, ih = aw / r; if (ih > ah) { ih = ah; iw = ah * r; }
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(ax + (aw - iw) / 2 - 1, ay + (ah - ih) / 2 - 1, iw + 2, ih + 2, 1.2, 1.2, 'F');
    pdf.addImage(pl.d, 'JPEG', ax + (aw - iw) / 2, ay + (ah - ih) / 2, iw, ih);
  }
  function paginaIndividual2(pdf, o, p, anexos) {
    const y = L2.card1, H = L2.rodLinha - 5 - y, ix = PG.M + 5.5, iw = PG.L - 11;
    moldura(pdf, y, H); const dy = topoCard(pdf, p, y, ix, iw, null);
    // descrição completa (quando é maior que o título)
    let yy = y + 19.5 + dy;
    if (p.descricao && p.descricao !== p.titulo) { fonte(pdf, 'normal', 9.2, C2.tinta); const d = caber(pdf, p.descricao, iw, 3); pdf.text(d.ls, ix, yy + 1.5); yy += d.ls.length * 4.4 + 1.5; if (d.cortou) anexos.push({ tipo: 'texto', rot: 'Descrição completa', txt: p.descricao }); }
    else if (medirTopo(pdf, p, iw).cortou) anexos.push({ tipo: 'texto', rot: 'Descrição completa', txt: p.titulo });
    faixa(pdf, ix, yy, iw, 13, colsPend(p), anexos);
    const fim = y + H - 4, bh = 17.5, by = fim - bh, sep = by - 4;
    const temPlanta = !!(p.planta || p.plantaMsg === 'Planta indisponível');
    const fy = yy + 16.5, plH = temPlanta ? 52 : 0, fh = sep - 4 - fy - (plH ? plH + 4 : 0), g = 5, w2 = (iw - g) / 2;
    // antes e depois lado a lado ou um em cima do outro: o que deixar as fotos maiores
    const areaFotos = (fotos, w, h) => { const L = fotos.slice(0, 4); if (!L.length) return 0; const aw = w - 6, ah = h - 11, linhas = L.length > 2 ? [L.slice(0, 2), L.slice(2)] : [L], lh = (ah - (linhas.length - 1) * 3) / linhas.length;
      return linhas.reduce((tot, ln) => { const rs = ln.map(im => im && !im.erro && im.w ? im.w / im.h : 4 / 3), sr = rs.reduce((a, r) => a + r, 0); const hh = Math.min(lh, (aw - 3 * (ln.length - 1)) / sr); return tot + rs.reduce((a, r) => a + r * hh * hh, 0); }, 0); };
    const hv = (fh - g) / 2, lado = areaFotos(p.fotos.antes, w2, fh) + areaFotos(p.fotos.depois, w2, fh), pilha = areaFotos(p.fotos.antes, iw, hv) + areaFotos(p.fotos.depois, iw, hv);
    const ta = 'ANTES' + (p.dataAntes ? '  ·  ' + p.dataAntes : ''), td = 'DEPOIS' + (p.dataDepois ? '  ·  ' + p.dataDepois : '');
    if (pilha > lado * 1.05) { painelFotos(pdf, ta, p.fotos.antes, ix, fy, iw, hv, 'ind'); painelFotos(pdf, td, p.fotos.depois, ix, fy + hv + g, iw, hv, 'ind'); }
    else { painelFotos(pdf, ta, p.fotos.antes, ix, fy, w2, fh, 'ind'); painelFotos(pdf, td, p.fotos.depois, ix + w2 + g, fy, w2, fh, 'ind'); }
    if (plH) painelPlanta(pdf, p.planta, p.plantaMsg, ix, fy + fh + 4, iw, plH);
    pdf.setDrawColor(...C2.borda); pdf.setLineWidth(0.3); pdf.line(ix, sep, ix + iw, sep);
    linhaTempo(pdf, p, ix, iw, by, bh, anexos);
    return { y0: y, y1: y + H };
  }

  /* ================= Fotográfico: um cartão por pendência, com as fotos dela ================= */
  const F3 = { col: 2, g: 4, fotoH: 66, leg: 5, grupoH: 7, topo: 19.5, pe: 4 };
  function gerarFotografico(pends, o) {
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const vt = 'Relatório fotográfico', layout = [], ix = PG.M + 5.5, iw = PG.L - 11, cw = (iw - (F3.col - 1) * F3.g) / F3.col;
    const topoPag = L2.card1, fimPag = L2.rodLinha - 5;
    pdf.setProperties({ title: (o.titulo || 'Relatório fotográfico') + ' · ' + o.obra, author: o.empresa || '', creator: 'Ferramentas da Obra' });
    let y = 0;
    const pagina = () => { if (pdf.getNumberOfPages() > 1 || y) pdf.addPage(); cab2(pdf, o, vt, pends.length); y = topoPag; };
    pagina();
    if (o.objeto) {   // objeto do relatório (primeira página)
      fonte(pdf, 'normal', 9.2, C2.tinta); const ls = caber(pdf, o.objeto, PG.L - 12, 3).ls; const h = 8 + ls.length * 4.3;
      pdf.setFillColor(...C2.faixa); pdf.roundedRect(PG.M, y, PG.L, h, 2.2, 2.2, 'F');
      fonte(pdf, 'bold', 7.6, C2.rot); pdf.text('OBJETO', PG.M + 5, y + 5.5); fonte(pdf, 'normal', 9.2, C2.tinta); pdf.text(ls, PG.M + 5, y + 10);
      y += h + 5;
    }
    for (const p of pends) {
      // grupos de fotos desta pendência
      const grupos = [{ rot: 'ANTES', fotos: p.fotos.antes }];
      if (o.depois && p.fotos.depois.length) grupos.push({ rot: 'DEPOIS', fotos: p.fotos.depois });
      const linhas = []; grupos.forEach(gp => { linhas.push({ tipo: 'grupo', rot: gp.rot + '  (' + gp.fotos.length + ')', vazio: !gp.fotos.length });
        for (let k = 0; k < gp.fotos.length; k += F3.col) linhas.push({ tipo: 'fotos', fotos: gp.fotos.slice(k, k + F3.col), rot: gp.rot, ini: k }); });
      if (o.planta && (p.planta || p.plantaMsg === 'Planta indisponível')) linhas.push({ tipo: 'planta' });   // só quando o local foi marcado
      const alt = l => l.tipo === 'grupo' ? F3.grupoH + (l.vazio ? 7 : 0) : l.tipo === 'fotos' ? F3.fotoH + F3.leg + 1.5 : 48;
      const TP = F3.topo + Math.max(medirTopo(pdf, p, iw, false).dy, medirTopo(pdf, p, iw, true).dy);
      const total = TP + linhas.reduce((a, l) => a + alt(l), 0) + F3.pe;
      // o cartão inteiro cabe no resto da página? senão, página nova (e, se nem numa página inteira couber, continua na seguinte)
      // não cabe no resto da página: vai inteiro para a próxima se o espaço que sobra é pouco; senão começa aqui e continua (com "continuação")
      const resta = fimPag - y; if (total > resta && resta < (total <= fimPag - topoPag ? 120 : 90)) pagina();
      let i = 0, cont = false;
      while (i < linhas.length || !cont) {
        let h = TP, k = i; while (k < linhas.length && y + h + alt(linhas[k]) + F3.pe <= fimPag) { h += alt(linhas[k]); k++; }
        if (k > i + 1 && k < linhas.length && linhas[k - 1].tipo === 'grupo' && !linhas[k - 1].vazio) { k--; h -= alt(linhas[k]); }   // título "ANTES/DEPOIS" vai junto com as fotos
        if (k === i && i < linhas.length && y > topoPag) { pagina(); continue; }
        if (k === i && i < linhas.length) k = i + 1, h += alt(linhas[i]);   // linha maior que a página: entra assim mesmo
        const y0 = y; h += F3.pe; moldura(pdf, y0, h); topoCard(pdf, p, y0, ix, iw, null, { cont, extra: p.servico });
        let cy = y0 + TP;
        for (let n = i; n < k; n++) { const l = linhas[n];
          if (l.tipo === 'grupo') { fonte(pdf, 'bold', 9, C2.navy); pdf.text(l.rot, ix, cy + 5); pdf.setDrawColor(...C2.borda); pdf.setLineWidth(0.3); pdf.line(ix + pdf.getTextWidth(l.rot) + 3, cy + 4, ix + iw, cy + 4);
            if (l.vazio) { fonte(pdf, 'normal', 8.4, [150, 160, 170]); pdf.text('Sem registro fotográfico', ix, cy + 11.5); } }
          else if (l.tipo === 'fotos') { const fr = fileira(pdf, l.fotos, ix, cy, iw, F3.fotoH, F3.g); let fx = fr.x;
            l.fotos.forEach((im, m) => { fonte(pdf, 'normal', 7.4, C2.cinza); pdf.text(p.numeroTxt + '  ·  ' + (l.rot === 'ANTES' ? 'Antes ' : 'Depois ') + (l.ini + m + 1), fx + fr.ws[m] / 2, cy + F3.fotoH + 3.8, { align: 'center' }); fx += fr.ws[m] + F3.g; }); }
          else painelPlanta(pdf, p.planta, p.plantaMsg, ix, cy + 1, iw, 45);
          cy += alt(l); }
        layout.push({ pend: p.numeroTxt, pagina: pdf.getNumberOfPages(), y0, y1: y0 + h });
        y = y0 + h + 5; i = k; cont = true;
        if (i < linhas.length) pagina();
      }
    }
    const tot = pdf.getNumberOfPages(); for (let k = 1; k <= tot; k++) { pdf.setPage(k); rod2(pdf, o, vt, k, tot); }
    return { pdf, layout };
  }

  /* ---------------- geração ---------------- */
  // modelo: 'individual' | 'consolidado'; devolve { pdf, layout } (layout = posição de cada bloco, para conferir)
  function gerar(modelo, pends, o) {
    if (modelo === 'aberto' || modelo === 'pos') return gerarConsolidado(modelo, pends, o);
    if (modelo === 'fotografico') return gerarFotografico(pends, o);
    // individual: uma página por pendência (e os anexos dela logo depois)
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true }), layout = [], vt = 'Ficha individual';
    pdf.setProperties({ title: 'Relatório de pendências · Individual · ' + o.obra, subject: 'Pendências da obra ' + o.obra + ' (' + pends.length + ')', author: o.empresa || '', creator: 'Ferramentas da Obra' });
    pends.forEach((p, i) => {
      if (i) pdf.addPage();
      cab2(pdf, o, vt + '  ·  ' + p.numeroTxt, null);
      const anexos = []; const r = paginaIndividual2(pdf, o, p, anexos);
      layout.push({ pend: p.numeroTxt, pagina: pdf.getNumberOfPages(), y0: r.y0, y1: r.y1 });
      const itens = anexos.concat(excedentes(p)); if (itens.length) anexosPaginas(pdf, o, vt, [{ p, itens }]);
    });
    const tot = pdf.getNumberOfPages(); for (let k = 1; k <= tot; k++) { pdf.setPage(k); rod2(pdf, o, vt, k, tot); }
    return { pdf, layout };
  }

  window.RelatorioPDF = { gerar, MED, PG };
})();
