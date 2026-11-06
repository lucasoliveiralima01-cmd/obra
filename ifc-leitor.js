/* Leitor IFC (STEP) em JavaScript puro, sem WebAssembly (mesma cópia do Mapa de Concretagem).
   Usado pelo Mapa de Fachadas para gerar as vistas das fachadas a partir do IFC da arquitetura. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;

  /* ---------- STEP ---------- */
  function decodeStr(s) {
    if (s.indexOf('\\') < 0) return s.replace(/''/g, "'");
    s = s.replace(/''/g, "'");
    s = s.replace(/\\X2\\([0-9A-F]+?)\\X0\\/gi, (m, h) => { let o = ''; for (let i = 0; i + 4 <= h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o; });
    s = s.replace(/\\X4\\([0-9A-F]+?)\\X0\\/gi, (m, h) => { let o = ''; for (let i = 0; i + 8 <= h.length; i += 8) o += String.fromCodePoint(parseInt(h.substr(i, 8), 16)); return o; });
    s = s.replace(/\\X\\([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
    s = s.replace(/\\S\\(.)/g, (m, c) => String.fromCharCode(c.charCodeAt(0) + 128));
    s = s.replace(/\\P.\\/g, '').replace(/\\\\/g, '\\');
    return s;
  }
  // value encoding: ref -> {r:id}; enum -> {e:'X'}; typed -> {t:'IFCLABEL', v:[...]}; string -> string; number; null ($); '*' -> undefined
  function parseArgs(text, start, end) {
    let i = start;
    function val() {
      while (i < end && (text.charCodeAt(i) <= 32)) i++;
      const c = text[i];
      if (c === '(') {
        i++; const arr = [];
        while (true) {
          while (i < end && text.charCodeAt(i) <= 32) i++;
          if (text[i] === ')') { i++; break; }
          arr.push(val());
          while (i < end && text.charCodeAt(i) <= 32) i++;
          if (text[i] === ',') i++;
        }
        return arr;
      }
      if (c === "'") {
        let j = i + 1, s = '';
        while (true) {
          const q = text.indexOf("'", j);
          if (q < 0 || q >= end) { s += text.slice(j, end); i = end; break; }
          if (text[q + 1] === "'") { s += text.slice(j, q + 2); j = q + 2; continue; }
          s += text.slice(j, q); i = q + 1; break;
        }
        return decodeStr(s);
      }
      if (c === '#') { let j = i + 1; while (j < end && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) j++; const r = +text.slice(i + 1, j); i = j; return { r }; }
      if (c === '$') { i++; return null; }
      if (c === '*') { i++; return undefined; }
      if (c === '.') { const j = text.indexOf('.', i + 1); const e = text.slice(i + 1, j); i = j + 1; return e === 'T' ? true : e === 'F' ? false : e === 'U' ? null : { e }; }
      if (c === '"') { const j = text.indexOf('"', i + 1); const s = text.slice(i + 1, j); i = j + 1; return s; }
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
        let j = i; while (j < end && /[A-Za-z0-9_]/.test(text[j])) j++;
        const t = text.slice(i, j).toUpperCase(); i = j;
        while (i < end && text.charCodeAt(i) <= 32) i++;
        const v = val();
        return { t, v: Array.isArray(v) ? v : [v] };
      }
      let j = i; while (j < end && ',)'.indexOf(text[j]) < 0 && text.charCodeAt(j) > 32) j++;
      const n = parseFloat(text.slice(i, j)); i = j; return n;
    }
    // text[start] is '('
    return val();
  }

  class StepFile {
    constructor(text) {
      this.text = text; this.ids = new Map(); this.types = []; this.typeIdx = new Map();
      this.cache = new Map(); this.byType = new Map();
    }
    async index(onProgress) {
      const t = this.text; let pos = t.indexOf('DATA;'); if (pos < 0) pos = 0;
      const n = t.length; let count = 0; let lastYield = Date.now();
      const st = [], en = [], ty = [], idl = [];
      while (true) {
        const h = t.indexOf('#', pos); if (h < 0) break;
        let j = h + 1; while (t.charCodeAt(j) >= 48 && t.charCodeAt(j) <= 57) j++;
        const id = +t.slice(h + 1, j);
        while (t.charCodeAt(j) <= 32) j++;
        if (t[j] !== '=') { pos = j; continue; }
        j++; while (t.charCodeAt(j) <= 32) j++;
        const p = t.indexOf('(', j); const type = t.slice(j, p).trim().toUpperCase();
        // end: next ';' outside quotes
        let k = p;
        while (true) {
          const sc = t.indexOf(';', k), q = t.indexOf("'", k);
          if (sc < 0) { k = n; break; }
          if (q >= 0 && q < sc) { const q2 = t.indexOf("'", q + 1); k = q2 < 0 ? n : q2 + 1; continue; }
          k = sc; break;
        }
        let tix = this.typeIdx.get(type); if (tix === undefined) { tix = this.types.length; this.types.push(type); this.typeIdx.set(type, tix); }
        this.ids.set(id, idl.length); idl.push(id); st.push(p); en.push(k); ty.push(tix);
        let arr = this.byType.get(type); if (!arr) this.byType.set(type, arr = []); arr.push(id);
        pos = k + 1; count++;
        if ((count & 16383) === 0 && onProgress && Date.now() - lastYield > 60) { await onProgress(pos / n); lastYield = Date.now(); }
      }
      this.st = st; this.en = en; this.ty = ty; this.count = count;
      return count;
    }
    type(id) { const k = this.ids.get(id); return k === undefined ? null : this.types[this.ty[k]]; }
    get(id) {
      if (id && typeof id === 'object') id = id.r;
      let c = this.cache.get(id); if (c) return c;
      const k = this.ids.get(id); if (k === undefined) return null;
      c = { id, type: this.types[this.ty[k]], a: parseArgs(this.text, this.st[k], this.en[k]) };
      if (this.cache.size > 400000) this.cache.clear();
      this.cache.set(id, c); return c;
    }
    of(type) { return this.byType.get(type) || []; }
  }

  /* ---------- matemática ---------- */
  const I = () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; // colunas x,y,z, translação t  (m[0..2]=x, m[3..5]=y, m[6..8]=z, m[9..11]=t)
  function mul(A, B) { // A*B
    const r = new Array(12);
    for (let c = 0; c < 4; c++) {
      const bx = B[c * 3], by = B[c * 3 + 1], bz = B[c * 3 + 2];
      r[c * 3] = A[0] * bx + A[3] * by + A[6] * bz + (c === 3 ? A[9] : 0);
      r[c * 3 + 1] = A[1] * bx + A[4] * by + A[7] * bz + (c === 3 ? A[10] : 0);
      r[c * 3 + 2] = A[2] * bx + A[5] * by + A[8] * bz + (c === 3 ? A[11] : 0);
    }
    return r;
  }
  const ap = (M, x, y, z) => [M[0] * x + M[3] * y + M[6] * z + M[9], M[1] * x + M[4] * y + M[7] * z + M[10], M[2] * x + M[5] * y + M[8] * z + M[11]];
  const av = (M, x, y, z) => [M[0] * x + M[3] * y + M[6] * z, M[1] * x + M[4] * y + M[7] * z, M[2] * x + M[5] * y + M[8] * z];
  const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  function frame(o, z, x) {
    z = norm3(z); x = x ? sub3(x, z.map(v => v * dot(x, z))) : null;
    if (!x || Math.hypot(...x) < 1e-9) { const a = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; x = sub3(a, z.map(v => v * dot(a, z))); }
    x = norm3(x); const y = cross(z, x);
    return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2], o[0], o[1], o[2]];
  }
  function invRigid(M) { // inverse assuming orthonormal (with possible uniform scale ignored)
    const r = [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8], 0, 0, 0];
    const t = av(r, M[9], M[10], M[11]); r[9] = -t[0]; r[10] = -t[1]; r[11] = -t[2]; return r;
  }

  /* ---------- triangulação 2D (usa THREE.ShapeUtils se disponível) ---------- */
  function area2(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; } // >0 = anti-horário
  function cleanPoly(p) {
    const o = [];
    for (const q of p) { const l = o[o.length - 1]; if (!l || Math.abs(l[0] - q[0]) > 1e-9 || Math.abs(l[1] - q[1]) > 1e-9) o.push(q); }
    while (o.length > 2 && Math.abs(o[0][0] - o[o.length - 1][0]) < 1e-9 && Math.abs(o[0][1] - o[o.length - 1][1]) < 1e-9) o.pop();
    return o;
  }
  function triangulate(outer, holes) {
    const T = root.THREE && root.THREE.ShapeUtils;
    if (T) {
      const V = p => p.map(q => new root.THREE.Vector2(q[0], q[1]));
      try { const tris = T.triangulateShape(V(outer), holes.map(V)); return tris; } catch (e) { }
    }
    const t = []; for (let i = 1; i + 1 < outer.length; i++) t.push([0, i, i + 1]); return t; // leque (fallback)
  }

  /* ---------- leitor de modelo ---------- */
  async function readIFC(text, opts) {
    opts = opts || {}; const prog = opts.onProgress || (async () => { });
    const F = new StepFile(text);
    await F.index(async f => prog('Lendo entidades', f * 0.35));
    const log = {}; const warn = t => { log[t] = (log[t] || 0) + 1; };
    const schema = (text.slice(0, 2000).match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || '?';

    // unidades
    let scale = 1, angle = null;
    // unidades: vale a lista do IFCUNITASSIGNMENT do projeto (um arquivo pode declarar outras unidades só para grandezas derivadas)
    const assigned = new Set(); for (const id of F.of('IFCUNITASSIGNMENT')) for (const u of (F.get(id).a[0] || [])) if (u && u.r) assigned.add(u.r);
    const useUnit = id => !assigned.size || assigned.has(id);
    for (const id of F.of('IFCSIUNIT')) { if (!useUnit(id)) continue;
      const u = F.get(id).a; const ut = u[1] && u[1].e;
      if (ut === 'LENGTHUNIT') { const pre = u[2] && u[2].e; scale = ({ MILLI: 1e-3, CENTI: 1e-2, DECI: 1e-1, KILO: 1e3 })[pre] || 1; }
      if (ut === 'PLANEANGLEUNIT') angle = 'rad';
    }
    for (const id of F.of('IFCCONVERSIONBASEDUNIT')) { if (!useUnit(id)) continue;
      const u = F.get(id).a; const ut = u[1] && u[1].e; const nm = String(u[2] || '').toUpperCase();
      if (ut === 'LENGTHUNIT') { if (nm.indexOf('FOOT') >= 0) scale = 0.3048; else if (nm.indexOf('INCH') >= 0) scale = 0.0254; }
      if (ut === 'PLANEANGLEUNIT' && nm.indexOf('DEG') >= 0) angle = 'deg';
    }
    const toRad = v => angle === 'deg' ? v * Math.PI / 180 : (angle === 'rad' ? v : (Math.abs(v) > TAU + 0.01 ? v * Math.PI / 180 : v));

    const pt = r => { const e = F.get(r); if (!e) return [0, 0, 0]; const c = e.a[0]; return [c[0] || 0, c[1] || 0, c[2] || 0]; };
    const dirv = r => { const e = F.get(r); if (!e) return null; const c = e.a[0]; return [c[0] || 0, c[1] || 0, c[2] || 0]; };
    // placements (unidades do arquivo; escala aplicada no fim)
    function a2p(r) {
      const e = F.get(r); if (!e) return I();
      if (e.type === 'IFCAXIS2PLACEMENT3D') return frame(pt(e.a[0]), e.a[1] ? dirv(e.a[1]) : [0, 0, 1], e.a[2] ? dirv(e.a[2]) : [1, 0, 0]);
      if (e.type === 'IFCAXIS2PLACEMENT2D') { const o = pt(e.a[0]); const x = e.a[1] ? dirv(e.a[1]) : [1, 0, 0]; return frame([o[0], o[1], 0], [0, 0, 1], [x[0], x[1], 0]); }
      if (e.type === 'IFCAXIS1PLACEMENT') return frame(pt(e.a[0]), e.a[1] ? dirv(e.a[1]) : [0, 0, 1], null);
      warn('placement ' + e.type); return I();
    }
    const lpCache = new Map();
    function lp(r) {
      if (!r) return I(); const id = r.r; if (lpCache.has(id)) return lpCache.get(id);
      const e = F.get(id); let M = I();
      if (e && e.type === 'IFCLOCALPLACEMENT') { M = mul(lp(e.a[0]), a2p(e.a[1])); }
      else if (e) warn('placement ' + e.type);
      lpCache.set(id, M); return M;
    }
    function cto(r) { // cartesian transformation operator
      const e = F.get(r); if (!e) return I(); const a = e.a;
      const o = a[2] ? pt(a[2]) : [0, 0, 0]; const s = a[3] == null ? 1 : a[3];
      let M;
      if (e.type.indexOf('3D') >= 0) {
        const x = a[0] ? dirv(a[0]) : [1, 0, 0]; const z = a[4] ? dirv(a[4]) : [0, 0, 1];
        M = frame(o, z, x);
        const s2 = e.type.indexOf('NONUNIFORM') >= 0 && a[5] != null ? a[5] : s, s3 = e.type.indexOf('NONUNIFORM') >= 0 && a[6] != null ? a[6] : s;
        for (let i = 0; i < 3; i++) { M[i] *= s; M[3 + i] *= s2; M[6 + i] *= s3; }
      } else {
        const x = a[0] ? dirv(a[0]) : [1, 0, 0]; M = frame([o[0], o[1], 0], [0, 0, 1], [x[0], x[1], 0]);
        for (let i = 0; i < 9; i++) M[i] *= s;
      }
      return M;
    }

    /* ---- curvas ---- */
    const ARC = Math.PI / 18; // 10°
    function arcPts(c, r, a0, a1, ccw) {
      let d = a1 - a0; if (ccw) { while (d <= 0) d += TAU; } else { while (d >= 0) d -= TAU; }
      const n = Math.max(2, Math.ceil(Math.abs(d) / ARC)); const o = [];
      for (let i = 0; i <= n; i++) { const t = a0 + d * i / n; o.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
      return o;
    }
    function arc3(p1, p2, p3) { // arco por 3 pontos (2D)
      const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) < 1e-12) return [p1, p3];
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      const r = Math.hypot(ax - ux, ay - uy);
      const a0 = Math.atan2(ay - uy, ax - ux), a1 = Math.atan2(by - uy, bx - ux), a2 = Math.atan2(cy - uy, cx - ux);
      const ccw = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 0;
      return arcPts([ux, uy], r, a0, a2, ccw);
    }
    // devolve lista de pontos [x,y,z] (z=0 para 2D)
    function curve(r, depth) {
      const e = F.get(r); if (!e || (depth || 0) > 12) return [];
      const a = e.a;
      switch (e.type) {
        case 'IFCPOLYLINE': return a[0].map(p => pt(p));
        case 'IFCINDEXEDPOLYCURVE': {
          const P = F.get(a[0]).a[0].map(c => [c[0], c[1], c[2] || 0]);
          if (!a[1]) return P.slice();
          const o = [];
          for (const s of a[1]) {
            const ix = s.v[0]; const q = ix.map(k => P[k - 1]);
            let seg = s.t === 'IFCARCINDEX' ? arc3(q[0], q[1], q[2]).map(p => [p[0], p[1], q[0][2]]) : q;
            if (o.length) seg = seg.slice(1);
            o.push(...seg);
          }
          return o;
        }
        case 'IFCCOMPOSITECURVE': case 'IFCCOMPOSITECURVEONSURFACE': {
          const o = [];
          for (const sr of a[0]) {
            const s = F.get(sr); if (!s) continue;
            let pts = curve(s.a[2], (depth || 0) + 1); if (s.a[1] === false) pts = pts.slice().reverse();
            if (o.length && pts.length && Math.hypot(o[o.length - 1][0] - pts[0][0], o[o.length - 1][1] - pts[0][1]) < 1e-9) pts = pts.slice(1);
            o.push(...pts);
          }
          return o;
        }
        case 'IFCTRIMMEDCURVE': {
          const b = F.get(a[0]); const sense = a[3] !== false;
          const cart = l => (l || []).find(x => x && x.r && F.type(x.r) === 'IFCCARTESIANPOINT');
          const par = l => { const v = (l || []).find(x => x && x.t === 'IFCPARAMETERVALUE'); return v ? v.v[0] : (l || []).find(x => typeof x === 'number'); };
          if (b && (b.type === 'IFCCIRCLE' || b.type === 'IFCELLIPSE')) {
            const M = a2p(b.a[0]); const r1 = b.a[1], r2 = b.type === 'IFCELLIPSE' ? b.a[2] : b.a[1];
            const inv = invRigid(M);
            let t0, t1;
            const c1 = cart(a[1]), c2 = cart(a[2]);
            if (c1 && c2 && (a[4] && a[4].e === 'CARTESIAN' || par(a[1]) == null)) {
              const p1 = ap(inv, ...pt(c1)), p2 = ap(inv, ...pt(c2)); t0 = Math.atan2(p1[1] / r2, p1[0] / r1); t1 = Math.atan2(p2[1] / r2, p2[0] / r1);
            } else { t0 = toRad(par(a[1]) || 0); t1 = toRad(par(a[2]) || 0); }
            let d = t1 - t0; if (sense) { while (d <= 1e-9) d += TAU; } else { while (d >= -1e-9) d -= TAU; }
            const n = Math.max(2, Math.ceil(Math.abs(d) / ARC)); const o = [];
            for (let i = 0; i <= n; i++) { const t = t0 + d * i / n; o.push(ap(M, r1 * Math.cos(t), r2 * Math.sin(t), 0)); }
            return o;
          }
          if (b && b.type === 'IFCLINE') {
            const c1 = cart(a[1]), c2 = cart(a[2]);
            if (c1 && c2) return sense ? [pt(c1), pt(c2)] : [pt(c2), pt(c1)];
            const p0 = pt(b.a[0]); const vec = F.get(b.a[1]); const dd = dirv(vec.a[0]); const mag = vec.a[1] || 1;
            const u0 = par(a[1]) || 0, u1 = par(a[2]) || 0;
            const P = u => [p0[0] + dd[0] * mag * u, p0[1] + dd[1] * mag * u, p0[2] + dd[2] * mag * u];
            return [P(u0), P(u1)];
          }
          if (b) return curve(a[0], (depth || 0) + 1);
          return [];
        }
        case 'IFCCIRCLE': case 'IFCELLIPSE': {
          const M = a2p(a[0]); const r1 = a[1], r2 = e.type === 'IFCELLIPSE' ? a[2] : a[1]; const o = [];
          const n = 36; for (let i = 0; i < n; i++) { const t = TAU * i / n; o.push(ap(M, r1 * Math.cos(t), r2 * Math.sin(t), 0)); }
          return o;
        }
        case 'IFCBSPLINECURVEWITHKNOTS': case 'IFCRATIONALBSPLINECURVEWITHKNOTS': case 'IFCBSPLINECURVE':
          warn('curva B-spline (aproximada)'); return a[1].map(p => pt(p));
        case 'IFCLINE': warn('linha infinita'); return [];
        default: warn('curva ' + e.type); return [];
      }
    }

    /* ---- perfis -> lista de {o:outer, h:[holes]} em 2D ---- */
    function rect(w, h, cx, cy) { cx = cx || 0; cy = cy || 0; return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]]; }
    function circ(r, n) { n = n || 24; const o = []; for (let i = 0; i < n; i++) o.push([r * Math.cos(TAU * i / n), r * Math.sin(TAU * i / n)]); return o; }
    function xf2(M, poly) { return poly.map(p => { const q = ap(M, p[0], p[1], 0); return [q[0], q[1]]; }); }
    function profile(r, depth) {
      const e = F.get(r); if (!e || (depth || 0) > 6) return [];
      const a = e.a; const P = a[2] && e.type !== 'IFCARBITRARYCLOSEDPROFILEDEF' && e.type !== 'IFCARBITRARYPROFILEDEFWITHVOIDS' && e.type !== 'IFCDERIVEDPROFILEDEF' && e.type !== 'IFCCOMPOSITEPROFILEDEF' ? a2p(a[2]) : I();
      const one = (o, h) => [{ o: xf2(P, o), h: (h || []).map(x => xf2(P, x)) }];
      switch (e.type) {
        case 'IFCRECTANGLEPROFILEDEF': return one(rect(a[3], a[4]));
        case 'IFCROUNDEDRECTANGLEPROFILEDEF': return one(rect(a[3], a[4]));
        case 'IFCRECTANGLEHOLLOWPROFILEDEF': { const t = a[5]; return one(rect(a[3], a[4]), [rect(a[3] - 2 * t, a[4] - 2 * t).reverse()]); }
        case 'IFCCIRCLEPROFILEDEF': return one(circ(a[3]));
        case 'IFCCIRCLEHOLLOWPROFILEDEF': return one(circ(a[3]), [circ(a[3] - a[4]).reverse()]);
        case 'IFCELLIPSEPROFILEDEF': return one(circ(1).map(p => [p[0] * a[3], p[1] * a[4]]));
        case 'IFCISHAPEPROFILEDEF': { const W = a[3], D = a[4], tw = a[5], tf = a[6];
          return one([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, -D / 2 + tf], [tw / 2, -D / 2 + tf], [tw / 2, D / 2 - tf], [W / 2, D / 2 - tf], [W / 2, D / 2], [-W / 2, D / 2], [-W / 2, D / 2 - tf], [-tw / 2, D / 2 - tf], [-tw / 2, -D / 2 + tf], [-W / 2, -D / 2 + tf]]); }
        case 'IFCASYMMETRICISHAPEPROFILEDEF': { const W = a[3], D = a[4], tw = a[5], tf = a[6], Wt = a[8] || W, tft = a[9] || tf;
          return one([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, -D / 2 + tf], [tw / 2, -D / 2 + tf], [tw / 2, D / 2 - tft], [Wt / 2, D / 2 - tft], [Wt / 2, D / 2], [-Wt / 2, D / 2], [-Wt / 2, D / 2 - tft], [-tw / 2, D / 2 - tft], [-tw / 2, -D / 2 + tf], [-W / 2, -D / 2 + tf]]); }
        case 'IFCLSHAPEPROFILEDEF': { const D = a[3], W = a[4] || a[3], t = a[5];
          return one([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, -D / 2 + t], [-W / 2 + t, -D / 2 + t], [-W / 2 + t, D / 2], [-W / 2, D / 2]]); }
        case 'IFCTSHAPEPROFILEDEF': { const D = a[3], W = a[4], tw = a[5], tf = a[6];
          return one([[-tw / 2, -D / 2], [tw / 2, -D / 2], [tw / 2, D / 2 - tf], [W / 2, D / 2 - tf], [W / 2, D / 2], [-W / 2, D / 2], [-W / 2, D / 2 - tf], [-tw / 2, D / 2 - tf]]); }
        case 'IFCUSHAPEPROFILEDEF': case 'IFCCSHAPEPROFILEDEF': { const D = a[3], W = a[4], tw = a[5], tf = e.type === 'IFCCSHAPEPROFILEDEF' ? a[5] : a[6];
          return one([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, -D / 2 + tf], [-W / 2 + tw, -D / 2 + tf], [-W / 2 + tw, D / 2 - tf], [W / 2, D / 2 - tf], [W / 2, D / 2], [-W / 2, D / 2]]); }
        case 'IFCZSHAPEPROFILEDEF': { const D = a[3], W = a[4]; warn('perfil Z (aproximado)'); return one(rect(W * 2, D)); }
        case 'IFCARBITRARYCLOSEDPROFILEDEF': { const o = curve(a[2]).map(p => [p[0], p[1]]); return [{ o, h: [] }]; }
        case 'IFCARBITRARYPROFILEDEFWITHVOIDS': { const o = curve(a[2]).map(p => [p[0], p[1]]); return [{ o, h: (a[3] || []).map(c => curve(c).map(p => [p[0], p[1]])) }]; }
        case 'IFCDERIVEDPROFILEDEF': { const M = cto(a[3]); return profile(a[2], (depth || 0) + 1).map(s => ({ o: xf2(M, s.o), h: s.h.map(x => xf2(M, x)) })); }
        case 'IFCCOMPOSITEPROFILEDEF': return [].concat(...a[2].map(p => profile(p, (depth || 0) + 1)));
        case 'IFCARBITRARYOPENPROFILEDEF': case 'IFCCENTERLINEPROFILEDEF': warn('perfil aberto'); return [];
        default: warn('perfil ' + e.type); return [];
      }
    }

    /* ---- malha ---- */
    // malha = array de triângulos [x,y,z,...] (Float64 durante a construção)
    function polyFaces(out, M, loops) { // loops: [outer3d, ...holes3d] planar
      loops = loops.map(L => { const o = []; for (const q of L) { const l = o[o.length - 1]; if (!l || Math.abs(l[0] - q[0]) + Math.abs(l[1] - q[1]) + Math.abs(l[2] - q[2]) > 1e-9) o.push(q); } while (o.length > 2 && Math.abs(o[0][0] - o[o.length - 1][0]) + Math.abs(o[0][1] - o[o.length - 1][1]) + Math.abs(o[0][2] - o[o.length - 1][2]) < 1e-9) o.pop(); return o; }).filter(L => L.length >= 3);
      if (!loops[0] || loops[0].length < 3) return;
      const O = loops[0];
      // normal por Newell
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0, j = O.length - 1; i < O.length; j = i++) { nx += (O[j][1] - O[i][1]) * (O[j][2] + O[i][2]); ny += (O[j][2] - O[i][2]) * (O[j][0] + O[i][0]); nz += (O[j][0] - O[i][0]) * (O[j][1] + O[i][1]); }
      const n = norm3([nx, ny, nz]); if (!isFinite(n[0])) return;
      if (O.length === 3 && loops.length === 1) { for (const p of O) out.push(...ap(M, ...p)); return; }
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      const pr = az >= ax && az >= ay ? (p => [p[0], p[1]]) : ax >= ay ? (p => [p[1], p[2]]) : (p => [p[2], p[0]]);
      const flip = (az >= ax && az >= ay ? n[2] : ax >= ay ? n[0] : n[1]) < 0;
      let o2 = O.map(pr); let hs = loops.slice(1).map(h => h.map(pr));
      const all = O.concat(...loops.slice(1));
      if (flip) { o2 = o2.map(p => [p[0], -p[1]]); hs = hs.map(h => h.map(p => [p[0], -p[1]])); }
      const tris = triangulate(o2, hs);
      for (const t of tris) {
        const pts = t.map(k => all[k]);
        // garante orientação conforme a normal da face
        const tn = cross(sub3(pts[1], pts[0]), sub3(pts[2], pts[0]));
        const ord = dot(tn, n) < 0 ? [0, 2, 1] : [0, 1, 2];
        for (const k of ord) out.push(...ap(M, ...pts[k]));
      }
    }
    function extrude(out, M, prof, dir, depth) {
      const d = norm3(dir).map(v => v * depth);
      for (let { o, h } of prof) {
        o = cleanPoly(o); h = h.map(cleanPoly).filter(x => x.length >= 3);
        if (o.length < 3) continue;
        if (area2(o) < 0) o = o.slice().reverse(); // anti-horário
        h = h.map(x => area2(x) > 0 ? x.slice().reverse() : x);
        const tris = triangulate(o, h); const all = o.concat(...h);
        const up = d[2] >= 0;
        for (const t of tris) {
          const A = all[t[0]], B = all[t[1]], C = all[t[2]];
          // base (normal -dir) e topo (+dir)
          const b = up ? [A, C, B] : [A, B, C], tp = up ? [A, B, C] : [A, C, B];
          for (const p of b) out.push(...ap(M, p[0], p[1], 0));
          for (const p of tp) out.push(...ap(M, p[0] + d[0], p[1] + d[1], d[2]));
        }
        const walls = [o, ...h];
        for (const L of walls) for (let i = 0; i < L.length; i++) {
          const p = L[i], q = L[(i + 1) % L.length];
          const p0 = ap(M, p[0], p[1], 0), q0 = ap(M, q[0], q[1], 0), p1 = ap(M, p[0] + d[0], p[1] + d[1], d[2]), q1 = ap(M, q[0] + d[0], q[1] + d[1], d[2]);
          if (up) out.push(...p0, ...q0, ...q1, ...p0, ...q1, ...p1); else out.push(...p0, ...q1, ...q0, ...p0, ...p1, ...q1);
        }
      }
    }
    function revolve(out, M, prof, axisPl, ang) {
      const ax = axisPl ? a2pAxis(axisPl) : { p: [0, 0, 0], d: [0, 1, 0] }; // eixo no plano do perfil
      const n = Math.max(8, Math.ceil(Math.abs(ang) / ARC));
      for (let { o } of prof) {
        o = cleanPoly(o); if (o.length < 3) continue;
        const rings = [];
        for (let k = 0; k <= n; k++) {
          const t = ang * k / n; const R = rotAxis(ax.p, ax.d, t);
          rings.push(o.map(p => ap(R, p[0], p[1], 0)));
        }
        for (let k = 0; k < n; k++) for (let i = 0; i < o.length; i++) {
          const j = (i + 1) % o.length; const a = rings[k][i], b = rings[k][j], c = rings[k + 1][j], d = rings[k + 1][i];
          for (const p of [a, b, c, a, c, d]) out.push(...ap(M, ...p));
        }
        if (Math.abs(ang) < TAU - 1e-6) { polyFaces(out, M, [rings[0].slice().reverse()]); polyFaces(out, M, [rings[n]]); }
      }
    }
    function a2pAxis(r) { const e = F.get(r); return { p: pt(e.a[0]), d: e.a[1] ? norm3(dirv(e.a[1])) : [0, 0, 1] }; }
    function rotAxis(p, d, t) { // rotação em torno do eixo (p,d)
      const c = Math.cos(t), s = Math.sin(t), C = 1 - c, [x, y, z] = d;
      const R = [x * x * C + c, y * x * C + z * s, z * x * C - y * s, x * y * C - z * s, y * y * C + c, z * y * C + x * s, x * z * C + y * s, y * z * C - x * s, z * z * C + c, 0, 0, 0];
      const q = av(R, p[0], p[1], p[2]); R[9] = p[0] - q[0]; R[10] = p[1] - q[1]; R[11] = p[2] - q[2]; return R;
    }
    function tube(out, M, pts, rad) {
      const N = 12; if (pts.length < 2) return;
      const rings = [];
      let prevN = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]; const t0 = i > 0 ? norm3(sub3(p, pts[i - 1])) : null, t1 = i < pts.length - 1 ? norm3(sub3(pts[i + 1], p)) : null;
        const t = norm3(t0 && t1 ? [t0[0] + t1[0], t0[1] + t1[1], t0[2] + t1[2]] : (t0 || t1));
        let nn = prevN ? sub3(prevN, t.map(v => v * dot(prevN, t))) : (Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
        if (!prevN) nn = sub3(nn, t.map(v => v * dot(nn, t)));
        nn = norm3(nn); prevN = nn; const b = cross(t, nn);
        const ring = []; for (let k = 0; k < N; k++) { const a = TAU * k / N; ring.push([p[0] + rad * (nn[0] * Math.cos(a) + b[0] * Math.sin(a)), p[1] + rad * (nn[1] * Math.cos(a) + b[1] * Math.sin(a)), p[2] + rad * (nn[2] * Math.cos(a) + b[2] * Math.sin(a))]); }
        rings.push(ring);
      }
      for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < N; k++) {
        const a = rings[i][k], b = rings[i][(k + 1) % N], c = rings[i + 1][(k + 1) % N], d = rings[i + 1][k];
        for (const p of [a, b, c, a, c, d]) out.push(...ap(M, ...p));
      }
      polyFaces(out, M, [rings[0].slice().reverse()]); polyFaces(out, M, [rings[rings.length - 1]]);
    }
    function box(out, M, x0, y0, z0, x1, y1, z1) {
      const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) polyFaces(out, M, [f.map(i => P[i])]);
    }
    function clipPlane(tris, Mplane, keepNeg) { // recorta triângulos (coordenadas já no sistema do item) por um plano
      const inv = invRigid(Mplane); const o = [];
      const sd = (x, y, z) => { const q = ap(inv, x, y, z); return keepNeg ? -q[2] : q[2]; }; // >=0 mantém
      const cuts = [];
      for (let i = 0; i < tris.length; i += 9) {
        const P = [[tris[i], tris[i + 1], tris[i + 2]], [tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]]];
        const D = P.map(p => sd(...p));
        if (D.every(d => d >= 0)) { o.push(...P[0], ...P[1], ...P[2]); continue; }
        if (D.every(d => d < 0)) continue;
        const poly = [];
        for (let k = 0; k < 3; k++) {
          const a = P[k], b = P[(k + 1) % 3], da = D[k], db = D[(k + 1) % 3];
          if (da >= 0) poly.push(a);
          if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; poly.push(c); cuts.push(c); }
        }
        for (let k = 1; k + 1 < poly.length; k++) o.push(...poly[0], ...poly[k], ...poly[k + 1]);
      }
      if (cuts.length >= 3) { // tampa no plano (assume seção convexa)
        const L = cuts.map(c => ap(inv, ...c)); const cx = L.reduce((s, p) => s + p[0], 0) / L.length, cy = L.reduce((s, p) => s + p[1], 0) / L.length;
        const ord = L.map((p, i) => [Math.atan2(p[1] - cy, p[0] - cx), i]).sort((a, b) => a[0] - b[0]).map(x => cuts[x[1]]);
        const u = []; for (const p of ord) { const l = u[u.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1], l[2] - p[2]) > 1e-7) u.push(p); }
        const nz = av(Mplane, 0, 0, 1).map(v => keepNeg ? v : -v);
        for (let k = 1; k + 1 < u.length; k++) {
          const tn = cross(sub3(u[k], u[0]), sub3(u[k + 1], u[0]));
          if (dot(tn, nz) >= 0) o.push(...u[0], ...u[k], ...u[k + 1]); else o.push(...u[0], ...u[k + 1], ...u[k]);
        }
      }
      return o;
    }
    function face3(fr) { // IfcFace -> loops 3D
      const f = F.get(fr); if (!f) return null; const loops = []; let outerIdx = 0;
      (f.a[0] || []).forEach((br, i) => {
        const b = F.get(br); if (!b) return; const lpE = F.get(b.a[0]); if (!lpE) return;
        let pts;
        if (lpE.type === 'IFCPOLYLOOP') pts = lpE.a[0].map(p => pt(p));
        else if (lpE.type === 'IFCEDGELOOP') { pts = lpE.a[0].map(oe => { const O = F.get(oe); const E = F.get(O.a[2]); const v = F.get(O.a[3] === false ? E.a[1] : E.a[0]); return pt(v.a[0]); }); warn('face com arestas curvas (aproximada)'); }
        else { warn('loop ' + lpE.type); return; }
        if (b.a[1] === false) pts = pts.slice().reverse();
        if (b.type === 'IFCFACEOUTERBOUND') outerIdx = loops.length;
        loops.push(pts);
      });
      if (!loops.length) return null;
      if (outerIdx) { const o = loops.splice(outerIdx, 1)[0]; loops.unshift(o); }
      return loops;
    }
    function shellFaces(out, M, sr) { const s = F.get(sr); if (!s) return; for (const fr of s.a[0] || []) { const L = face3(fr); if (L) polyFaces(out, M, L); } }

    function item(out, M, r, depth) {
      const e = F.get(r); if (!e || depth > 20) return; const a = e.a;
      switch (e.type) {
        case 'IFCEXTRUDEDAREASOLID': case 'IFCEXTRUDEDAREASOLIDTAPERED': {
          const P = mul(M, a2p(a[1])); extrude(out, P, profile(a[0]), dirv(a[2]) || [0, 0, 1], a[3]); return; }
        case 'IFCREVOLVEDAREASOLID': case 'IFCREVOLVEDAREASOLIDTAPERED': {
          const P = mul(M, a2p(a[1])); revolve(out, P, profile(a[0]), a[2], toRad(a[3])); return; }
        case 'IFCSWEPTDISKSOLID': case 'IFCSWEPTDISKSOLIDPOLYGONAL': { tube(out, M, curve(a[0]), a[1]); return; }
        case 'IFCFACETEDBREP': case 'IFCADVANCEDBREP': case 'IFCFACETEDBREPWITHVOIDS': case 'IFCADVANCEDBREPWITHVOIDS':
          if (e.type.indexOf('ADVANCED') >= 0) warn('brep avançado (aproximado)'); shellFaces(out, M, a[0]); return;
        case 'IFCCLOSEDSHELL': case 'IFCOPENSHELL': shellFaces(out, M, r); return;
        case 'IFCFACEBASEDSURFACEMODEL': for (const s of a[0]) shellFaces(out, M, s); return;
        case 'IFCSHELLBASEDSURFACEMODEL': for (const s of a[0]) shellFaces(out, M, s); return;
        case 'IFCTRIANGULATEDFACESET': case 'IFCTRIANGULATEDIRREGULARNETWORK': {
          const C = F.get(a[0]).a[0]; const idx = a[3]; const pn = e.type === 'IFCTRIANGULATEDFACESET' ? a[4] : a[4];
          const P = k => { const kk = pn && pn.length ? pn[k - 1] : k; const c = C[kk - 1]; return ap(M, c[0], c[1], c[2] || 0); };
          for (const t of idx) out.push(...P(t[0]), ...P(t[1]), ...P(t[2]));
          return;
        }
        case 'IFCPOLYGONALFACESET': {
          const C = F.get(a[0]).a[0]; const pn = a[3];
          const P = k => { const kk = pn && pn.length ? pn[k - 1] : k; const c = C[kk - 1]; return [c[0], c[1], c[2] || 0]; };
          for (const fr of a[2]) { const f = F.get(fr); const loops = [f.a[0].map(P)]; if (f.type === 'IFCINDEXEDPOLYGONALFACEWITHVOIDS') for (const h of f.a[1]) loops.push(h.map(P)); polyFaces(out, M, loops); }
          return;
        }
        case 'IFCMAPPEDITEM': {
          const src = F.get(a[0]); const T = mul(M, mul(cto(a[1]), a2p(src.a[0])));
          const rep = F.get(src.a[1]); for (const it of rep.a[3]) item(out, T, it, depth + 1); return;
        }
        case 'IFCBOOLEANCLIPPINGRESULT': case 'IFCBOOLEANRESULT': {
          const op = a[0] && a[0].e; const first = []; item(first, M, a[1], depth + 1);
          const sec = F.get(a[2]);
          if (op === 'DIFFERENCE' && sec && sec.type === 'IFCHALFSPACESOLID') {
            const pl = F.get(sec.a[0]); if (pl && pl.type === 'IFCPLANE') { const Mp = mul(M, a2p(pl.a[0])); out.push(...clipPlane(first, Mp, sec.a[1] !== false)); return; }
          }
          if (op === 'DIFFERENCE' && sec && sec.type === 'IFCPOLYGONALBOUNDEDHALFSPACE') { warn('recorte limitado (ignorado)'); }
          else if (op === 'DIFFERENCE') warn('subtração booleana (ignorada)');
          out.push(...first);
          if (op === 'UNION') item(out, M, a[2], depth + 1);
          return;
        }
        case 'IFCHALFSPACESOLID': case 'IFCPOLYGONALBOUNDEDHALFSPACE': return;
        case 'IFCCSGSOLID': item(out, M, a[0], depth + 1); return;
        case 'IFCBLOCK': { const P = mul(M, a2p(a[0])); box(out, P, 0, 0, 0, a[1], a[2], a[3]); return; }
        case 'IFCRECTANGULARPYRAMID': { const P = mul(M, a2p(a[0])); box(out, P, 0, 0, 0, a[1], a[2], a[3]); warn('pirâmide (caixa)'); return; }
        case 'IFCRIGHTCIRCULARCYLINDER': { const P = mul(M, a2p(a[0])); extrude(out, P, [{ o: circ(a[2]), h: [] }], [0, 0, 1], a[1]); return; }
        case 'IFCRIGHTCIRCULARCONE': { const P = mul(M, a2p(a[0])); extrude(out, P, [{ o: circ(a[2]), h: [] }], [0, 0, 1], a[1]); warn('cone (cilindro)'); return; }
        case 'IFCSPHERE': { const P = mul(M, a2p(a[0])); const R = a[1]; revolve(out, P, [{ o: arcPts([0, 0], R, -Math.PI / 2, Math.PI / 2, true).concat([[0, 0]]), h: [] }], null, TAU); return; }
        case 'IFCBOUNDINGBOX': { const c = pt(a[0]); box(out, M, c[0], c[1], c[2], c[0] + a[1], c[1] + a[2], c[2] + a[3]); return; }
        case 'IFCGEOMETRICSET': case 'IFCGEOMETRICCURVESET': case 'IFCANNOTATIONFILLAREA': case 'IFCTEXTLITERAL': case 'IFCTEXTLITERALWITHEXTENT': case 'IFCPOLYLINE': case 'IFCCARTESIANPOINT': return;
        default: warn('geometria ' + e.type);
      }
    }

    /* ---- estilos (cor por item de representação) ---- */
    const itemColor = new Map();
    function styleColor(sr, depth) {
      const s = F.get(sr); if (!s || depth > 5) return null;
      if (s.type === 'IFCPRESENTATIONSTYLEASSIGNMENT') { for (const x of s.a[0]) { const c = styleColor(x, depth + 1); if (c) return c; } return null; }
      if (s.type === 'IFCSURFACESTYLE') { for (const x of s.a[2] || []) { const c = styleColor(x, depth + 1); if (c) return c; } return null; }
      if (s.type === 'IFCSURFACESTYLERENDERING' || s.type === 'IFCSURFACESTYLESHADING') {
        const c = F.get(s.a[0]); if (!c) return null; const tr = typeof s.a[1] === 'number' ? s.a[1] : (s.a[1] && s.a[1].v ? s.a[1].v[0] : 0);
        return [c.a[1], c.a[2], c.a[3], 1 - (tr || 0)];
      }
      return null;
    }
    for (const id of F.of('IFCSTYLEDITEM')) {
      const s = F.get(id); if (!s.a[0]) continue;
      for (const st of s.a[1] || []) { const c = styleColor(st, 0); if (c) { itemColor.set(s.a[0].r, c); break; } }
    }
    function repColor(rep) {
      for (const it of rep.a[3] || []) {
        if (itemColor.has(it.r)) return itemColor.get(it.r);
        const e = F.get(it); if (e && e.type === 'IFCMAPPEDITEM') { const src = F.get(e.a[0]); const rr = F.get(src.a[1]); const c = repColor(rr); if (c) return c; }
        if (e && (e.type === 'IFCBOOLEANCLIPPINGRESULT' || e.type === 'IFCBOOLEANRESULT')) { let x = e; let k = 0; while (x && (x.type === 'IFCBOOLEANCLIPPINGRESULT' || x.type === 'IFCBOOLEANRESULT') && k++ < 20) { if (itemColor.has(x.a[1].r)) return itemColor.get(x.a[1].r); x = F.get(x.a[1]); } }
      }
      return null;
    }

    /* ---- estrutura espacial ---- */
    await prog('Lendo pavimentos', 0.36);
    const parentOf = new Map(); // filho -> pai (agregação/aninhamento)
    for (const t of ['IFCRELAGGREGATES', 'IFCRELNESTS']) for (const id of F.of(t)) { const a = F.get(id).a; if (!a[4]) continue; for (const c of a[5] || []) parentOf.set(c.r, a[4].r); }
    const containedIn = new Map();
    for (const id of F.of('IFCRELCONTAINEDINSPATIALSTRUCTURE')) { const a = F.get(id).a; for (const c of a[4] || []) containedIn.set(c.r, a[5].r); }
    const storeys = F.of('IFCBUILDINGSTOREY').map(id => { const e = F.get(id); const M = lp(e.a[5]); return { id, gid: e.a[0], name: e.a[2] || e.a[7] || ('Pavimento #' + id), longName: e.a[7] || '', elev: M[11] * scale, elevAttr: typeof e.a[9] === 'number' ? e.a[9] * scale : null }; });
    const stSet = new Set(storeys.map(s => s.id));
    function storeyOf(id) { let x = id, k = 0; while (x && k++ < 30) { if (stSet.has(x)) return x; x = containedIn.get(x) || parentOf.get(x); } return null; }

    // tipos, propriedades e materiais (índices para consulta sob demanda)
    const typeOf = new Map(), psetsOf = new Map(), matOf = new Map();
    for (const id of F.of('IFCRELDEFINESBYTYPE')) { const a = F.get(id).a; for (const o of a[4] || []) typeOf.set(o.r, a[5].r); }
    for (const id of F.of('IFCRELDEFINESBYPROPERTIES')) { const a = F.get(id).a; if (!a[5]) continue; for (const o of a[4] || []) { let l = psetsOf.get(o.r); if (!l) psetsOf.set(o.r, l = []); l.push(a[5].r); } }
    for (const id of F.of('IFCRELASSOCIATESMATERIAL')) { const a = F.get(id).a; for (const o of a[4] || []) matOf.set(o.r, a[5].r); }

    /* ---- produtos ---- */
    const SKIP = new Set(['IFCOPENINGELEMENT', 'IFCOPENINGSTANDARDCASE', 'IFCVIRTUALELEMENT', 'IFCANNOTATION', 'IFCGRID', 'IFCPROJECT', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSITE', 'IFCSPACE', 'IFCDISTRIBUTIONPORT', 'IFCALIGNMENT', 'IFCZONE']);
    const products = [];
    for (let t = 0; t < F.types.length; t++) {
      const tn = F.types[t]; if (SKIP.has(tn) || !tn.startsWith('IFC')) continue;
      const ids = F.byType.get(tn); if (!ids || !ids.length) continue;
      // amostra: o 1º precisa ter GlobalId e placement
      const k0 = F.ids.get(ids[0]); if (F.text[F.st[k0] + 1] !== "'") continue;
      const s = F.get(ids[0]); if (!s || s.a.length < 7 || typeof s.a[0] !== 'string') continue;
      if (s.a[5] != null && !(s.a[5].r && F.type(s.a[5].r) === 'IFCLOCALPLACEMENT')) continue;
      if (s.a[6] != null && !(s.a[6].r && F.type(s.a[6].r) === 'IFCPRODUCTDEFINITIONSHAPE')) continue;
      for (const id of ids) { const e = F.get(id); if (e.a[5] && e.a[5].r) products.push(id); }
    }
    // origem do arquivo: mediana das translações dos placements
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < products.length; i += Math.max(1, Math.floor(products.length / 400))) { const e = F.get(products[i]); const M = lp(e.a[5]); xs.push(M[9]); ys.push(M[10]); zs.push(M[11]); }
    const med = v => { v.sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
    const origin = [Math.round(med(xs) * scale), Math.round(med(ys) * scale), 0];

    const elements = []; let tri = 0; let last = Date.now();
    for (let n = 0; n < products.length; n++) {
      const id = products[n]; const e = F.get(id); const a = e.a;
      const el = { eid: id, gid: a[0], type: e.type, name: a[2] || '', desc: a[3] || '', objType: a[4] || '', tag: typeof a[7] === 'string' ? a[7] : '', storey: storeyOf(id), parent: parentOf.get(id) || null };
      if (a[6] && a[6].r) {
        const M = lp(a[5]); const shape = F.get(a[6]); const reps = (shape.a[2] || []).map(r => F.get(r)).filter(Boolean);
        let pick = reps.find(r => r.a[1] === 'Body') || reps.find(r => r.a[1] === 'Facetation') || reps.find(r => !r.a[1] && r.a[2] !== 'Curve2D') || null;
        let boxOnly = false; if (!pick) { pick = reps.find(r => r.a[1] === 'Box'); boxOnly = !!pick; }
        if (pick) {
          const out = [];
          try { for (const it of pick.a[3] || []) item(out, M, it, 0); } catch (err) { warn('erro de geometria: ' + (err && err.message || err)); }
          if (out.length) {
            const f = new Float32Array(out.length);
            for (let i = 0; i < out.length; i += 3) { f[i] = out[i] * scale - origin[0]; f[i + 1] = out[i + 1] * scale - origin[1]; f[i + 2] = out[i + 2] * scale - origin[2]; }
            el.pos = f; el.color = repColor(pick); tri += out.length / 9;
            let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
            for (let i = 0; i < f.length; i += 3) { const x = f[i], y = f[i + 1], z = f[i + 2]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z; }
            el.bb = [x0, y0, z0, x1, y1, z1];
          }
        }
      }
      elements.push(el);
      if (Date.now() - last > 50) { await prog('Gerando geometria', 0.38 + 0.6 * n / products.length); last = Date.now(); }
    }
    // aberturas (IfcOpeningElement via IfcRelVoidsElement): guardadas no elemento hospedeiro para descontar na planta e no volume
    const byEid = new Map(elements.map(e => [e.eid, e])); let nVoid = 0;
    for (const id of F.of('IFCRELVOIDSELEMENT')) {
      const a = F.get(id).a; const host = byEid.get(a[4] && a[4].r); if (!host || !host.pos) continue;
      const op = F.get(a[5]); if (!op || !op.a[6] || !op.a[6].r) continue;
      try {
        const M = lp(op.a[5]); const shape = F.get(op.a[6]); const reps = (shape.a[2] || []).map(r => F.get(r)).filter(Boolean);
        const pick = reps.find(r => r.a[1] === 'Body') || reps.find(r => r.a[2] !== 'Curve2D') || null; if (!pick) continue;
        const out = []; for (const it of pick.a[3] || []) item(out, M, it, 0); if (!out.length) continue;
        const f = new Float32Array(out.length); for (let i = 0; i < out.length; i += 3) { f[i] = out[i] * scale - origin[0]; f[i + 1] = out[i + 1] * scale - origin[1]; f[i + 2] = out[i + 2] * scale - origin[2] }
        (host.voids = host.voids || []).push(f); nVoid++;
      } catch (err) { warn('abertura não lida') }
    }
    // elementos sem pavimento: pelo pai ou pela cota
    const stSorted = storeys.slice().sort((a, b) => a.elev - b.elev);
    for (const el of elements) {
      if (!el.storey && el.parent) el.storey = storeyOf(el.parent);
      if (!el.storey && el.bb && stSorted.length) { const z = el.bb[2] + origin[2] + 0.05; let s = stSorted[0]; for (const t of stSorted) if (t.elev <= z) s = t; el.storey = s.id; el.storeyGuess = true; }
    }
    const projE = F.of('IFCPROJECT')[0]; const proj = projE ? F.get(projE).a : [];

    function props(eid) { // propriedades sob demanda
      const out = [];
      const val = v => { if (v == null) return ''; if (typeof v === 'object' && v.t) return val(v.v[0]); if (typeof v === 'object' && v.e) return v.e; if (v === true) return 'Sim'; if (v === false) return 'Não'; return typeof v === 'number' ? +v.toFixed(4) : String(v); };
      const t = typeOf.get(eid); if (t) { const te = F.get(t); out.push({ g: 'Tipo', k: te.type.replace('IFC', ''), v: te.a[2] || '' }); for (const ps of te.a[5] || []) addPset(ps); }
      const m = matOf.get(eid); if (m) out.push({ g: 'Material', k: 'Material', v: matName(m) });
      for (const ps of psetsOf.get(eid) || []) addPset({ r: ps });
      function addPset(r) {
        const p = F.get(r); if (!p) return;
        if (p.type === 'IFCPROPERTYSET') for (const pr of p.a[4] || []) { const q = F.get(pr); if (q && q.type === 'IFCPROPERTYSINGLEVALUE') out.push({ g: p.a[2], k: q.a[0], v: val(q.a[2]) }); }
        if (p.type === 'IFCELEMENTQUANTITY') for (const pr of p.a[5] || []) { const q = F.get(pr); if (q) out.push({ g: p.a[2], k: q.a[0], v: val(q.a[3]) }); }
      }
      function matName(r) { const x = F.get(r); if (!x) return ''; switch (x.type) {
        case 'IFCMATERIAL': return x.a[0];
        case 'IFCMATERIALLIST': return x.a[0].map(matName).join(', ');
        case 'IFCMATERIALLAYERSETUSAGE': return matName(x.a[0]);
        case 'IFCMATERIALLAYERSET': return x.a[0].map(l => { const L = F.get(l); return matName(L.a[0]) + (L.a[1] ? ' ' + (+(L.a[1] * scale * 100).toFixed(1)) + ' cm' : ''); }).join(' | ');
        case 'IFCMATERIALPROFILESETUSAGE': return matName(x.a[0]);
        case 'IFCMATERIALPROFILESET': return (x.a[2] || []).map(p => matName(F.get(p).a[2])).join(', ');
        case 'IFCMATERIALCONSTITUENTSET': return (x.a[2] || []).map(c => matName(F.get(c).a[2])).join(', ');
        default: return x.type.replace('IFC', ''); } }
      return out;
    }
    // norte verdadeiro (direção no plano do projeto), se o arquivo informar
    let trueNorth = null;
    for (const id of F.of('IFCGEOMETRICREPRESENTATIONCONTEXT')) { const a = F.get(id).a; if (a[5] && a[5].r) { const d = dirv(a[5]); if (d) { trueNorth = [d[0], d[1]]; break; } } }
    await prog('Pronto', 1);
    return { trueNorth, schema, scale, origin, project: proj[2] || proj[3] || '', storeys, elements, triangles: tri, voids: nVoid, log, entities: F.count, props, products: products.length };
  }
  root.IFCReader = { readIFC, parseArgs, decodeStr };
})(typeof window !== 'undefined' ? window : globalThis);
