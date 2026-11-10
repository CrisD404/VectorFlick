// Búsqueda por título (internacional u original) sobre todo el catálogo, fuera del hilo principal.
// Los títulos llegan en trozos ordenados por importancia, así que recorrerlos en orden
// ya devuelve primero las películas más conocidas y permite cortar la búsqueda temprano.

let base = '', ver = 0, counts = [], chunkSize = 65536;
const chunks = [];           // { text, ts, norm, ns }  (ts/ns = inicio de cada línea)
let lastQ = null;

const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();   // sin acentos ni mayúsculas
const ARTICLES = new Set(['the ', 'a ', 'an ', 'el ', 'la ', 'los ', 'las ', 'le ', 'les ', "l'", 'der ', 'die ', 'das ', 'il ', 'lo ', 'un ', 'una ', 'o ', 'os ', 'as ']);
// exacto, prefijo, inicio de palabra, términos sueltos, dentro de palabra, términos repartidos entre ambos títulos
const PENALTY = [1, 2.2, 4, 12, 45, 30];
const LIMIT = 40;

// Qué tan bien coincide la consulta con un título (menor = mejor; 9 = no coincide).
function classify(s, nq, terms) {
  const pos = s.indexOf(nq);
  if (pos === 0) return s.length === nq.length ? 0 : 1;
  if (pos > 0) {
    if (ARTICLES.has(s.slice(0, pos))) return s.length === pos + nq.length ? 0 : 1;
    return /[a-z0-9]/.test(s[pos - 1]) ? 4 : 2;
  }
  for (const t of terms) if (!s.includes(t)) return 9;
  return 3;
}

function lineStarts(s, n) {
  const a = new Uint32Array(n);
  let p = 0;
  for (let i = 1; i < n; i++) { p = s.indexOf('\n', p) + 1; if (p === 0) break; a[i] = p; }
  return a;
}
function lineOf(starts, pos) {   // última línea cuyo inicio es <= pos
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; }
  return lo;
}

// los datos vienen pre-comprimidos en gzip (ver fetchData en app.js)
async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  let buf = await r.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return new TextDecoder().decode(buf);
}
async function load() {
  for (let k = 0; k < counts.length; k++) {
    let text = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try { text = await fetchText(`${base}titles/${k}.txt.gz?v=${ver}`); break; }
      catch { await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1))); }
    }
    const n = norm(text);
    chunks.push({ text, ts: lineStarts(text, counts[k]), norm: n, ns: lineStarts(n, counts[k]) });
    if (lastQ && (k < 4 || k % 4 === 3 || k === counts.length - 1)) run(lastQ);
  }
}

function run(m) {
  const nq = norm(m.q).replace(/\s+/g, ' ').trim();
  const loading = chunks.length < counts.length, progress = chunks.length / counts.length;
  if (nq.length < 2) return postMessage({ type: 'r', id: m.id, q: nq, items: [], loading, progress });
  const terms = nq.split(' ');
  const key = terms.reduce((a, b) => (b.length > a.length ? b : a));
  const out = [];
  let worst = Infinity;        // puntaje del resultado nº LIMIT hasta ahora
  for (let c = 0; c < chunks.length; c++) {
    if (out.length >= LIMIT && c * chunkSize + 20 > worst) break;   // nada de aquí en adelante puede entrar
    const { norm: S, ns } = chunks[c];
    let p = -1, hits = 0;
    while ((p = S.indexOf(key, p + 1)) >= 0) {
      const li = lineOf(ns, p), a = ns[li], b = li + 1 < ns.length ? ns[li + 1] - 1 : S.length;
      const line = S.slice(a, b);
      p = b;
      let ok = true;
      for (const t of terms) if (t !== key && !line.includes(t)) { ok = false; break; }
      if (!ok) continue;
      // cada línea es "título" o "título<TAB>título original": se queda con el campo que mejor coincide
      const tab = line.indexOf('\t');
      let cls = 5, field = 0, flen = line.length;
      for (let f = 0; f < (tab < 0 ? 1 : 2); f++) {
        const s = tab < 0 ? line : f ? line.slice(tab + 1) : line.slice(0, tab), cf = classify(s, nq, terms);
        if (cf < cls) { cls = cf; field = f; flen = s.length; }
      }
      const i = c * chunkSize + li;
      out.push({ i, c, li, field, score: (i + 20) * PENALTY[cls] * (1 + flen / 400) });
      if (++hits > 30000) break;
    }
    if (out.length >= LIMIT) {
      out.sort((x, y) => x.score - y.score);
      out.length = LIMIT; worst = out[LIMIT - 1].score;
    }
  }
  out.sort((x, y) => x.score - y.score);
  const items = out.slice(0, LIMIT).map(({ i, c, li, field }) => {
    const { text, ts } = chunks[c];
    const [t, o] = text.slice(ts[li], li + 1 < ts.length ? ts[li + 1] - 1 : text.length).split('\t');
    return field && o ? { i, t, o } : { i, t };          // "o": título original, cuando la coincidencia vino de ahí
  });
  postMessage({ type: 'r', id: m.id, q: nq, items, loading, progress });
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { base = m.base; ver = m.v; counts = m.counts; chunkSize = m.chunkSize; load(); }
  else if (m.type === 'q') { lastQ = m; run(m); }
};
