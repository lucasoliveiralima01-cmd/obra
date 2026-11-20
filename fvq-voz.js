/* =====================================================================
   Conferência por voz (FVQ): o "entendedor" da conversa, sem IA.
   Recebe o que a pessoa falou (texto vindo do reconhecimento de voz do
   celular) e devolve o que ela quis dizer: conforme, não conforme, medida,
   comandos (pula, volta, repete, não se aplica, quanto falta, foto…) e
   outros itens citados na mesma frase ("sim, e o alçapão também").
   Também guarda as variações de fala do assistente, para a conversa não
   ficar sempre igual.
   Funciona no navegador (window.FVQVoz) e no Node (testes).
   ===================================================================== */
(function (root) {
  'use strict';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[“”"'!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const tem = (t, re) => re.test(t);

  /* ---------- números falados: "noventa e dois", "2,5", "três e meio", "90 e poucos" ---------- */
  const UN = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
    quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
    sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500,
    seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, mil: 1000 };
  // lê o primeiro número da frase; devolve {valor, unidade, vago} ou null
  function numero(txt) {
    let t = norm(txt).replace(/(\d)\s*,\s*(\d)/g, '$1.$2');
    const vago = /\b(e poucos?|e pouquinho|e pouco|e alguma coisa|mais ou menos|uns|umas|quase|cerca de|por volta)\b/.test(t);
    let valor = null, fim = -1;
    const md = t.match(/(-?\d+(?:\.\d+)?)/);
    if (md) { valor = parseFloat(md[1]); fim = md.index + md[0].length;
      const rest = t.slice(fim); if (/^\s*e meio\b/.test(rest)) { valor += 0.5; fim += rest.match(/^\s*e meio/)[0].length; } }
    else {
      // por extenso: soma as palavras numéricas seguidas, ligadas por "e"
      const ws = t.split(' '); let i = 0, achou = false, total = 0, ini = -1;
      for (; i < ws.length; i++) {
        const w = ws[i];
        if (UN[w] != null) { if (!achou) ini = i; achou = true; total += UN[w] === 1000 ? (total ? total * 999 : 999) : UN[w]; continue; }
        if (achou && w === 'e' && i + 1 < ws.length && (UN[ws[i + 1]] != null || ws[i + 1] === 'meio')) continue;
        if (achou && w === 'meio') { total += 0.5; continue; }
        if (achou && (w === 'virgula' || w === 'ponto') && UN[ws[i + 1]] != null) { const d = UN[ws[i + 1]]; total += d / (d >= 10 ? 100 : 10); i++; continue; }
        if (achou) break;
      }
      if (achou) { valor = total; fim = ws.slice(0, i).join(' ').length; }
      // "um" / "uma" sozinho costuma ser artigo ("uma folga"): só vale com unidade logo depois
      if (achou && (total === 1) && !/^\s*(mm|cm|m|milimetros?|centimetros?|metros?|grau|graus)\b/.test(t.slice(fim))) valor = null;
    }
    if (valor == null) return null;
    const depois = t.slice(fim);
    const u = depois.match(/^\s*(mm|milimetros?|cm|centimetros?|m\b|metros?|graus?|%|por cento)/);
    const unidade = !u ? null : /^m(m|ili)/.test(u[1].trim()) ? 'mm' : /^c/.test(u[1].trim()) ? 'cm' : /^(m|metro)/.test(u[1].trim()) ? 'm' : /grau/.test(u[1]) ? 'graus' : '%';
    return { valor, unidade, vago: vago || /\be poucos?\b/.test(depois.slice(0, 12)) };
  }
  // converte para a unidade do item
  function converte(v, de, para) {
    if (!de || !para || de === para) return v;
    const f = { mm: 1, cm: 10, m: 1000 };
    return f[de] && f[para] ? v * f[de] / f[para] : v;
  }

  /* ---------- intenções ---------- */
  const POSITIVO_FORTE = /\b(tudo (certo|ok|okay|bem|beleza|tranquilo|conforme)|sem problemas?|nao tem (nenhum )?problema|nenhum problema|nao tem nada errado|ta (tudo )?(certo|ok|okay|bom|bem|beleza|perfeito|conforme)|esta (tudo )?(certo|ok|conforme)|pode passar|confere|conforme)\b/;
  const NEGATIVO_FORTE = /\b(nao (esta |ta |ficou |e )?(conforme|confere|ok|okay|certo|bom|legal|aprovad[oa]|liberad[oa]|no lugar|nivelad[oa]|alinhad[oa]|fixad[oa])|(ta|esta) (tudo )?(errad[oa]|tort[oa]|ruim)|reprovad[oa])\b/;
  const POSITIVO = /\b(sim|s|ok|okay|oquei|certo|certinho|beleza|blz|positivo|aham|uhum|isso|correto|perfeito|show|feito|pronto|fixad[oa]s?|instalad[oa]s?|no lugar|tranquilo|de boa|bom|bem|top|joia|claro|com certeza|exato|tudo|ta|esta|sim senhor|aprovad[oa]|liberad[oa])\b/;
  const NEGATIVO = /\b(nao conforme|nao confere|nao esta|nao ta|nao foi|nao tem|nao|errad[oa]s?|problemas?|tort[oa]s?|faltando|falta|faltou|quebrad[oa]s?|solt[oa]s?|fora|ruim|negativo|trincad[oa]s?|rachad[oa]s?|manchad[oa]s?|desnivelad[oa]s?|desalinhad[oa]s?|empenad[oa]s?|aberto|aberta|frouxo|frouxa|sujo|suja|danificad[oa]s?|amassad[oa]s?|reprovad[oa]|irregular)\b/;
  const COMANDOS = [
    ['repetir', /\b(repete|repita|repetir|como (e|que e)|o que|oi|hein|nao entendi|fala de novo|de novo|nao ouvi|pode repetir)\b/],
    ['voltar', /\b(volta|voltar|anterior|o de antes|corrige o ultimo|corrigir o ultimo|errei|me enganei|desfaz|desfazer)\b/],
    ['pular', /\b(pula|pular|pule|deixa (pra|para) depois|depois eu vejo|volto depois|passa (esse|essa|pro proximo)|proximo item|pode pular|ainda nao (deu|vi))\b/],
    ['na', /\b(nao se aplica|nao aplica|nao existe|nao tem (isso|esse|essa) (aqui|nesse|neste)|n a|nao precisa|nao tem aqui|nesse (apto|apartamento) nao tem)\b/],
    ['status', /\b(quanto falta|quantos faltam|quantos itens|onde (a gente )?(esta|ta)|em que item|qual item|resumo|como (ta|esta) indo)\b/],
    ['pausa', /\b(pausa|pausar|espera|espera ai|aguarda|um minuto|um momento|so um pouco|segura ai)\b/],
    ['continuar', /\b(continua|continuar|pode continuar|vamos la|bora|segue|seguir|voltei)\b/],
    ['encerrar', /\b(encerra|encerrar|terminar|termina|finaliza|finalizar|acabou|chega por hoje|parar a conferencia|cancela a conferencia)\b/],
    ['foto', /\b(tira|tirar|bate|bater|fotografa|foto|clica|captura)\b/],
    ['semfoto', /\b(sem foto|nao precisa de foto|nao quero foto|pula a foto|dispensa a foto)\b/],
    ['camera', /\b(abre a camera|abrir a camera|abre camera|liga a camera|camera)\b/],
    ['restotudo', /\b(o resto (ta |esta )?(tudo )?(ok|certo|conforme|bom)|resto (ta |esta )?tudo (ok|certo|conforme)|todo o resto|tudo o resto|todos os outros (estao |tao |ta )?(ok|certos|conformes)|o restante (ta |esta )?(ok|certo|conforme))\b/],
    ['anotar', /^(anota|anote|observacao|obs|anotar)\b/]
  ];
  // o que a frase quer dizer: {pol: 'sim'|'nao'|null, cmds: [...], num, texto}
  function entender(txt) {
    const t = norm(txt); const cmds = [];
    for (const [k, re] of COMANDOS) if (re.test(t)) cmds.push(k);
    // "não se aplica" não é "não"; "sem foto" não é "foto"
    if (cmds.includes('na')) { const i = cmds.indexOf('voltar'); if (i >= 0 && !/\bvolta/.test(t)) cmds.splice(i, 1); }
    if (cmds.includes('semfoto')) { const i = cmds.indexOf('foto'); if (i >= 0) cmds.splice(i, 1); }
    if (cmds.includes('camera') && cmds.includes('foto') && !/\b(tira|bate|clica)\b/.test(t)) cmds.splice(cmds.indexOf('foto'), 1);
    let pol = null;
    const semNa = t.replace(/\bnao se aplica\b|\bnao aplica\b/g, ' ');
    if (NEGATIVO_FORTE.test(semNa)) pol = 'nao';
    else if (POSITIVO_FORTE.test(semNa)) pol = 'sim';
    else if (NEGATIVO.test(semNa)) pol = 'nao';
    else if (POSITIVO.test(semNa)) pol = 'sim';
    // "não, tá certo" / "não não, pode passar": o positivo forte ganha; "tá torto" ganha de "tá"
    if (pol === 'sim' && NEGATIVO.test(semNa) && !POSITIVO_FORTE.test(semNa)) pol = 'nao';
    // "quanto falta" não é "falta"; "espera aí" não é resposta
    if (['status', 'pausa', 'encerrar', 'repetir', 'continuar'].some(c => cmds.includes(c))) pol = null;
    return { pol, cmds, num: numero(t), texto: String(txt || '').trim(), t };
  }
  // itens citados na frase (por palavras-chave), na ordem em que aparecem
  function itensCitados(txt, itens) {
    const t = ' ' + norm(txt) + ' '; const r = [];
    for (const it of itens) for (const k of it.chaves || []) { const i = t.indexOf(' ' + norm(k)); if (i >= 0) { r.push({ it, i }); break; } }
    return r.sort((a, b) => a.i - b.i).map(x => x.it);
  }
  // divide a frase em pedaços ("sim, e o alçapão também tá ok, mas o nível deu 8")
  const pedacos = txt => norm(txt).split(/\s*(?:,|;|\bmas\b|\be tambem\b|\bja o\b|\bja a\b|\bagora o\b|\bagora a\b|\balem disso\b|\be o\b|\be a\b|\be os\b|\be as\b)\s*/).filter(Boolean);

  /* ---------- variações de fala ---------- */
  const FALAS = {
    ok: ['Beleza.', 'Anotado.', 'Certo.', 'Ok.', 'Marquei.', 'Perfeito.', 'Show.', 'Fechado.', 'Combinado.', 'Tranquilo.'],
    okMedida: ['Anotei {v}.', '{v}, anotado.', 'Ok, {v}.', 'Beleza, {v}.'],
    transicao: ['', '', 'Agora: ', 'Próximo: ', 'E ', 'Seguindo: ', 'Vamos lá: '],
    nc: ['Entendi, não conforme.', 'Ok, vou marcar como não conforme.', 'Anotado como não conforme.'],
    oQueErrado: ['O que está errado?', 'Me diz o que encontrou.', 'Qual é o problema?', 'O que você viu de errado?'],
    na: ['Ok, não se aplica.', 'Certo, fica como não se aplica.', 'Beleza, não se aplica aqui.'],
    pulei: ['Ok, deixo esse pra depois.', 'Beleza, volto nele no final.', 'Pulei, a gente volta nele.'],
    naoEntendi: ['Não entendi. É conforme ou não conforme?', 'Pode repetir? Diga sim ou não.', 'Desculpa, não peguei. Está conforme?'],
    pedeNumero: ['Quanto deu exatamente?', 'Me fala o número certinho.', 'Qual foi a medida exata?'],
    ultimo: ['Último item: ', 'Pra fechar: ', 'Por último: '],
    metade: ['Metade feita. ', 'Já passamos da metade. ', ''],
    jaDisse: ['{i} você já me disse que está ok.', '{i} já ficou marcado.'],
    pausa: ['Ok, fico esperando. Diga "continuar" quando quiser.', 'Pausado. É só falar "continuar".'],
    voltei: ['Voltando.', 'Ok, de volta.', 'Bora continuar.']
  };
  function sorteio() { const ult = {}; return (k, vars) => { const L = FALAS[k] || [k]; let i = Math.floor(Math.random() * L.length); if (L.length > 1 && i === ult[k]) i = (i + 1) % L.length; ult[k] = i;
    return L[i].replace(/\{(\w+)\}/g, (_, n) => vars && vars[n] != null ? vars[n] : ''); }; }

  const API = { norm, numero, converte, entender, itensCitados, pedacos, FALAS, sorteio };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.FVQVoz = API;
})(typeof window !== 'undefined' ? window : globalThis);
