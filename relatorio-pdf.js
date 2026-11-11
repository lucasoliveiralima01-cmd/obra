/* =====================================================================
   Relatórios de pendências em PDF (jsPDF): Individual e Consolidado.
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
  // texto da correção e do fechamento (o que existir; nada é presumido)
  function linhasEncerramento(p) {
    const cor = p.correcao ? 'Corrigida: ' + [p.correcao.por, p.correcao.em].filter(Boolean).join(' · ') : 'Correção: ainda não informada';
    const fec = p.fechamento ? 'Fechada: ' + [p.fechamento.por, p.fechamento.em].filter(Boolean).join(' · ') : p.status === 'corrigida' ? 'Fechamento: aguardando aprovação' : 'Fechamento: em aberto';
    return { cor, fec };
  }

  /* ---------------- Modelo A: Individual (uma pendência por página) ---------------- */
  function paginaIndividual(pdf, o, p, anexos) {
    const m = MED.ind, X = PG.M, R = PG.W - PG.M;
    cabecalho(pdf, o, 'FICHA INDIVIDUAL  •  Pendência ' + p.numeroTxt);
    // B. identificação
    fonte(pdf, 'bold', 8, COR.azul); pdf.text('PENDÊNCIA ' + p.numeroTxt.toUpperCase(), X, m.idY);
    selo(pdf, p.status, p.statusTxt, R, m.idY - 2, 36);
    fonte(pdf, 'bold', 14.5, COR.tinta); const t = caber(pdf, p.titulo, PG.L - 42, 1); pdf.text(t.ls, X, m.titY);
    fonte(pdf, 'bold', 9, COR.cinza); pdf.text(uma(pdf, p.localTxt, PG.L), X, m.locY);
    if (p.descricao && p.descricao !== p.titulo) { fonte(pdf, 'normal', 8.2, COR.tinta); const d = caber(pdf, p.descricao, PG.L, m.descLinhas); pdf.text(d.ls, X, m.descY); if (d.cortou) anexos.push({ tipo: 'texto', rot: 'Descrição completa', txt: p.descricao }); }
    else if (t.cortou) anexos.push({ tipo: 'texto', rot: 'Descrição completa', txt: p.titulo });
    const g = 4, w3 = (PG.L - 2 * g) / 3, w2 = (PG.L - g) / 2;
    cartao(pdf, X, m.cards1Y, w3, m.cardH, 'Serviço', p.servico);
    cartao(pdf, X + w3 + g, m.cards1Y, w3, m.cardH, 'Prioridade', p.prioridadeTxt, COR_PRI[p.prioridade]);
    cartao(pdf, X + 2 * (w3 + g), m.cards1Y, w3, m.cardH, 'Responsável', p.responsavel);
    cartao(pdf, X, m.cards2Y, w2, m.cardH, 'Bloqueia', p.bloqueia || 'Nenhum serviço bloqueado');
    cartao(pdf, X + w2 + g, m.cards2Y, w2, m.cardH, 'Registrada', p.registrada);
    if (p.bloqueia && pdf.getTextWidth(p.bloqueia) > w2 - 8) anexos.push({ tipo: 'texto', rot: 'Serviços bloqueados', txt: p.bloqueia });
    // C. fotos
    tituloSecao(pdf, '01', 'Registro fotográfico', m.sec1Y);
    quadroFotos(pdf, 'ANTES' + (p.dataAntes ? '  |  ' + p.dataAntes : ''), p.fotos.antes, X, m.fotoY, w2, m.fotoH);
    quadroFotos(pdf, 'DEPOIS' + (p.dataDepois ? '  |  ' + p.dataDepois : ''), p.fotos.depois, X + w2 + g, m.fotoY, w2, m.fotoH);
    // D. planta
    tituloSecao(pdf, '02', 'Localização na planta', m.sec2Y);
    plantaArea(pdf, p.planta, p.plantaMsg, X, m.plantaY, PG.L, m.plantaH);
    // E. correção e encerramento
    tituloSecao(pdf, '03', 'Correção e encerramento', m.sec3Y);
    pdf.setFillColor(...COR.fundo); pdf.roundedRect(X, m.encY, PG.L, m.encH, 2, 2, 'F');
    rotulo(pdf, 'Correção informada', X + 4, m.encY + 5);
    fonte(pdf, 'bold', 9, COR.tinta); const c = caber(pdf, p.correcao && p.correcao.texto ? p.correcao.texto : 'Sem descrição da correção', PG.L - 8, 1); pdf.text(c.ls, X + 4, m.encY + 10);
    if (c.cortou) anexos.push({ tipo: 'texto', rot: 'Correção informada (completa)', txt: p.correcao.texto });
    const e = linhasEncerramento(p); fonte(pdf, 'normal', 7.8, COR.tinta);
    pdf.text(uma(pdf, e.cor, PG.L / 2 - 6), X + 4, m.encY + 15.5); pdf.text(uma(pdf, e.fec, PG.L / 2 - 6), X + PG.L / 2 + 2, m.encY + 15.5);
    return { y0: m.idY - 5, y1: m.encY + m.encH };
  }

  /* ---------------- Modelo B: Consolidado (dois blocos iguais por página) ---------------- */
  function bloco(pdf, p, y0, anexos) {
    const H = MED.con.blocoH, X = PG.M, R = PG.W - PG.M, pad = 5, ix = X + pad, iw = PG.L - 2 * pad;
    pdf.setDrawColor(...COR.linha); pdf.setLineWidth(0.35); pdf.roundedRect(X, y0, PG.L, H, 2, 2, 'S');
    pdf.setFillColor(...COR.azul); pdf.rect(X, y0, PG.L, 1.4, 'F');
    // A. identificação compacta
    fonte(pdf, 'bold', 7.8, COR.azul); pdf.text('PENDÊNCIA ' + p.numeroTxt.toUpperCase(), ix, y0 + 7.5);
    selo(pdf, p.status, p.statusTxt, R - pad, y0 + 4, 30);
    fonte(pdf, 'bold', 11, COR.tinta); const t = caber(pdf, p.titulo, iw - 34, 1); pdf.text(t.ls, ix, y0 + 14);
    if (t.cortou || (p.descricao && p.descricao !== p.titulo)) anexos.push({ tipo: 'texto', rot: 'Descrição completa', txt: p.descricao || p.titulo });
    fonte(pdf, 'normal', 8, COR.cinza); pdf.text(uma(pdf, p.localTxt, iw), ix, y0 + 19);
    fonte(pdf, 'normal', 7.6, COR.tinta);
    pdf.text(uma(pdf, 'Serviço: ' + p.servico + '   |   Prioridade: ' + p.prioridadeTxt + '   |   Resp.: ' + (p.responsavel || '—'), iw), ix, y0 + 24.5);
    if (p.bloqueia) { const b = caber(pdf, 'Bloqueia: ' + p.bloqueia, iw, 1); pdf.text(b.ls, ix, y0 + 29); if (b.cortou) anexos.push({ tipo: 'texto', rot: 'Serviços bloqueados', txt: p.bloqueia }); }
    // B. fotos (áreas fixas)
    const g = 5, w2 = (iw - g) / 2, fy = y0 + MED.con.fotoY, fh = MED.con.fotoH;
    quadroFotos(pdf, 'ANTES', p.fotos.antes, ix, fy, w2, fh);
    quadroFotos(pdf, 'DEPOIS', p.fotos.depois, ix + w2 + g, fy, w2, fh);
    // C. conclusão
    const cy = fy + fh + 5;
    rotulo(pdf, 'Correção', ix, cy, COR.azul);
    fonte(pdf, 'bold', 8.6, COR.tinta); const c = caber(pdf, p.correcao && p.correcao.texto ? p.correcao.texto : 'Sem descrição da correção', iw, 1); pdf.text(c.ls, ix, cy + 4.6);
    if (c.cortou) anexos.push({ tipo: 'texto', rot: 'Correção informada (completa)', txt: p.correcao.texto });
    const e = linhasEncerramento(p); fonte(pdf, 'normal', 7.6, COR.cinza);
    pdf.text(uma(pdf, e.cor + '     |     ' + e.fec, iw), ix, cy + 9.4);
    fonte(pdf, 'normal', 6.6, COR.cinzaClaro); pdf.text(uma(pdf, 'Registrada em ' + p.registrada, iw), ix, y0 + H - 3);
    return { y0, y1: y0 + H };
  }

  /* ---------------- anexos: fotos excedentes e textos longos ---------------- */
  function anexosPaginas(pdf, o, modelo, lista) {
    // lista: [{ p, itens: [{tipo:'texto', rot, txt} | {tipo:'foto', rot, im}] }]
    let y = 0, abriu = false;
    const nova = sub => { pdf.addPage(); cabecalho(pdf, o, sub); y = MED.cab.fim + 6; abriu = true; };
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

  /* ---------------- geração ---------------- */
  // modelo: 'individual' | 'consolidado'; devolve { pdf, layout } (layout = posição de cada bloco, para conferir)
  function gerar(modelo, pends, o) {
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const layout = []; const nomeModelo = modelo === 'individual' ? 'Individual' : 'Consolidado';
    // propriedades do arquivo (aparecem no leitor de PDF e na busca do computador)
    pdf.setProperties({ title: 'Relatório de pendências · ' + nomeModelo + ' · ' + o.obra, subject: 'Pendências da obra ' + o.obra + ' (' + pends.length + ')', author: o.empresa || '', creator: 'Ferramentas da Obra' });
    if (modelo === 'individual') {
      pends.forEach((p, i) => {
        if (i) pdf.addPage();
        const anexos = []; const r = paginaIndividual(pdf, o, p, anexos);
        layout.push({ pend: p.numeroTxt, pagina: pdf.getNumberOfPages(), y0: r.y0, y1: r.y1 });
        const itens = anexos.concat(excedentes(p)); if (itens.length) anexosPaginas(pdf, o, nomeModelo, [{ p, itens }]);
      });
    } else {
      const c = MED.con, todos = [];
      for (let i = 0; i < pends.length; i += 2) {
        if (i) pdf.addPage();
        cabecalho(pdf, o, 'CONSOLIDADO  •  ' + pends.length + ' pendência' + (pends.length > 1 ? 's' : ''));
        fonte(pdf, 'bold', 10, COR.azul); pdf.text('REGISTROS SELECIONADOS', PG.M, c.tituloY);
        if (o.resumo) { fonte(pdf, 'normal', 7.6, COR.cinza); pdf.text(uma(pdf, o.resumo, 100), PG.W - PG.M, c.tituloY, { align: 'right' }); }
        for (let k = 0; k < 2 && i + k < pends.length; k++) {
          const p = pends[i + k], y0 = c.bloco1Y + k * (c.blocoH + c.gap), anexos = [];
          const r = bloco(pdf, p, y0, anexos);
          layout.push({ pend: p.numeroTxt, pagina: pdf.getNumberOfPages(), y0: r.y0, y1: r.y1 });
          todos.push({ p, itens: anexos.concat(excedentes(p)) });
        }
      }
      if (todos.some(x => x.itens.length)) anexosPaginas(pdf, o, nomeModelo, todos);
    }
    const tot = pdf.getNumberOfPages(); for (let k = 1; k <= tot; k++) { pdf.setPage(k); rodape(pdf, o, nomeModelo, k, tot); }
    return { pdf, layout };
  }

  window.RelatorioPDF = { gerar, MED, PG };
})();
