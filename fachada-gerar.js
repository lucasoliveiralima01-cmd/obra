/* =====================================================================
   Mapa de Fachadas: gera as vistas das fachadas a partir do IFC da arquitetura
   ---------------------------------------------------------------------
   Roda uma vez, no computador de quem importa o IFC. O modelo inteiro é lido
   (IFCReader), mas só sobra uma imagem leve de cada fachada:
   - img:  desenho da fachada (cores por tipo de elemento, contornos);
   - mask: mapa do que é parede (1) e do que é abertura (2), para descontar
           janelas e portas da área marcada;
   - níveis dos pavimentos, para as linhas de referência.
   As 4 fachadas seguem os eixos principais das paredes do prédio.
   ===================================================================== */
(function (root) {
  'use strict';
  // elementos que não aparecem na fachada (instalações, mobiliário etc.)
  const FORA = /^IFC(FLOW|DISTRIBUTION|FURNISHING|FURNITURE|SYSTEMFURNITURE|SPACE|SITE|GEOGRAPHIC|TRANSPORT|ANNOTATION|ELECTRIC|SANITARY|LIGHT|OUTLET|SWITCHING|AIRTERMINAL|PIPE|DUCT|CABLE|VALVE|PUMP|TANK|FIRESUPPRESSION|ALARM|SENSOR|UNITARYEQUIPMENT|AUDIOVISUAL|COMMUNICATIONS)/;
  // aberturas e peças que não recebem reboco/pintura
  const ABERT = new Set(['IFCWINDOW', 'IFCDOOR', 'IFCCURTAINWALL', 'IFCPLATE', 'IFCMEMBER', 'IFCRAILING', 'IFCWINDOWSTANDARDCASE', 'IFCDOORSTANDARDCASE']);
  const COR = { 1: [233, 229, 220], 2: [176, 203, 219], 3: [212, 206, 196] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function nomeNivel(n) {
    let s = String(n || '').trim().replace(/^\d+\s*-\s*[A-Z]{2,4}\s*-\s*/i, '');
    return s || String(n || '');
  }
  function rumo(az) { // az: graus a partir do norte, sentido horário
    const N = ['Norte', 'Nordeste', 'Leste', 'Sudeste', 'Sul', 'Sudoeste', 'Oeste', 'Noroeste'];
    return N[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  }

  // ângulo principal das paredes (0..90°), pelo histograma das normais horizontais
  function eixoPrincipal(els) {
    const H = new Float64Array(90);
    for (const e of els) {
      if (!/WALL/.test(e.type)) continue;
      const p = e.pos;
      for (let i = 0; i < p.length; i += 9) {
        const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
        const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const a2 = Math.hypot(nx, ny, nz); if (a2 < 1e-9) continue;
        if (Math.abs(nz) / a2 > 0.2) continue;
        let g = Math.atan2(ny, nx) * 180 / Math.PI; g = ((g % 90) + 90) % 90;
        H[Math.floor(g) % 90] += a2;
      }
    }
    let best = 0, bv = -1;
    for (let i = 0; i < 90; i++) { const v = H[(i + 89) % 90] * 0.5 + H[i] + H[(i + 1) % 90] * 0.5; if (v > bv) { bv = v; best = i; } }
    return (best + 0.5) * Math.PI / 180;
  }

  async function gerar(res, opts) {
    opts = opts || {};
    const prog = opts.onProgress || (async () => {});
    const maxPx = opts.maxPx || 2400;
    const els = res.elements.filter(e => e.pos && e.pos.length && !FORA.test(e.type));
    const cls = els.map(e => ABERT.has(e.type) ? 2 : (/SLAB|BEAM|COLUMN|ROOF/.test(e.type) ? 3 : 1));
    const th = eixoPrincipal(els);
    // norte do projeto (se o IFC não informar, o eixo Y do arquivo)
    const tn = res.trueNorth && Math.hypot(res.trueNorth[0], res.trueNorth[1]) > 0.5 ? res.trueNorth : [0, 1];
    const azDe = (nx, ny) => { // ângulo de (nx,ny) medido a partir do norte, sentido horário
      const a = Math.atan2(nx * tn[1] - ny * tn[0], nx * tn[0] + ny * tn[1]);
      return ((a * 180 / Math.PI) % 360 + 360) % 360;
    };
    // níveis: sem repetir (modelos vinculados repetem os pavimentos)
    // (a cota informada no pavimento vale mais que a posição: vínculos às vezes vêm deslocados)
    const niveis = [];
    const cota = s => (s.elevAttr != null ? s.elevAttr : s.elev) - (res.origin ? res.origin[2] : 0);
    for (const s of res.storeys.slice().sort((a, b) => cota(a) - cota(b))) {
      const z = cota(s);
      if (niveis.some(n => Math.abs(n.z - z) < 0.15)) continue;
      niveis.push({ nome: nomeNivel(s.name), z: +z.toFixed(3) });
    }
    const vistas = [];
    for (let k = 0; k < 4; k++) {
      const ang = th + k * Math.PI / 2;
      const nx = Math.cos(ang), ny = Math.sin(ang);       // normal da fachada (para fora, rumo ao observador)
      const rx = -ny, ry = nx;                              // direita de quem olha a fachada: f × z, com f = -n
      // limites
      let u0 = Infinity, u1 = -Infinity, z0 = Infinity, z1 = -Infinity, dMax = -Infinity, dMin = Infinity;
      for (const e of els) {
        const p = e.pos;
        for (let i = 0; i < p.length; i += 3) {
          const u = p[i] * rx + p[i + 1] * ry, d = p[i] * nx + p[i + 1] * ny, z = p[i + 2];
          if (u < u0) u0 = u; if (u > u1) u1 = u; if (z < z0) z0 = z; if (z > z1) z1 = z; if (d > dMax) dMax = d; if (d < dMin) dMin = d;
        }
      }
      u0 -= 0.5; u1 += 0.5; z0 -= 0.5; z1 += 0.5;
      const px = Math.max(0.015, Math.max(u1 - u0, z1 - z0) / maxPx);
      const W = Math.ceil((u1 - u0) / px), H = Math.ceil((z1 - z0) / px);
      const dep = new Float32Array(W * H).fill(-Infinity);
      const idb = new Int32Array(W * H).fill(-1);
      const shd = new Uint8Array(W * H);
      let last = Date.now();
      for (let ei = 0; ei < els.length; ei++) {
        const p = els[ei].pos;
        for (let i = 0; i < p.length; i += 9) {
          // vértices em pixels (x para a direita, y para baixo) e profundidade
          const ax = (p[i] * rx + p[i + 1] * ry - u0) / px, ay = (z1 - p[i + 2]) / px, ad = p[i] * nx + p[i + 1] * ny;
          const bx = (p[i + 3] * rx + p[i + 4] * ry - u0) / px, by = (z1 - p[i + 5]) / px, bd = p[i + 3] * nx + p[i + 4] * ny;
          const cx = (p[i + 6] * rx + p[i + 7] * ry - u0) / px, cy = (z1 - p[i + 8]) / px, cd = p[i + 6] * nx + p[i + 7] * ny;
          // normal 3D: só as faces viradas para quem olha
          const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
          const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
          const Nx = uy * vz - uz * vy, Ny = uz * vx - ux * vz, Nz = ux * vy - uy * vx;
          const Nl = Math.hypot(Nx, Ny, Nz); if (Nl < 1e-12) continue;
          const fac = (Nx * nx + Ny * ny) / Nl; if (fac < 0.08) continue;
          const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          if (Math.abs(area) < 1e-9) continue;
          let x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
          let y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
          if (x0 > x1 || y0 > y1) continue;
          // luz vinda de cima e da esquerda
          const lam = 0.86 + 0.14 * Math.max(0, fac * 0.8 + (Nz / Nl) * 0.35 - (Nx * rx + Ny * ry) / Nl * 0.25);
          const sv = Math.round(Math.min(1, lam) * 255);
          const inv = 1 / area;
          for (let y = y0; y <= y1; y++) {
            const py = y + 0.5;
            for (let x = x0; x <= x1; x++) {
              const pxx = x + 0.5;
              const w0 = ((bx - pxx) * (cy - py) - (by - py) * (cx - pxx)) * inv;
              const w1 = ((cx - pxx) * (ay - py) - (cy - py) * (ax - pxx)) * inv;
              const w2 = 1 - w0 - w1;
              if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
              const d = w0 * ad + w1 * bd + w2 * cd;
              const o = y * W + x;
              if (d > dep[o]) { dep[o] = d; idb[o] = ei; shd[o] = sv; }
            }
          }
        }
        if (Date.now() - last > 60) { await prog('Desenhando a fachada ' + (k + 1) + ' de 4', (k + ei / els.length) / 4); last = Date.now(); }
      }
      // aproveitamento: corta as bordas vazias
      let bx0 = W, bx1 = -1, by0 = H, by1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (idb[y * W + x] >= 0) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      if (bx1 < 0) continue;
      const m = Math.round(0.4 / px);
      bx0 = Math.max(0, bx0 - m); by0 = Math.max(0, by0 - m); bx1 = Math.min(W - 1, bx1 + m); by1 = Math.min(H - 1, by1 + m);
      const W2 = bx1 - bx0 + 1, H2 = by1 - by0 + 1;
      // profundidade da frente (para escurecer o que está recuado)
      let dF = -Infinity; for (let o = 0; o < dep.length; o++) if (dep[o] > dF) dF = dep[o];
      const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
      const ctx = cv.getContext('2d'); const im = ctx.createImageData(W2, H2); const D = im.data;
      const mk = document.createElement('canvas'); mk.width = W2; mk.height = H2;
      const mctx = mk.getContext('2d'); const mim = mctx.createImageData(W2, H2); const M = mim.data;
      let aParede = 0, aAbert = 0;
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
        const o = (y + by0) * W + (x + bx0); const q = (y * W2 + x) * 4; const id = idb[o];
        if (id < 0) { D[q + 3] = 0; M[q + 3] = 255; continue; }
        const c = cls[id]; const base = COR[c];
        const rec = Math.min(1, Math.max(0, (dF - dep[o]) / 4));
        let f = shd[o] / 255 * (1 - 0.22 * rec);
        // contorno: muda o elemento ou a profundidade em relação ao vizinho
        let borda = false;
        const viz = [x > 0 ? o - 1 : -1, x < W2 - 1 ? o + 1 : -1, y > 0 ? o - W : -1, y < H2 - 1 ? o + W : -1];
        for (const v of viz) {
          if (v < 0) continue; const iv = idb[v];
          if (iv < 0) { borda = true; break; }
          if (dep[v] > dep[o] + 0.03) { borda = true; break; }            // o vizinho está mais à frente
          if (iv !== id && cls[iv] !== c && v > o) { borda = true; break; } // troca de tipo (linha de um lado só)
        }
        if (borda) f *= 0.42;
        D[q] = Math.round(base[0] * f); D[q + 1] = Math.round(base[1] * f); D[q + 2] = Math.round(base[2] * f); D[q + 3] = 255;
        // máscara: vermelho = classe (1 parede, 2 abertura, 3 laje/viga/pilar)
        M[q] = c * 60; M[q + 1] = 0; M[q + 2] = 0; M[q + 3] = 255;
        if (c === 2) aAbert++; else aParede++;
      }
      ctx.putImageData(im, 0, 0); mctx.putImageData(mim, 0, 0);
      const toBlob = (c, t, q) => new Promise(r => c.toBlob(b => r(b), t, q));
      let img = await toBlob(cv, 'image/webp', 0.9);
      if (!img || img.type !== 'image/webp') img = await toBlob(cv, 'image/png');
      const mask = await toBlob(mk, 'image/png');
      const az = azDe(nx, ny);
      vistas.push({
        k, az: Math.round(az) % 360, nome: 'Fachada ' + rumo(az),
        u0: +(u0 + bx0 * px).toFixed(3), z1: +(z1 - by0 * px).toFixed(3), px: +px.toFixed(5), W: W2, H: H2,
        img, mask, previa: cv,
        areaParede: +(aParede * px * px).toFixed(1), areaAbertura: +(aAbert * px * px).toFixed(1)
      });
      await sleep(0);
    }
    await prog('Pronto', 1);
    return { vistas, niveis, eixo: +(th * 180 / Math.PI).toFixed(2), elementos: els.length };
  }

  root.FachadaGerar = { gerar, nomeNivel, rumo };
})(typeof window !== 'undefined' ? window : globalThis);
