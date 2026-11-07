/* =====================================================================
   Carga da obra Start
   ---------------------------------------------------------------------
   Prepara a obra Start com o modelo IFC, o mapa de risco do térreo
   (start.js) e as concretagens (start-concretagem.js), como dados
   normais da obra (não como "exemplo").
   - Completa o que faltar: se uma carga anterior parou no meio, continua
     dali; o que tinha entrado como "exemplo" vira dado normal.
   - Roda na lista de obras e também ao abrir a obra Start em qualquer
     ferramenta, então não importa por onde a pessoa entre.
   - Ao terminar, grava um marcador: se alguém excluir a obra depois,
     ela não volta.
   ===================================================================== */
(function () {
  'use strict';
  const CARGA = { id: 'start', nome: 'Start', arquivo: 'Start.ifc', marca: 'cargas/start-v2' };
  let rodando = null;

  function carregarScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('não foi possível carregar ' + src));
      document.head.appendChild(s);
    });
  }
  const semExemplo = o => JSON.parse(JSON.stringify(o, (k, v) => k === 'exemplo' ? undefined : v));
  const marca = NV => NV.db.doc(CARGA.marca, 'sistema:cargas');

  // true se esta pessoa pode e precisa rodar a carga
  async function precisa(NV) {
    // só quem cria obras (Engenharia e administradores)
    if (!NV || !(NV.perfil ? ['admin', 'engenharia'].includes(NV.perfil) : NV.papel === 'editor')) return false;
    try { return !(await marca(NV).get()).exists; } catch (e) { console.warn('carga Start', e); return false; }
  }

  // progresso(texto, fração 0..1) é opcional
  async function executar(NV, progresso) {
    const p = (t, f) => { try { progresso && progresso(t, f); } catch (e) {} };
    p('Carregando os dados da obra Start…', .02);
    if (!window.DEMO_IFC_GZ || !window.EXAMPLE_AREAS) await carregarScript('start.js');
    if (!window.EXAMPLE_DATA) await carregarScript('start-concretagem.js');
    const agora = new Date().toISOString(), por = NV.usuario.email;
    let obra = await NV.obras.obter(CARGA.id);
    let modelo = obra && obra.modelo && obra.modelo.asset ? obra.modelo : null;
    if (!modelo) {
      p('Enviando o modelo IFC…', .08);
      const gz = Uint8Array.from(atob(window.DEMO_IFC_GZ), c => c.charCodeAt(0));
      const bytes = (await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).byteLength;
      const r = await NV.obras.enviarModelo(CARGA.id, new Blob([gz], { type: 'application/gzip' }));
      modelo = { asset: r.id, nome: CARGA.arquivo, bytes, gz: true, em: agora };
      // grava o modelo na obra já existente logo de cara (se a obra ainda não existe, entra no fim)
      if (obra) obra = await NV.obras.alterar(obra.id, { modelo });
    }
    const itens = [
      ['risco', 'areas', window.EXAMPLE_AREAS],
      ['risco', 'simbolos', window.EXAMPLE_SYMS],
      ['risco', 'revisoes', window.EXAMPLE_REV ? [window.EXAMPLE_REV] : []],
      // a concretagem fictícia "TESTE" do exemplo fica de fora
      ['concretagem', 'concretagens', (window.EXAMPLE_DATA || []).filter(c => !c.teste)]
    ];
    const total = itens.reduce((s, x) => s + (x[2] || []).length, 0); let feito = 0;
    for (const [fe, col, arr] of itens) for (const it of arr || []) {
      feito++; p('Gravando ' + (fe === 'risco' ? 'o mapa de risco' : 'as concretagens') + '… (' + feito + ' de ' + total + ')', .15 + .8 * feito / total);
      if (!it || !it.id) continue;
      const doc = NV.db.doc(col + '/' + it.id, fe + ':' + CARGA.id);
      const at = await doc.get();
      if (at.exists && !(at.data() || {}).exemplo) continue; // já está lá (e pode ter sido editado)
      const o = semExemplo(it); o.atualizado = agora; o.por = por;
      await doc.set(o);
    }
    if (!obra) obra = await NV.obras.criar(CARGA.nome, { id: CARGA.id, modelo });
    else if (!(obra.modelo && obra.modelo.asset)) obra = await NV.obras.alterar(obra.id, { modelo });
    await marca(NV).set({ em: agora, por });
    p('Obra Start pronta.', 1);
    return { concretagens: itens[3][2].length };
  }

  // roda uma vez por página, mesmo que seja chamada de vários lugares
  function rodar(NV, progresso) {
    if (!rodando) rodando = executar(NV, progresso).finally(() => { rodando = null; });
    return rodando;
  }

  window.CargaStart = { id: CARGA.id, precisa, rodar };
})();
