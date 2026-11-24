/* =====================================================================
   Fotos com data, hora e localização (georreferenciadas)
   ---------------------------------------------------------------------
   - Câmera: hora de agora e a posição do aparelho (GPS), pedida quando a
     pessoa toca em "Tirar foto" para já estar pronta quando a foto volta.
   - Galeria: data e posição gravadas na própria foto (EXIF), quando houver.
   - Endereço (rua, número, bairro, cidade, estado): OpenStreetMap
     (Nominatim, gratuito). Sem internet, a foto sai com as coordenadas.
   - A foto sai com a marca no canto (como as câmeras de obra) e com os
     dados no próprio arquivo (EXIF: data, hora e GPS), que o Google Fotos,
     o Windows e qualquer visualizador leem.
   Uso: FotoGeo.preparar() ao tocar em "Tirar foto";
        const { blob, geo } = await FotoGeo.processar(arquivo, { origem: 'camera' | 'galeria' });
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- posição do aparelho ---------------- */
  let pedido = null, ultima = null, negou = false, avisouNegou = false;
  function preparar() {
    if (!navigator.geolocation) return Promise.resolve(null);
    if (ultima && Date.now() - ultima.em < 60000) return Promise.resolve(ultima);
    if (pedido) return pedido;
    pedido = new Promise(res => {
      navigator.geolocation.getCurrentPosition(p => {
        ultima = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy, alt: p.coords.altitude, em: Date.now() };
        negou = false; pedido = null; res(ultima);
      }, e => { if (e && e.code === 1) negou = true; pedido = null; res(null); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
    });
    return pedido;
  }
  const esperar = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

  /* ---------------- endereço (OpenStreetMap) ---------------- */
  const CACHE_END = 'foto_enderecos';
  function lerCache() { try { return JSON.parse(localStorage.getItem(CACHE_END) || '{}'); } catch (e) { return {}; } }
  async function endereco(lat, lng) {
    const k = lat.toFixed(4) + ',' + lng.toFixed(4);   // ~10 m
    const c = lerCache(); if (c[k]) return c[k];
    if (!navigator.onLine) return null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=' + lat + '&lon=' + lng, { signal: ctl.signal });
      clearTimeout(t); if (!r.ok) return null;
      const a = (await r.json()).address || {};
      const rua = a.road || a.pedestrian || a.footway || a.square || '';
      const linhas = [
        rua ? rua + (a.house_number ? ', ' + a.house_number : '') : '',
        a.suburb || a.neighbourhood || a.quarter || a.city_district || '',
        a.city || a.town || a.village || a.municipality || '',
        a.state || ''
      ].filter(Boolean);
      if (!linhas.length) return null;
      const c2 = lerCache(); const ks = Object.keys(c2); if (ks.length > 300) ks.slice(0, 100).forEach(x => delete c2[x]);
      c2[k] = linhas; try { localStorage.setItem(CACHE_END, JSON.stringify(c2)); } catch (e) {}
      return linhas;
    } catch (e) { return null; }
  }

  /* ---------------- EXIF: leitura (data e GPS das fotos da galeria) ---------------- */
  function lerExif(buf) {
    try {
      const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return null;
      let o = 2;
      while (o + 4 < v.byteLength) {
        const m = v.getUint16(o), len = v.getUint16(o + 2);
        if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return lerTiff(v, o + 10);
        if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) break; o += 2 + len;
      }
    } catch (e) {}
    return null;
  }
  function lerTiff(v, t) {
    const le = v.getUint16(t) === 0x4949, u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
    const ifd = off => { const out = {}; const n = u16(t + off); for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; out[u16(e)] = { tipo: u16(e + 2), n: u32(e + 4), p: e + 8 }; } return out; };
    const val = x => { if (!x) return null; const tam = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[x.tipo] || 1; const p = x.n * tam > 4 ? t + u32(x.p) : x.p;
      if (x.tipo === 2) { let s = ''; for (let i = 0; i < x.n - 1; i++) s += String.fromCharCode(v.getUint8(p + i)); return s; }
      if (x.tipo === 5) { const r = []; for (let i = 0; i < x.n; i++) { const d = u32(p + i * 8 + 4); r.push(d ? u32(p + i * 8) / d : 0); } return r; }
      if (x.tipo === 3) return u16(p); if (x.tipo === 4) return u32(p); return v.getUint8(p); };
    const i0 = ifd(u32(t + 4)), r = {};
    if (i0[0x8769]) { const ex = ifd(val(i0[0x8769])); r.data = val(ex[0x9003]) || val(i0[0x0132]); r.fuso = val(ex[0x9011]); }
    else r.data = val(i0[0x0132]);
    if (i0[0x8825]) {
      const g = ifd(val(i0[0x8825])), la = val(g[2]), lo = val(g[4]);
      if (la && lo && (la[0] || la[1] || la[2])) {
        const dec = d => d[0] + d[1] / 60 + d[2] / 3600;
        r.lat = dec(la) * (val(g[1]) === 'S' ? -1 : 1); r.lng = dec(lo) * (val(g[3]) === 'W' ? -1 : 1);
      }
    }
    return r;
  }
  // "2026:11:24 14:11:05" (+ "-03:00") -> Date
  function dataExif(s, fuso) {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || ''); if (!m) return null;
    const d = fuso && /^[+-]\d{2}:\d{2}$/.test(fuso) ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${fuso}`) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d) ? null : d;
  }

  /* ---------------- EXIF: escrita (data, hora e GPS no arquivo) ---------------- */
  function tiffBytes(geo, quando) {
    const p2 = n => String(n).padStart(2, '0');
    const local = `${quando.getFullYear()}:${p2(quando.getMonth() + 1)}:${p2(quando.getDate())} ${p2(quando.getHours())}:${p2(quando.getMinutes())}:${p2(quando.getSeconds())}`;
    const fz = -quando.getTimezoneOffset(), fuso = (fz < 0 ? '-' : '+') + p2(Math.floor(Math.abs(fz) / 60)) + ':' + p2(Math.abs(fz) % 60);
    const A = s => ({ tipo: 2, v: s }), L = n => ({ tipo: 4, v: [n] }), RT = a => ({ tipo: 5, v: a }), BY = a => ({ tipo: 1, v: a });
    const ifd0 = [[0x0131, A('Ferramentas da Obra')], [0x0132, A(local)], [0x8769, L(0)]];
    const exif = [[0x9003, A(local)], [0x9004, A(local)], [0x9011, A(fuso)]];
    let gps = null;
    if (geo && isFinite(geo.lat) && isFinite(geo.lng)) {
      ifd0.push([0x8825, L(0)]);
      const dms = x => { x = Math.abs(x); const d = Math.floor(x), mf = (x - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 10000); return [[d, 1], [m, 1], [s, 10000]]; };
      const u = new Date(quando.getTime());
      gps = [[0x0000, BY([2, 3, 0, 0])], [0x0001, A(geo.lat < 0 ? 'S' : 'N')], [0x0002, RT(dms(geo.lat))], [0x0003, A(geo.lng < 0 ? 'W' : 'E')], [0x0004, RT(dms(geo.lng))]];
      if (geo.alt != null && isFinite(geo.alt)) gps.push([0x0005, BY([geo.alt < 0 ? 1 : 0])], [0x0006, RT([[Math.round(Math.abs(geo.alt) * 100), 100]])]);
      gps.push([0x0007, RT([[u.getUTCHours(), 1], [u.getUTCMinutes(), 1], [u.getUTCSeconds(), 1]])]);
      gps.push([0x001D, A(`${u.getUTCFullYear()}:${p2(u.getUTCMonth() + 1)}:${p2(u.getUTCDate())}`)]);
      if (geo.precisao) gps.push([0x001F, RT([[Math.round(geo.precisao * 10), 10]])]);
    }
    const enc = e => { const [, x] = e;
      if (x.tipo === 2) { const b = new TextEncoder().encode(x.v); const r = new Uint8Array(b.length + 1); r.set(b); return { n: r.length, b: r }; }
      if (x.tipo === 1) return { n: x.v.length, b: Uint8Array.from(x.v) };
      if (x.tipo === 4) { const r = new Uint8Array(4); new DataView(r.buffer).setUint32(0, x.v[0]); return { n: 1, b: r }; }
      const r = new Uint8Array(8 * x.v.length), dv = new DataView(r.buffer); x.v.forEach(([a, d], i) => { dv.setUint32(i * 8, a); dv.setUint32(i * 8 + 4, d); }); return { n: x.v.length, b: r }; };
    const blocos = [ifd0, exif].concat(gps ? [gps] : []).map(es => { es.sort((a, b) => a[0] - b[0]); const cod = es.map(enc);
      const dados = cod.reduce((a, c) => a + (c.b.length > 4 ? c.b.length + (c.b.length & 1) : 0), 0); return { es, cod, tam: 2 + es.length * 12 + 4 + dados }; });
    let off = 8; blocos.forEach(b => { b.off = off; off += b.tam; });
    // ponteiros para as IFDs de Exif e GPS
    const ptr = (tag, alvo) => { const i = blocos[0].es.findIndex(e => e[0] === tag); if (i >= 0) new DataView(blocos[0].cod[i].b.buffer).setUint32(0, alvo); };
    ptr(0x8769, blocos[1].off); if (gps) ptr(0x8825, blocos[2].off);
    const out = new Uint8Array(off), dv = new DataView(out.buffer);
    out.set([0x4D, 0x4D, 0x00, 0x2A]); dv.setUint32(4, 8);
    blocos.forEach(b => {
      let p = b.off, d = b.off + 2 + b.es.length * 12 + 4; dv.setUint16(p, b.es.length); p += 2;
      b.es.forEach((e, i) => { const c = b.cod[i]; dv.setUint16(p, e[0]); dv.setUint16(p + 2, e[1].tipo); dv.setUint32(p + 4, c.n);
        if (c.b.length <= 4) out.set(c.b, p + 8); else { dv.setUint32(p + 8, d); out.set(c.b, d); d += c.b.length + (c.b.length & 1); } p += 12; });
      dv.setUint32(p, 0);
    });
    return out;
  }
  // devolve o JPEG com o bloco EXIF novo (troca o JFIF/EXIF que houver)
  async function comExif(blob, geo, quando) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer()); if (buf[0] !== 0xFF || buf[1] !== 0xD8) return blob;
      let o = 2; while (o + 4 < buf.length && buf[o] === 0xFF && (buf[o + 1] === 0xE0 || buf[o + 1] === 0xE1)) o += 2 + ((buf[o + 2] << 8) | buf[o + 3]);
      const t = tiffBytes(geo, quando || new Date()), seg = new Uint8Array(10 + t.length);
      const L = 8 + t.length; seg.set([0xFF, 0xE1, L >> 8, L & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]); seg.set(t, 10);
      return new Blob([buf.subarray(0, 2), seg, buf.subarray(o)], { type: 'image/jpeg' });
    } catch (e) { return blob; }
  }

  /* ---------------- marca d'água ---------------- */
  const p2 = n => String(n).padStart(2, '0');
  const dataTxt = d => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const coordTxt = g => `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}${g.precisao ? '  (±' + Math.round(g.precisao) + ' m)' : ''}`;
  function marcar(ctx, w, h, linhas) {
    const base = Math.min(w, h), fs = Math.max(13, Math.round(base * 0.034)), esp = Math.round(fs * 1.22), mx = Math.round(base * 0.035), my = Math.round(base * 0.035);
    ctx.save(); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    let y = h - my - (linhas.length - 1) * esp;
    linhas.forEach((l, i) => {
      const peq = l.peq; ctx.font = `${i === 0 ? '600' : '500'} ${peq ? Math.round(fs * 0.78) : fs}px Roboto, "Segoe UI", Arial, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = Math.max(2, fs * 0.18); ctx.shadowOffsetY = Math.max(1, fs * 0.05);
      ctx.lineWidth = Math.max(2, fs * 0.16); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.strokeText(l.t, w - mx, y);
      ctx.shadowColor = 'transparent'; ctx.fillStyle = '#fff'; ctx.fillText(l.t, w - mx, y); y += esp;
    });
    ctx.restore();
  }

  async function lerImagem(arq) {
    const url = URL.createObjectURL(arq); const img = new Image();
    try { await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('não foi possível ler a imagem')); img.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
    return img;
  }

  // arq: File/Blob; o.origem: 'camera' | 'galeria'; o.lado: maior lado (px); o.qualidade: JPEG
  async function processar(arq, o) {
    o = Object.assign({ origem: 'galeria', lado: 1600, qualidade: 0.78 }, o);
    // 'auto': arquivo criado agora há pouco = foto da câmera; senão, veio da galeria
    if (o.origem === 'auto') o.origem = arq && arq.lastModified && Math.abs(Date.now() - arq.lastModified) < 180000 ? 'camera' : 'galeria';
    let ex = null; try { ex = lerExif(await arq.arrayBuffer()); } catch (e) {}
    let quando, geo = null;
    if (o.origem === 'camera') {
      quando = o.quando || new Date();
      geo = await esperar(preparar(), 8000);
      if (!geo && ex && ex.lat != null) geo = { lat: ex.lat, lng: ex.lng };
      if (!geo && negou && !avisouNegou && o.avisar) { avisouNegou = true; o.avisar('Sem permissão de localização: a foto sai só com data e hora. Libere a localização do navegador para este site.'); }
    } else {
      quando = (ex && dataExif(ex.data, ex.fuso)) || (arq.lastModified ? new Date(arq.lastModified) : new Date());
      if (ex && ex.lat != null) geo = { lat: ex.lat, lng: ex.lng };
    }
    const end = geo ? await endereco(geo.lat, geo.lng) : null;
    const img = o.imagem || await lerImagem(arq);
    const W0 = img.naturalWidth || img.videoWidth || img.width, H0 = img.naturalHeight || img.videoHeight || img.height;
    const linhas = [{ t: dataTxt(quando) }].concat((end || []).map(t => ({ t }))).concat(geo ? [{ t: coordTxt(geo), peq: true }] : []);
    let blob = null;
    for (const lado of [o.lado, 1200, 900]) {   // o iPhone limita a memória de desenho: se falhar, tenta menor
      const sc = Math.min(1, lado / Math.max(W0, H0)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(W0 * sc)); cv.height = Math.max(1, Math.round(H0 * sc));
      const ctx = cv.getContext('2d'); if (!ctx) continue;
      ctx.drawImage(img, 0, 0, cv.width, cv.height); marcar(ctx, cv.width, cv.height, linhas);
      blob = await new Promise(r => { try { cv.toBlob(r, 'image/jpeg', o.qualidade); } catch (e) { r(null); } });
      cv.width = cv.height = 0; if (blob && blob.size) break;
    }
    if (!blob) throw new Error('não foi possível preparar a foto');
    const meta = { tirada_em: quando.toISOString(), lat: geo ? +geo.lat.toFixed(7) : null, lng: geo ? +geo.lng.toFixed(7) : null,
      precisao: geo && geo.precisao ? Math.round(geo.precisao) : null, endereco: end ? end.join(', ') : null };
    return { blob: await comExif(blob, geo, quando), geo: meta };
  }
  // depois de editar a foto (anotações), devolve os dados ao arquivo
  const regravar = (blob, meta) => meta ? comExif(blob, meta.lat != null ? { lat: meta.lat, lng: meta.lng, precisao: meta.precisao } : null, new Date(meta.tirada_em)) : Promise.resolve(blob);
  const linkMapa = m => m && m.lat != null ? 'https://www.google.com/maps?q=' + m.lat + ',' + m.lng : '';

  // "Tirar foto": pede a posição já no toque (quando a foto voltar, ela está pronta)
  document.addEventListener('pointerdown', ev => { const t = ev.target.closest && ev.target.closest('[data-geo], label'); if (!t) return;
    const inp = t.matches('input') ? t : t.querySelector('input[type=file][capture]'); if ((inp && inp.hasAttribute('capture')) || t.hasAttribute('data-geo')) preparar(); }, true);

  window.FotoGeo = { preparar, processar, regravar, lerExif, linkMapa, dataTxt };
})();
