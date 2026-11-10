// VectorFlick — visor WebGL2 de ~2M de películas.
// Sin dependencias. Los datos se cargan en trozos ordenados por importancia (primero las más votadas).

const DATA = 'data/';
const IMG = 'https://image.tmdb.org/t/p/';
const $ = (s) => document.querySelector(s);

// nombre TMDB -> [nombre en español, color]
const GENRE_META = {
  '': ['Sin género', '#59606e'],
  'Action': ['Acción', '#f4511e'], 'Adventure': ['Aventura', '#ffa726'], 'Animation': ['Animación', '#ffe04a'],
  'Comedy': ['Comedia', '#c6e03a'], 'Crime': ['Crimen', '#c08a5a'], 'Documentary': ['Documental', '#26c6da'],
  'Drama': ['Drama', '#4f8ff7'], 'Family': ['Familia', '#7ddc6f'], 'Fantasy': ['Fantasía', '#a67bff'],
  'History': ['Historia', '#e6d5a8'], 'Horror': ['Terror', '#e8234a'], 'Music': ['Música', '#e05cf5'],
  'Mystery': ['Misterio', '#6f6bf0'], 'Romance': ['Romance', '#ff7eb6'], 'Science Fiction': ['Ciencia ficción', '#1de9b6'],
  'TV Movie': ['Película de TV', '#8fa3b0'], 'Thriller': ['Suspense', '#b03a6e'], 'War': ['Bélica', '#8d9b53'],
  'Western': ['Western', '#b5773c'],
};
const LANG_COLORS = ['#4f8ff7', '#ffa726', '#e8234a', '#1de9b6', '#ffe04a', '#a67bff', '#7ddc6f', '#ff7eb6', '#26c6da',
  '#c08a5a', '#e05cf5', '#c6e03a', '#f4511e', '#6f6bf0', '#e6d5a8', '#8d9b53'];
const YEAR_STOPS = [[1895, '#6b46c9'], [1930, '#a54fd0'], [1955, '#d94fa6'], [1975, '#ff6f61'], [1995, '#ffa53d'], [2012, '#ffd84d'], [2027, '#fff8b0']];
const RATING_STOPS = [[10, '#c22f45'], [40, '#ef5350'], [58, '#ff9d2e'], [68, '#ffd84d'], [78, '#6fdc8c'], [88, '#2ee6c8'], [100, '#c8fbff']];
const UNKNOWN = '#59606e';
const F_POSTER = 1, F_ADULT = 2, F_OVERVIEW = 4, F_IMDB_ONLY = 8, F_SAVED = 16;   // F_SAVED se enciende en el navegador
// JustWatch: la ruta de búsqueda cambia según el idioma de cada país
const JW = Object.fromEntries([
  ...['ar', 'mx', 'es', 'co', 'cl', 'pe', 'uy', 've', 'ec', 'bo', 'py', 'cr', 'gt'].map((c) => [c.toUpperCase(), c + '/buscar']),
  ...['us', 'ca', 'au', 'ie', 'in', 'nl', 'se'].map((c) => [c.toUpperCase(), c + '/search']),
  ['GB', 'uk/search'], ['FR', 'fr/recherche'], ['DE', 'de/Suche'], ['IT', 'it/cerca'], ['BR', 'br/busca'],
]);

const glc = $('#gl'), ov = $('#overlay'), ctx = ov.getContext('2d');
const gl = glc.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });

let M = null;                    // manifest
let N = 0, loaded = 0;           // total de nodos / nodos ya cargados (siempre un prefijo 0..loaded)
let XY, AT, GM;                  // posiciones, atributos (8 bytes/nodo) y máscara de géneros
const chunks = [];               // {off, n, vao, cs, ci}
let titles0 = null;              // títulos del primer trozo (los más importantes), disponibles al instante
let W = 0, H = 0, dpr = 1;
const cam = { x: 0, y: 0, s: 0 };
let sFit = 1, sMin = 0.1, sMax = 40;
let maxPoint = 256;
const GRID = 256;
let gx0 = 0, gy0 = 0, gcw = 1, gch = 1;

const filt = { gmask: 0, gall: false, y0: 0, y1: 255, rating: 0, lang: -1, onlyPoster: false, hideAdult: false, onlySaved: false };
let colorMode = 0, showLabels = true;
let hover = -1, selected = -1, selSimilar = [], selDetails = null;
let saved = [];                  // guardadas: [{c: id estable, i: nodo (-1 si aún no se ubicó), t, y, g, p, at}]
const savedByCode = new Map();
let palette = null;              // Uint8Array 256x4 RGBA
let needsRender = false, lastInteraction = 0;

// ------------------------------------------------------------------ utilidades
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('es');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function gradient(stops, v) {
  if (v <= stops[0][0]) return hex2rgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = hex2rgb(stops[i - 1][1]), b = hex2rgb(stops[i][1]), t = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t));
    }
  }
  return hex2rgb(stops[stops.length - 1][1]);
}
let langNames = null;
function langName(code) {
  if (!code) return 'Idioma desconocido';
  if (code === 'cn') return 'Cantonés';
  if (code === 'xx') return 'Sin diálogos';
  if (code === 'sh') return 'Serbocroata';
  try {
    langNames ??= new Intl.DisplayNames(['es'], { type: 'language' });
    const n = langNames.of(code);
    return n && n !== code ? n[0].toUpperCase() + n.slice(1) : code.toUpperCase();
  } catch { return code.toUpperCase(); }
}
const genreName = (id) => GENRE_META[id ? M.genres[id - 1] : ''][0];
const genreColor = (id) => GENRE_META[id ? M.genres[id - 1] : ''][1];
const yearOf = (i) => { const b = AT[i * 8 + 2]; return b ? b + M.yearBase : 0; };
const tileOf = (i) => AT[i * 8 + 6] | (AT[i * 8 + 7] << 8);
function colorOf(i) {
  const a = i * 8;
  const idx = colorMode === 0 ? AT[a + 1] : colorMode === 1 ? AT[a + 2] : colorMode === 2 ? AT[a + 3] : AT[a + 4];
  const p = (colorMode * 256 + idx) * 4;
  return `rgb(${palette[p]},${palette[p + 1]},${palette[p + 2]})`;
}
function passes(i) {
  const a = i * 8, fl = AT[a + 5];
  if (filt.hideAdult && (fl & F_ADULT)) return false;
  if (filt.onlyPoster && !(fl & F_POSTER)) return false;
  if (filt.onlySaved && !(fl & F_SAVED)) return false;
  if (filt.gmask) { const m = GM[i] & filt.gmask; if (filt.gall ? m !== filt.gmask : m === 0) return false; }
  const y = AT[a + 2];
  if (y < filt.y0 || y > filt.y1) return false;
  if (AT[a + 3] < filt.rating) return false;
  if (filt.lang >= 0 && AT[a + 4] !== filt.lang) return false;
  return true;
}
// radio en px CSS, igual que el vertex shader
function radiusPx(i) {
  const sz = AT[i * 8] / 255;
  return Math.max((M.rMin + (M.rMax - M.rMin) * sz) * cam.s, 0.55 + 2.3 * Math.pow(sz, 1.15));
}
const sx = (x) => (x - cam.x) * cam.s + W / 2;
const sy = (y) => (y - cam.y) * cam.s + H / 2;

// ------------------------------------------------------------------ WebGL
const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_a;   // tamaño, género, año, nota
layout(location=2) in vec4 a_b;   // idioma, flags, tile lo, tile hi
layout(location=3) in uint a_gm;
uniform vec2 u_cam, u_vp, u_year;
uniform float u_scale, u_dpr, u_rMin, u_rMax, u_maxPt, u_rating, u_lang, u_density, u_boost;
uniform int u_mode, u_gall;
uniform uint u_gmask, u_hide, u_req;
uniform sampler2D u_pal;
out vec4 v_col;
out float v_rad, v_ps;
void main() {
  float sz = a_a.x / 255.0;
  float rpx = mix(u_rMin, u_rMax, sz) * u_scale;
  float minr = (0.55 + 2.3 * pow(sz, 1.15)) * u_dpr;
  float r = max(rpx, minr);
  uint fl = uint(a_b.y);
  bool pass = (fl & u_hide) == 0u && (fl & u_req) == u_req;
  if (u_gmask != 0u) { uint m = a_gm & u_gmask; pass = pass && (u_gall == 1 ? m == u_gmask : m != 0u); }
  pass = pass && a_a.z >= u_year.x && a_a.z <= u_year.y && a_a.w >= u_rating;
  if (u_lang >= 0.0) pass = pass && a_b.x == u_lang;
  float idx = u_mode == 0 ? a_a.y : u_mode == 1 ? a_a.z : u_mode == 2 ? a_a.w : a_b.x;
  vec3 c = texelFetch(u_pal, ivec2(int(idx), u_mode), 0).rgb;
  // lejos: los nodos chicos son motas tenues y la densidad se acumula; cerca: discos opacos
  float cover = clamp(rpx / minr, 0.0, 1.0);
  float a = mix(mix(u_density, 1.0, sqrt(sz)), 1.0, cover * cover);
  // LOD: si de este trozo se dibuja solo una fracción, cada mota pesa más para conservar la densidad
  if (u_boost > 1.0) a = 1.0 - pow(1.0 - a, u_boost);
  if (!pass) { c = vec3(dot(c, vec3(0.3, 0.5, 0.2)) * 0.55 + 0.08); a *= 0.07; r = max(rpx, minr * 0.7); }
  v_col = vec4(c, a);
  v_rad = r;
  v_ps = min(2.0 * r + 1.0, u_maxPt);   // medio píxel de margen por lado alcanza para el antialias
  gl_PointSize = v_ps;
  gl_Position = vec4((a_pos - u_cam) * u_scale / (u_vp * 0.5) * vec2(1.0, -1.0), 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec4 v_col;
in float v_rad, v_ps;
out vec4 o;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * v_ps;
  float d = length(p);
  float aa = clamp(v_rad + 0.5 - d, 0.0, 1.0);
  if (aa <= 0.0) discard;
  vec3 c = v_col.rgb;
  float big = smoothstep(3.5, 12.0, v_rad);
  c = mix(c, c * 0.55, smoothstep(v_rad * 0.7, v_rad, d) * big * 0.9);            // borde
  c += (1.0 - smoothstep(0.0, v_rad * 0.9, length(p + v_rad * 0.32))) * 0.16 * big; // brillo
  float a = v_col.a * aa;
  o = vec4(c * a, a);
}`;
let prog, U = {}, palTex;
function initGL() {
  if (!gl) throw new Error('Tu navegador no soporta WebGL2.');
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  for (const n of ['cam', 'vp', 'year', 'scale', 'dpr', 'rMin', 'rMax', 'maxPt', 'rating', 'lang', 'density', 'boost', 'mode', 'gall', 'gmask', 'hide', 'req', 'pal']) U[n] = gl.getUniformLocation(prog, 'u_' + n);
  maxPoint = Math.min(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1], 2048);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  gpuName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/^ANGLE \((.*)\)$/, '$1').replace(/ Direct3D.*| \(0x[0-9a-f]+\)/gi, '');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  palTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
function buildPalette() {
  palette = new Uint8Array(256 * 4 * 4);
  const put = (row, i, rgb) => { const p = (row * 256 + i) * 4; palette[p] = rgb[0]; palette[p + 1] = rgb[1]; palette[p + 2] = rgb[2]; palette[p + 3] = 255; };
  const unk = hex2rgb(UNKNOWN);
  for (let i = 0; i < 256; i++) {
    put(0, i, i <= M.genres.length ? hex2rgb(genreColor(i)) : unk);
    put(1, i, i === 0 ? unk : gradient(YEAR_STOPS, i + M.yearBase));
    put(2, i, i === 0 ? unk : gradient(RATING_STOPS, i));
    put(3, i, i >= 1 && i <= LANG_COLORS.length ? hex2rgb(LANG_COLORS[i - 1]) : i === 0 ? unk : [124, 134, 152]);
  }
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette);
}
function addChunk(k, buf) {
  const off = k * M.chunkSize, n = M.chunks[k];
  const xy = new Float32Array(buf, 0, 2 * n), gm = new Uint32Array(buf, 8 * n, n), at = new Uint8Array(buf, 12 * n, 8 * n);
  for (const it of saved) if (it.i >= off && it.i < off + n) at[(it.i - off) * 8 + 5] |= F_SAVED;
  XY.set(xy, off * 2); GM.set(gm, off); AT.set(at, off * 8);
  // Orden en la GPU. Trozos importantes: invertido, así las más votadas se dibujan arriba.
  // El resto: permutación (j·A mod n) que reparte parejo el orden original, de modo que dibujar
  // solo los primeros f·n vértices es una muestra uniforme del trozo (LOD con zoom alejado).
  let A = 0;
  if (k >= LOD_FULL_CHUNKS) { A = Math.floor(n * 0.6180339887) | 1; while (gcd(A, n) !== 1) A += 2; }
  const rxy = new Float32Array(2 * n), rgm = new Uint32Array(n), rat = new Uint32Array(2 * n), at32 = new Uint32Array(buf.slice(12 * n, 20 * n));
  for (let j = 0; j < n; j++) {
    const i = A ? (j * A) % n : n - 1 - j;
    rxy[2 * i] = xy[2 * j]; rxy[2 * i + 1] = xy[2 * j + 1]; rgm[i] = gm[j]; rat[2 * i] = at32[2 * j]; rat[2 * i + 1] = at32[2 * j + 1];
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
  vb(rxy); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const bufA = vb(rat); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, 8, 0);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, 8, 4);
  vb(rgm); gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, 0, 0);
  gl.bindVertexArray(null);
  // índice espacial (grilla) para picking y etiquetas
  const cs = new Uint32Array(GRID * GRID + 1), ci = new Uint32Array(n), cell = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const cx = clamp(((xy[2 * i] - gx0) / gcw) | 0, 0, GRID - 1), cy = clamp(((xy[2 * i + 1] - gy0) / gch) | 0, 0, GRID - 1);
    cell[i] = cy * GRID + cx; cs[cell[i] + 1]++;
  }
  for (let c = 0; c < GRID * GRID; c++) cs[c + 1] += cs[c];
  const fill = cs.slice(0, GRID * GRID);
  for (let i = 0; i < n; i++) ci[fill[cell[i]]++] = off + i;
  chunks[k] = { off, n, vao, cs, ci, bufA, A };
  loaded = off + n;
}
const LOD_FULL_CHUNKS = 3;       // los primeros trozos (~200 mil más importantes) nunca se submuestrean
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
// enciende/apaga un flag de un nodo en CPU y en el buffer de la GPU (1 byte)
function setFlag(i, flag, on) {
  const a = i * 8 + 5;
  AT[a] = on ? AT[a] | flag : AT[a] & ~flag;
  const ch = chunks[Math.floor(i / M.chunkSize)];
  if (!ch) return;                                   // el trozo aún no cargó: addChunk aplica el flag al llegar
  const j = i - ch.off, slot = ch.A ? (j * ch.A) % ch.n : ch.n - 1 - j;
  gl.bindBuffer(gl.ARRAY_BUFFER, ch.bufA);
  gl.bufferSubData(gl.ARRAY_BUFFER, slot * 8 + 5, AT.subarray(a, a + 1));
}
function cellRange(x0, y0, x1, y1) {
  return [clamp(((x0 - gx0) / gcw) | 0, 0, GRID - 1), clamp(((y0 - gy0) / gch) | 0, 0, GRID - 1),
    clamp(((x1 - gx0) / gcw) | 0, 0, GRID - 1), clamp(((y1 - gy0) / gch) | 0, 0, GRID - 1)];
}
function countInRect(x0, y0, x1, y1) {
  const [cx0, cy0, cx1, cy1] = cellRange(x0, y0, x1, y1);
  let c = 0;
  for (const ch of chunks) { if (!ch) continue; for (let y = cy0; y <= cy1; y++) c += ch.cs[y * GRID + cx1 + 1] - ch.cs[y * GRID + cx0]; }
  return c;
}
function forEachInRect(x0, y0, x1, y1, fn) {
  const [cx0, cy0, cx1, cy1] = cellRange(x0, y0, x1, y1);
  for (const ch of chunks) {
    if (!ch) continue;
    for (let y = cy0; y <= cy1; y++) {
      const a = ch.cs[y * GRID + cx0], b = ch.cs[y * GRID + cx1 + 1];
      for (let p = a; p < b; p++) { const i = ch.ci[p], px = XY[2 * i], py = XY[2 * i + 1]; if (px >= x0 && px <= x1 && py >= y0 && py <= y1) fn(i); }
    }
  }
}

let dprOverride = 0;
function resize() {
  dpr = dprOverride || Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  for (const c of [glc, ov]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  if (M && W && H) {
    computeScales();
    // si se estaba viendo el mapa completo (o la pestaña arrancó oculta, con tamaño 0), se re-encuadra
    if (isFit || !(cam.s > 0)) { Object.assign(cam, fitParams()); isFit = true; }
    cam.s = clamp(cam.s, sMin, sMax);
  }
  render();
}
let isFit = true;
// encuadre del mapa completo dentro del área libre (sin los paneles laterales)
const insets = () => [W > 760 && !($('#filters').hidden && $('#saved').hidden) ? 372 : 0, W > 760 && !panel.hidden ? 400 : 0];
function fitParams() {
  const [x0, y0, x1, y1] = M.bounds;
  const [l, r] = insets();
  const s = Math.min((W - l - r) / (x1 - x0), H / (y1 - y0)) * 0.96;
  return { x: (x0 + x1) / 2 - (l - r) / 2 / s, y: (y0 + y1) / 2, s };
}
function computeScales() {
  const [x0, y0, x1, y1] = M.bounds;
  sFit = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.96;
  sMin = sFit * 0.45;
  sMax = Math.min(52, (maxPoint - 2) / (2 * M.rMax * dpr));
}
function drawGL() {
  const margin = Math.min(Math.ceil(Math.max(M.rMax * cam.s, 3) * dpr) + 2, 1024);
  const vw = glc.width + 2 * margin, vh = glc.height + 2 * margin;
  gl.viewport(-margin, -margin, vw, vh);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog);
  gl.uniform2f(U.cam, cam.x, cam.y); gl.uniform2f(U.vp, vw, vh);
  gl.uniform1f(U.scale, cam.s * dpr); gl.uniform1f(U.dpr, dpr);
  gl.uniform1f(U.rMin, M.rMin); gl.uniform1f(U.rMax, M.rMax); gl.uniform1f(U.maxPt, maxPoint);
  // con todo el mapa a la vista hay ~2 nodos por píxel: se baja la opacidad de base para leer densidades
  const z = cam.s / sFit;
  gl.uniform1f(U.density, clamp(0.16 + 0.11 * Math.log2(Math.max(z, 0.5)), 0.12, 0.9));
  gl.uniform1i(U.mode, colorMode); gl.uniform1i(U.gall, filt.gall ? 1 : 0);
  gl.uniform1ui(U.gmask, filt.gmask >>> 0);
  gl.uniform1ui(U.hide, filt.hideAdult ? F_ADULT : 0);
  gl.uniform1ui(U.req, (filt.onlyPoster ? F_POSTER : 0) | (filt.onlySaved ? F_SAVED : 0));
  gl.uniform2f(U.year, filt.y0, filt.y1); gl.uniform1f(U.rating, filt.rating); gl.uniform1f(U.lang, filt.lang);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(U.pal, 0);
  // LOD: con el mapa lejos hay varios nodos por píxel; se dibuja la fracción que mantiene ~2 por
  // píxel en las zonas densas. Si aun así los cuadros vienen lentos, el gobernador la baja más
  // mientras la cámara se mueve (al quedar quieta se dibuja todo).
  const sd = cam.s * dpr;
  let f = clamp(13.8 * sd * sd, 0.04, 1);
  if (moving && !resting && sd < 1) f *= quality;
  drawn = 0;
  for (let k = chunks.length - 1; k >= 0; k--) {
    const ch = chunks[k]; if (!ch) continue;
    const count = ch.A && f < 1 ? Math.max(1, Math.round(ch.n * f)) : ch.n;
    gl.uniform1f(U.boost, ch.n / count);
    gl.bindVertexArray(ch.vao); gl.drawArrays(gl.POINTS, 0, count);
    drawn += count;
  }
  gl.bindVertexArray(null);
}
let quality = 1, resting = false, drawn = 0, gpuName = '';

// ------------------------------------------------------------------ carga de datos
// Los datos se publican pre-comprimidos (archivo + ".gz"): así entran en un hosting estático con cupo
// y viajan chicos aunque el servidor no comprima. Se descomprimen acá con DecompressionStream.
async function fetchData(path) {
  const r = await fetch(`${DATA}${path}.gz?v=${M.v}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const buf = await r.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;        // el servidor ya lo entregó descomprimido
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
const fetchText = async (path) => new TextDecoder().decode(await fetchData(path));
const fetchJSON = async (path) => JSON.parse(await fetchText(path));

// ------------------------------------------------------------------ tiles (títulos + pósters) y fichas
const tileCache = new Map(), detailCache = new Map();
function getTile(t, cache, dir, max) {
  let e = cache.get(t);
  if (e) { cache.delete(t); cache.set(t, e); return e; }
  e = { ready: false, map: null, data: null, promise: null };
  e.promise = fetchJSON(`${dir}/${t}.json`).then((d) => {
    e.data = d; e.map = new Map(); for (let k = 0; k < d.i.length; k++) e.map.set(d.i[k], k); e.ready = true; return e;
  }).catch(() => { cache.delete(t); return null; });
  cache.set(t, e);
  if (cache.size > max) cache.delete(cache.keys().next().value);
  return e;
}
const liteTile = (i) => getTile(tileOf(i), tileCache, 'tiles', 400);
function titleOf(i, request = false) {
  if (titles0 && i < titles0.length) return titles0[i];
  const t = tileCache.get(tileOf(i));
  if (t?.ready) return t.data.t[t.map.get(i)];
  if (request) liteTile(i).promise.then(render);
  return null;
}
function posterOf(i, request = false) {
  if (!(AT[i * 8 + 5] & F_POSTER)) return null;
  const t = tileCache.get(tileOf(i));
  if (t?.ready) return t.data.p[t.map.get(i)] || null;
  if (request) liteTile(i).promise.then(render);
  return null;
}
async function titleAsync(i) {
  if (titles0 && i < titles0.length) return titles0[i];
  const t = await liteTile(i).promise;
  return t ? t.data.t[t.map.get(i)] : '';
}
async function details(i) {
  const t = await getTile(tileOf(i), detailCache, 'details', 24).promise;
  return t ? t.data.d[t.map.get(i)] : null;
}
const imgCache = new Map();
let imgPending = 0;      // descargas en vuelo: se limitan para priorizar lo que está en pantalla ahora
function getImg(path, size, load) {
  const key = size + path;
  let im = imgCache.get(key);
  if (!im) {
    if (!load || imgPending >= 40) return null;
    im = new Image(); im.decoding = 'async'; im.ok = false;
    imgPending++;
    im.onload = () => { imgPending--; im.ok = true; render(); };
    im.onerror = () => { imgPending--; im.failed = true; render(); };
    im.src = IMG + size + path;
    imgCache.set(key, im);
    if (imgCache.size > 1200) { const k = imgCache.keys().next().value; imgCache.get(k).src = ''; imgCache.delete(k); }
  }
  return im.ok ? im : null;
}

// ------------------------------------------------------------------ overlay 2D: etiquetas, pósters, anillos
const widthCache = new Map();
function textW(font, s) {
  const k = font + '|' + s;
  let w = widthCache.get(k);
  if (w === undefined) { ctx.font = font; w = ctx.measureText(s).width; if (widthCache.size > 6000) widthCache.clear(); widthCache.set(k, w); }
  return w;
}
function labelText(l) {
  return l.t.map(([kind, v]) => kind === 'g' ? GENRE_META[v][0] : kind === 'l' ? 'Cine en ' + langName(v).toLowerCase() : kind === 'd' ? (v < 1920 ? 'Cine mudo' : 'Años ' + (v >= 2000 ? v : String(v).slice(2))) : kind === 'x' ? 'Adultos' : kind === 'n' ? 'Sin género' : v).join(' · ');
}
const FONT = '"Inter","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
const LV = [
  { font: `700 14px ${FONT}`, h: 16, z0: 0, z1: 3.2, fade: 2.2, upper: true, alpha: 0.95 },
  { font: `600 12.5px ${FONT}`, h: 15, z0: 1.9, z1: 10, fade: 7, upper: false, alpha: 0.9 },
  { font: `500 12px ${FONT}`, h: 14, z0: 6.5, z1: 34, fade: 24, upper: false, alpha: 0.82 },
];
function wrapLines(text, font, maxW, maxLines) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textW(font, t) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  else if (cur && lines.length === maxLines) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '…');
  return lines.map((l) => { while (l.length > 3 && textW(font, l) > maxW) l = l.slice(0, -2) + '…'; return l; });
}
function drawStar(x, y, R) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? R * 0.45 : R; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
  ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(5,6,10,.9)'; ctx.stroke();
  ctx.fillStyle = '#ffb224'; ctx.fill();
}
let moving = false, settleTimer = 0;
function drawOverlay() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!M || !loaded) return;
  const z = cam.s / sFit;
  const vx0 = cam.x - W / 2 / cam.s, vx1 = cam.x + W / 2 / cam.s, vy0 = cam.y - H / 2 / cam.s, vy1 = cam.y + H / 2 / cam.s;
  const boxes = [];
  const free = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; return true; };
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';

  // --- nodos visibles (solo cuando son pocos: zoom profundo)
  const pad = M.rMax + 1;
  let vis = null;
  if (countInRect(vx0 - pad, vy0 - pad, vx1 + pad, vy1 + pad) <= 3500) {
    vis = [];
    forEachInRect(vx0 - pad, vy0 - pad, vx1 + pad, vy1 + pad, (i) => { if (passes(i)) vis.push(i); });
    vis.sort((a, b) => a - b);
  }

  // --- pósters y títulos dentro de los nodos grandes
  if (vis) {
    for (const i of vis) {
      const r = radiusPx(i);
      if (r < 13) continue;
      const x = sx(XY[2 * i]), y = sy(XY[2 * i + 1]);
      if (x < -r || x > W + r || y < -r || y > H + r) continue;
      const path = posterOf(i, !moving);
      const fadeIn = clamp((r - 13) / 6, 0, 1);
      if (path) {
        const hw = r * 0.555, hh = r * 0.832, need = hw * 2 * dpr;
        const size = need <= 100 ? 'w92' : need <= 170 ? 'w154' : need <= 200 ? 'w185' : 'w342';
        const im = getImg(path, size, !moving) || getImg(path, 'w92', false) || getImg(path, 'w154', false);
        if (im) {
          ctx.globalAlpha = fadeIn;
          if (hw < 17) ctx.drawImage(im, x - hw, y - hh, hw * 2, hh * 2);     // chico: sin recorte (más rápido)
          else {
            ctx.save(); ctx.beginPath(); ctx.roundRect(x - hw, y - hh, hw * 2, hh * 2, Math.min(6, hw * 0.16)); ctx.clip();
            ctx.drawImage(im, x - hw, y - hh, hw * 2, hh * 2);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
          continue;
        }
      }
      if (r >= 22 && showLabels) {     // sin póster (o aún sin cargar): título dentro de la burbuja
        const t = titleOf(i, !moving);
        if (!t) continue;
        const fs = clamp(r * 0.25, 9, 15), font = `600 ${fs}px ${FONT}`;
        const lines = wrapLines(t, font, r * 1.55, r > 34 ? 4 : 3);
        const yr = yearOf(i), lh = fs * 1.18, total = lines.length * lh + (yr ? lh : 0);
        ctx.globalAlpha = clamp((r - 22) / 6, 0, 1);
        ctx.font = font; ctx.fillStyle = 'rgba(8,9,13,.92)';
        let ty = y - total / 2 + lh / 2;
        for (const l of lines) { ctx.fillText(l, x, ty); ty += lh; }
        if (yr) { ctx.font = `500 ${fs * 0.86}px ${FONT}`; ctx.fillStyle = 'rgba(8,9,13,.62)'; ctx.fillText(yr, x, ty); }
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- líneas a películas similares de la seleccionada
  if (selected >= 0 && selected < loaded) {
    const x0 = sx(XY[2 * selected]), y0 = sy(XY[2 * selected + 1]);
    ctx.lineWidth = 1.2;
    for (const j of selSimilar) {
      if (j >= loaded) continue;
      const x1 = sx(XY[2 * j]), y1 = sy(XY[2 * j + 1]);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,.08)');
      ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(x0, y0);
      const mx = (x0 + x1) / 2 + (y1 - y0) * 0.12, my = (y0 + y1) / 2 - (x1 - x0) * 0.12;
      ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(x1, y1, radiusPx(j) + 2, 0, 6.2832); ctx.stroke();
    }
    const r = radiusPx(selected);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x0, y0, r + 3, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,178,36,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x0, y0, r + 6.5, 0, 6.2832); ctx.stroke();
    boxes.push([x0 - r - 8, y0 - r - 8, 2 * r + 16, 2 * r + 16]);
  }
  if (hover >= 0 && hover !== selected) {
    const r = radiusPx(hover);
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx(XY[2 * hover]), sy(XY[2 * hover + 1]), r + 2.5, 0, 6.2832); ctx.stroke();
  }
  // --- guardadas: estrella dorada (de lejos, sobre el nodo; de cerca, anillo + insignia)
  const savedVisible = [];
  for (const it of saved) {
    const i = it.i;
    if (i < 0 || i >= loaded || !passes(i)) continue;
    const x = sx(XY[2 * i]), y = sy(XY[2 * i + 1]);
    if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
    const r = radiusPx(i);
    savedVisible.push(it);
    if (r >= 9) {
      ctx.strokeStyle = '#ffb224'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, 6.2832); ctx.stroke();
      drawStar(x + r * 0.74, y - r * 0.74, clamp(r * 0.3, 6, 12));
    } else drawStar(x, y, Math.max(6.5, r + 3.5));
  }
  if (!showLabels) return;

  // --- nombres de regiones (3 niveles, como país / provincia / ciudad)
  const named = [];
  ctx.lineWidth = 3.5;
  for (const l of M.labels) {
    const L = LV[l.lv];
    if (z < L.z0 || z > L.z1) continue;
    if (l.x < vx0 || l.x > vx1 || l.y < vy0 || l.y > vy1) continue;
    const a = L.alpha * clamp((z - L.z0) / (L.z0 * 0.25 + 0.01), 0, 1) * clamp((L.z1 - z) / (L.z1 - L.fade), 0, 1);
    if (a < 0.03) continue;
    let s = l.text ??= labelText(l);
    if (L.upper) s = l.upper ??= s.toUpperCase();
    const w = textW(L.font, s) + (L.upper ? s.length * 1.2 : 0) + 14, y = sy(l.y);
    const x = w < W - 8 ? clamp(sx(l.x), w / 2 + 4, W - w / 2 - 4) : W / 2;      // nunca cortada por el borde
    if (!free(x - w / 2, y - L.h / 2 - 3, w, L.h + 6)) continue;
    // un mismo nombre no se repite cerca (regiones vecinas del mismo género): queda la más grande
    let dup = false;
    for (const p of named) if (p[2] === s && Math.abs(p[0] - x) < 300 && Math.abs(p[1] - y) < 200) { dup = true; break; }
    if (dup) continue;
    named.push([x, y, s]);
    boxes.push([x - w / 2, y - L.h / 2 - 3, w, L.h + 6]);
    ctx.font = L.font; ctx.globalAlpha = a;
    if (L.upper) ctx.letterSpacing = '1.2px';
    ctx.strokeStyle = 'rgba(5,6,10,.85)'; ctx.strokeText(s, x, y);
    ctx.fillStyle = '#fff'; ctx.fillText(s, x, y);
    if (L.upper) ctx.letterSpacing = '0px';
  }
  ctx.globalAlpha = 1;

  // --- títulos de películas: primero las más importantes; al acercarse aparecen más
  const font = `500 11.5px ${FONT}`;
  ctx.font = font; ctx.lineWidth = 3;
  const budget = Math.round(clamp(W * H / 26000, 14, 70));
  const rankLimit = 30 * Math.pow(z, 1.7);
  let placed = 0;
  const tryLabel = (i, forced = null) => {     // forced = título de una guardada: se rotula a cualquier zoom
    if (placed >= budget) return;
    const r = radiusPx(i);
    if (r >= 13 && (AT[i * 8 + 5] & F_POSTER) && i !== hover) return;   // ya se ve el póster
    if (r >= 22) return;                                                // el título va dentro de la burbuja
    if (!forced && i > rankLimit && r < 5.5) return;
    const x = sx(XY[2 * i]), y = sy(XY[2 * i + 1]);
    if (x < 0 || x > W || y < 0 || y > H) return;
    const t0 = forced || titleOf(i, vis !== null && !moving && r >= 5.5);
    if (!t0) return;
    const t = t0.length > 34 ? t0.slice(0, 32) + '…' : t0;
    const w = textW(font, t) + 8, ly = y + r + 9;
    if (!free(x - w / 2, ly - 8, w, 16)) return;
    boxes.push([x - w / 2, ly - 8, w, 16]);
    ctx.font = font;
    ctx.strokeStyle = 'rgba(5,6,10,.9)'; ctx.strokeText(t, x, ly);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(t, x, ly);
    placed++;
  };
  for (const it of savedVisible.slice(0, 40)) tryLabel(it.i, it.t);
  if (vis) for (const i of vis) tryLabel(i);
  else {
    const top = Math.min(loaded, Math.min(rankLimit, 5000));
    for (let i = 0; i < top; i++) { const x = XY[2 * i], y = XY[2 * i + 1]; if (x > vx0 && x < vx1 && y > vy0 && y < vy1 && passes(i)) tryLabel(i); }
  }
}

// ------------------------------------------------------------------ bucle de render y cámara
let anim = null, zoomTarget = null, inertia = null, lastT = 0;
function render() { if (!needsRender) { needsRender = true; requestAnimationFrame(frame); } }
// Gobernador de calidad: si al mover la cámara los cuadros tardan (>30 ms), baja la fracción de
// nodos que se dibujan lejos; si sobran, la vuelve a subir. En GPUs rápidas nunca actúa.
let ema = 0, slowN = 0, fastN = 0, restTimer = 0, lastCamKey = '';
function govern(dt) {
  ema = ema ? ema * 0.85 + dt * 0.15 : dt;
  if (ema > 30) { fastN = 0; if (++slowN >= 8) { quality = Math.max(0.15, quality * 0.6); slowN = 0; ema = 24; } }
  else if (ema < 19) { slowN = 0; if (++fastN >= 60) { quality = Math.min(1, quality * 1.4); fastN = 0; } }
  else slowN = fastN = 0;
}
// medidor (tecla P): fps reales, nodos dibujados y qué GPU usa el navegador
let perfOn = false;
const perfTimes = [];
function perfTick(t) {
  perfTimes.push(t);
  if (perfTimes.length > 60) perfTimes.shift();
  if (perfTimes.length < 8 || perfTimes.length % 12) return;
  const span = perfTimes[perfTimes.length - 1] - perfTimes[0], fps = 1000 * (perfTimes.length - 1) / span;
  let worst = 0;
  for (let k = 1; k < perfTimes.length; k++) worst = Math.max(worst, perfTimes[k] - perfTimes[k - 1]);
  $('#perf').innerHTML = `<b>${fps.toFixed(0)} fps</b> · peor cuadro ${worst.toFixed(0)} ms<br>${nf.format(drawn)} de ${nf.format(loaded)} nodos dibujados${quality < 1 ? ` · calidad en movimiento ${Math.round(quality * 100)} %` : ''}<br>${glc.width}×${glc.height} px (×${dpr}) · ${esc(gpuName)}`;
}
function togglePerf() {
  perfOn = !perfOn; perfTimes.length = 0;
  $('#perf').hidden = !perfOn; $('#perf').textContent = 'Midiendo…';
  render();
}
function frame(t) {
  needsRender = false;
  const rawDt = t - lastT;
  const dt = Math.min(rawDt, 50); lastT = t;
  let again = false;
  if (anim) {
    const k = clamp((t - anim.t0) / anim.dur, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    cam.s = anim.s0 * Math.pow(anim.s1 / anim.s0, e);
    // el destino viaja en línea recta en pantalla (zoom anclado), sin "latigazo"
    const f = Math.abs(anim.s1 / anim.s0 - 1) < 1e-3 ? e : (1 / anim.s0 - 1 / cam.s) / (1 / anim.s0 - 1 / anim.s1);
    cam.x = anim.x0 + (anim.x1 - anim.x0) * f; cam.y = anim.y0 + (anim.y1 - anim.y0) * f;
    if (k >= 1) anim = null; else again = true;
  }
  if (zoomTarget) {
    const k = 1 - Math.exp(-dt / 70), ls = Math.log(cam.s) + (Math.log(zoomTarget.s) - Math.log(cam.s)) * k;
    cam.s = Math.exp(ls);
    cam.x = zoomTarget.wx - (zoomTarget.mx - W / 2) / cam.s; cam.y = zoomTarget.wy - (zoomTarget.my - H / 2) / cam.s;
    if (Math.abs(Math.log(zoomTarget.s / cam.s)) < 0.002) { cam.s = zoomTarget.s; zoomTarget = null; } else again = true;
  }
  if (inertia) {
    cam.x -= inertia.vx * dt / cam.s; cam.y -= inertia.vy * dt / cam.s;
    const d = Math.exp(-dt / 280); inertia.vx *= d; inertia.vy *= d;
    if (Math.hypot(inertia.vx, inertia.vy) < 0.01) inertia = null; else again = true;
  }
  if (M) {
    const [x0, y0, x1, y1] = M.bounds;
    cam.x = clamp(cam.x, x0, x1); cam.y = clamp(cam.y, y0, y1);
    const wasMoving = moving;
    moving = again || dragging;
    if (wasMoving && !moving) { clearTimeout(settleTimer); settleTimer = setTimeout(render, 90); }
    const camKey = cam.x + ',' + cam.y + ',' + cam.s;
    if (camKey !== lastCamKey) {
      lastCamKey = camKey; resting = false;
      clearTimeout(restTimer);
      if (moving) { restTimer = setTimeout(() => { resting = true; render(); }, 160); if (wasMoving && rawDt < 250) govern(rawDt); }
    }
    drawGL(); drawOverlay();
    if (perfOn) perfTick(t);
  }
  if (again || perfOn) render();
}
function flyTo(x, y, s, dur = 900) {
  zoomTarget = inertia = null; isFit = false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) dur = 1;
  anim = { x0: cam.x, y0: cam.y, s0: cam.s, x1: x, y1: y, s1: clamp(s, sMin, sMax), t0: performance.now(), dur };
  lastT = performance.now(); render();
}
function fitView(dur = 700) {
  const f = fitParams();
  flyTo(f.x, f.y, f.s, dur);
  isFit = true;
}
function focusNode(i, dur = 1100) {
  const rw = M.rMin + (M.rMax - M.rMin) * AT[i * 8] / 255;
  const s = clamp(Math.max(cam.s, 30 / rw), sMin, sMax);
  // con el panel abierto, centra el nodo en el área libre
  const wide = W > 760 && !$('#panel').hidden;
  const offX = wide ? (Math.min(380, W - 28) + 14) / 2 : 0, offY = !wide && !$('#panel').hidden ? H * 0.26 - 28 : 0;   // media hoja = 52 % del alto
  flyTo(XY[2 * i] + offX / s, XY[2 * i + 1] + offY / s, s, dur);
}
function zoomBy(f, mx = W / 2, my = H / 2) {
  anim = inertia = null; isFit = false;
  const base = zoomTarget ? zoomTarget.s : cam.s;
  const wx = cam.x + (mx - W / 2) / cam.s, wy = cam.y + (my - H / 2) / cam.s;
  zoomTarget = { s: clamp(base * f, sMin, sMax), mx, my, wx, wy };
  lastT = performance.now(); render();
}

// ------------------------------------------------------------------ interacción
function pick(mx, my) {
  if (!M) return -1;
  const wx = cam.x + (mx - W / 2) / cam.s, wy = cam.y + (my - H / 2) / cam.s;
  const rw = (Math.max(M.rMax * cam.s, 4) + 5) / cam.s;
  let best = -1, bs = Infinity;
  forEachInRect(wx - rw, wy - rw, wx + rw, wy + rw, (i) => {
    const d = Math.hypot(XY[2 * i] - wx, XY[2 * i + 1] - wy) * cam.s, r = Math.max(radiusPx(i), 5);
    if (d > r || !passes(i)) return;
    const sc = d / r + i * 1e-8;
    if (sc < bs) { bs = sc; best = i; }
  });
  return best;
}
const tip = $('#tooltip');
let tipSeq = 0;
function setHover(i, mx, my) {
  if (i !== hover) {
    hover = i; render();
    ov.classList.toggle('pointing', i >= 0);
    const seq = ++tipSeq;
    if (i < 0) tip.hidden = true;
    else {
      const show = (t) => {
        if (seq !== tipSeq || !t) return;
        const y = yearOf(i), r = AT[i * 8 + 3];
        tip.innerHTML = `<i style="background:${colorOf(i)}"></i><b>${esc(t)}</b>${y ? `<span>${y}</span>` : ''}${r ? `<span>★ ${(r / 10).toFixed(1)}</span>` : ''}${AT[i * 8 + 5] & F_SAVED ? '<span style="color:var(--accent)">guardada</span>' : ''}`;
        tip.hidden = false;
      };
      const t = titleOf(i);
      if (t) show(t); else { tip.hidden = true; setTimeout(() => seq === tipSeq && titleAsync(i).then(show), 70); }
    }
  }
  if (i >= 0) { tip.style.left = Math.min(mx, W - 320) + 'px'; tip.style.top = Math.min(my, H - 50) + 'px'; }
}
let dragging = false;
const ptrs = new Map();
let dragStart = null, pinch = null, lastMove = null, hoverPending = null;
ov.addEventListener('pointerdown', (e) => {
  ov.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  anim = inertia = zoomTarget = null; isFit = false;
  if (ptrs.size === 1) { dragStart = { x: e.clientX, y: e.clientY, moved: false, t: performance.now() }; lastMove = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 }; }
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.s }; dragStart && (dragStart.moved = true); }
  hideHint();
});
ov.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) {   // hover (sin botón apretado)
    if (e.pointerType === 'mouse') { hoverPending = { x: e.clientX, y: e.clientY }; requestAnimationFrame(() => { if (hoverPending) { setHover(pick(hoverPending.x, hoverPending.y), hoverPending.x, hoverPending.y); hoverPending = null; } }); }
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const wx = cam.x + (mx - W / 2) / cam.s, wy = cam.y + (my - H / 2) / cam.s;
    cam.s = clamp(pinch.s * d / pinch.d, sMin, sMax);
    cam.x = wx - (mx - W / 2 + dx / 2) / cam.s; cam.y = wy - (my - H / 2 + dy / 2) / cam.s;
    render(); return;
  }
  if (!dragStart) return;
  if (!dragStart.moved && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < 5) return;
  if (!dragStart.moved) { dragStart.moved = true; dragging = true; ov.classList.add('dragging'); setHover(-1); }
  cam.x -= dx / cam.s; cam.y -= dy / cam.s;
  const now = performance.now(), dtm = Math.max(now - lastMove.t, 1);
  lastMove = { x: e.clientX, y: e.clientY, t: now, vx: lastMove.vx * 0.5 + dx / dtm * 0.5, vy: lastMove.vy * 0.5 + dy / dtm * 0.5 };
  render();
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 0 && dragStart) {
    if (!dragStart.moved && e.type === 'pointerup') {
      const i = pick(e.clientX, e.clientY);
      if (i >= 0) select(i, { fly: cam.s * (M.rMin + (M.rMax - M.rMin) * AT[i * 8] / 255) < 9 });
      else if (selected >= 0 && W <= 760) closePanel();
    } else if (dragging && performance.now() - lastMove.t < 60 && Math.hypot(lastMove.vx, lastMove.vy) > 0.15) {
      inertia = { vx: lastMove.vx, vy: lastMove.vy }; lastT = performance.now();
    }
    dragging = false; dragStart = null; ov.classList.remove('dragging'); render();
  } else if (ptrs.size === 1) { const [a] = [...ptrs.values()]; lastMove = { x: a.x, y: a.y, t: performance.now(), vx: 0, vy: 0 }; }
}
ov.addEventListener('pointerup', endPtr);
ov.addEventListener('pointercancel', endPtr);
ov.addEventListener('pointerleave', () => { hoverPending = null; setHover(-1); });
ov.addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 32 : 1;
  zoomBy(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.012 : 0.0022)), e.clientX, e.clientY);
  hideHint();
}, { passive: false });
ov.addEventListener('dblclick', (e) => { if (pick(e.clientX, e.clientY) < 0) zoomBy(2.4, e.clientX, e.clientY); });
function hideHint() { $('#hint').classList.add('gone'); }

// ------------------------------------------------------------------ panel de detalle
const panel = $('#panel'), panelBody = $('#panel-body');
let selSeq = 0;
function closePanel() {
  panel.hidden = true; panel.classList.remove('full', 'dragging'); document.body.classList.remove('panel-open', 'sheet-full');
  selected = -1; selSimilar = []; selDetails = null; history.replaceState(null, '', location.pathname + location.search); render();
}
async function select(i, { fly = true, push = true } = {}) {
  const seq = ++selSeq;
  selected = i; selSimilar = []; selDetails = null;
  panel.hidden = false; document.body.classList.add('panel-open');
  if (push) history.replaceState(null, '', '#p=' + i);
  const col = colorOf(i), y = yearOf(i), t0 = titleOf(i);
  panelBody.innerHTML = `<div class="head"><div class="poster none" style="--c:${col}" data-initial=""></div><div class="head-info"><div class="title-row"><h1>${t0 ? esc(t0) : '<div class="skeleton" style="width:70%;height:24px"></div>'}</h1></div><div class="meta">${y || ''}</div></div></div><div class="info"><div class="skeleton" style="width:100%;margin-top:14px"></div><div class="skeleton" style="width:92%"></div><div class="skeleton" style="width:60%"></div></div>`;
  panelBody.scrollTop = 0;
  if (isMobile()) hideLeft();                       // en el celular la hoja y los menús no conviven
  if (fly) focusNode(i); else render();
  const d = await details(i);
  if (seq !== selSeq) return;
  if (!d) { panelBody.querySelector('.info').insertAdjacentHTML('beforeend', '<p class="none-note">No se pudo cargar la ficha.</p>'); return; }
  selDetails = d;
  renderPanel(i, d);
  selSimilar = (d.s || []).filter((j) => j < N); render();
}
function renderPanel(i, d) {
  const col = colorOf(i), fl = AT[i * 8 + 5];
  const genres = (d.g || []).map((g) => `<button class="tag" style="--c:${genreColor(g)}" data-genre="${g}">${esc(genreName(g))}</button>`).join('');
  const meta = [d.y, d.l ? langName(d.l) : null, d.rt ? `${Math.floor(d.rt / 60) ? Math.floor(d.rt / 60) + ' h ' : ''}${Math.round(d.rt % 60)} min` : null,
    d.k === 'tvMovie' ? 'Película de TV' : d.k === 'video' ? 'Directo a video' : d.k === 'short' ? 'Cortometraje' : null].filter(Boolean).join(' · ');
  const rate = [];
  if (d.iv) rate.push(`<span><span class="star">★ ${d.ir.toFixed(1)}</span> <small>IMDb · ${nf.format(d.iv)} votos</small></span>`);
  if (d.tv) rate.push(`<span><span class="star"${d.iv ? ' style="font-size:14px;opacity:.85"' : ''}>★ ${d.tr.toFixed(1)}</span> <small>TMDB · ${nf.format(d.tv)} votos</small></span>`);
  const links = [];
  if (d.tm) links.push(`<a href="https://www.themoviedb.org/movie/${d.tm}" target="_blank" rel="noopener">TMDB ↗</a>`);
  if (d.im) links.push(`<a href="https://www.imdb.com/title/${d.im}/" target="_blank" rel="noopener">IMDb ↗</a>`);
  links.push(`<button data-act="locate">Ver en el mapa</button>`);
  panelBody.innerHTML = `
    <div class="head">
    ${d.p ? `<div class="poster" data-act="zoom-poster" role="button" tabindex="0" aria-label="Ampliar póster" title="Ampliar póster"><div class="blur" style="background-image:url(${IMG}w92${d.p})"></div><img alt="Póster de ${esc(d.t)}" src="${IMG}w500${d.p}"><span class="zoom-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>`
      : `<div class="poster none" style="--c:${col}" data-initial="${esc((d.t || '?').trim()[0].toUpperCase())}"></div>`}
    <div class="head-info">
      <div class="title-row"><h1>${esc(d.t)}</h1>${codeOf(d) ? `<button class="save-btn" data-act="save" title="Guardar o quitar de guardadas (S)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg><span></span></button>` : ''}</div>
      ${d.o ? `<div class="orig">${esc(d.o)}</div>` : ''}
      <div class="meta">${esc(meta)}</div>
      ${d.dir ? `<div class="meta">Dirigida por <b>${esc(d.dir)}</b></div>` : ''}
      ${rate.length ? `<div class="rating">${rate.join('')}</div>` : ''}
    </div>
    </div>
    <div class="info">
      <div class="tags">${genres}${fl & F_ADULT ? '<span class="tag adult">+18</span>' : ''}</div>
      ${d.tg ? `<p class="tagline">“${esc(d.tg)}”</p>` : ''}
      <h2>Sinopsis</h2>
      ${d.ov ? `<p>${esc(d.ov)}</p>` : `<p class="none-note">${fl & F_IMDB_ONLY ? 'Título presente solo en IMDb: sin sinopsis ni póster disponibles.' : 'Sin sinopsis disponible.'}</p>`}
      <h2 class="watch-h"><span>Dónde ver</span><button class="link-btn" data-act="watch-cfg"></button></h2>
      <div id="watch"></div>
      ${d.c ? `<h2>Reparto</h2><p>${esc(d.c)}</p>` : ''}
      ${d.kw?.length ? `<h2>Palabras clave</h2><p style="color:var(--muted);font-size:13px">${esc(d.kw.join(' · '))}</p>` : ''}
      <div class="links">${links.join('')}</div>
      ${d.s?.length ? `<h2>Películas similares</h2><ul class="similar">${d.s.map((j) => `<li tabindex="0" data-i="${j}" style="--c:${j < loaded ? colorOf(j) : '#444'}"><div class="th"></div><div class="t"><div class="skeleton" style="width:${50 + (j % 40)}%"></div></div><div class="y">${j < loaded && yearOf(j) ? yearOf(j) : ''}</div></li>`).join('')}</ul>` : ''}
    </div>`;
  const im = panelBody.querySelector('.poster img');
  if (im) { im.onload = () => im.classList.add('ready'); if (im.complete) im.classList.add('ready'); }
  syncSaveBtn(); renderWatch(d);
  for (const li of panelBody.querySelectorAll('.similar li')) {
    const j = +li.dataset.i;
    if (j >= loaded) { li.remove(); continue; }
    titleAsync(j).then((t) => {
      li.querySelector('.t').textContent = t; li.title = t;
      const p = posterOf(j); if (p) li.querySelector('.th').style.backgroundImage = `url(${IMG}w92${p})`;
    });
  }
}
panelBody.addEventListener('click', (e) => {
  const li = e.target.closest('.similar li'); if (li) return select(+li.dataset.i);
  const tag = e.target.closest('.tag[data-genre]'); if (tag) return toggleGenre(+tag.dataset.genre, true);
  if (e.target.closest('[data-act=save]')) return toggleSave();
  if (e.target.closest('[data-act=zoom-poster]') && selDetails?.p) return openLightbox(selDetails.p, selDetails.t);
  if (e.target.closest('[data-act=watch-cfg]')) { watchCfg.open = !watchCfg.open; return renderWatch(selDetails); }
  if (e.target.closest('[data-act=locate]') && selected >= 0) focusNode(selected);
});
panelBody.addEventListener('change', (e) => {
  if (e.target.id === 'w-country') watchCfg.country = e.target.value;
  else if (e.target.id === 'w-key') { watchCfg.key = e.target.value.trim(); provCache.clear(); }
  else return;
  store.set('watch', { country: watchCfg.country, key: watchCfg.key });
  renderWatch(selDetails);
});
panelBody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const li = e.target.closest('.similar li');
  if (li) select(+li.dataset.i);
  else if (e.target.matches('[data-act=zoom-poster]') && selDetails?.p) openLightbox(selDetails.p, selDetails.t);
});

// ------------------------------------------------------------------ póster a pantalla completa
const lightbox = $('#lightbox'), lbImg = lightbox.querySelector('img');
function openLightbox(path, title) {
  lbImg.alt = 'Póster de ' + title; lbImg.dataset.p = path;
  lbImg.src = IMG + 'w500' + path;                       // ya está en caché: aparece al instante
  const hi = new Image();                                // y se reemplaza por la versión original al llegar
  hi.onload = () => { if (!lightbox.hidden && lbImg.dataset.p === path) lbImg.src = hi.src; };
  hi.src = IMG + 'original' + path;
  lightbox.hidden = false;
}
function closeLightbox() { lightbox.hidden = true; lbImg.removeAttribute('src'); }
lightbox.addEventListener('click', closeLightbox);

// ------------------------------------------------------------------ hoja inferior (móvil)
// Dos alturas: media (se ve el mapa arriba) y completa (póster grande, contenido con scroll).
// En media hoja se arrastra desde cualquier parte; en completa, desde la manija. Tocar la manija alterna.
const isMobile = () => W <= 760;
function setSheet(full) {
  panel.classList.toggle('full', full);
  document.body.classList.toggle('sheet-full', full);
  panel.style.height = '';
  if (!full) panelBody.scrollTop = 0;
}
let sheetDrag = null;
panel.addEventListener('pointerdown', (e) => {
  if (!isMobile() || e.button > 0) return;
  const onGrip = !!e.target.closest('#sheet-grip');
  if (!onGrip && (panel.classList.contains('full') || e.target.closest('input, select, #panel-close'))) return;
  sheetDrag = { id: e.pointerId, y0: e.clientY, h0: panel.getBoundingClientRect().height, moved: false, lastY: e.clientY, lastT: e.timeStamp, vy: 0, onGrip };
});
panel.addEventListener('pointermove', (e) => {
  const d = sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  const dy = e.clientY - d.y0;
  if (!d.moved) {
    if (Math.abs(dy) < 7) return;
    d.moved = true; panel.classList.add('dragging');
    try { panel.setPointerCapture(d.id); } catch { /* el puntero ya se soltó */ }
  }
  d.vy = d.vy * 0.4 + (e.clientY - d.lastY) / Math.max(e.timeStamp - d.lastT, 1) * 0.6;
  d.lastY = e.clientY; d.lastT = e.timeStamp;
  panel.style.height = clamp(d.h0 - dy, 70, H) + 'px';
});
function sheetEnd(e) {
  const d = sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  sheetDrag = null;
  if (!d.moved) { if (d.onGrip) setSheet(!panel.classList.contains('full')); return; }
  panel.classList.remove('dragging');
  // el clic que sigue a un arrastre no debe activar lo que quedó bajo el dedo
  const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 300);
  const h = panel.getBoundingClientRect().height - d.vy * 200;      // proyecta la velocidad del gesto
  if (h > H * 0.72) setSheet(true);
  else if (h > H * 0.27) setSheet(false);
  else { panel.style.height = ''; closePanel(); }
}
panel.addEventListener('pointerup', sheetEnd);
panel.addEventListener('pointercancel', sheetEnd);
panelBody.addEventListener('mouseover', (e) => { const li = e.target.closest('.similar li'); if (li) { hover = +li.dataset.i; render(); } });
panelBody.addEventListener('mouseout', (e) => { if (e.target.closest('.similar li')) { hover = -1; render(); } });
$('#panel-close').onclick = closePanel;

// ------------------------------------------------------------------ almacenamiento local
// Claves con prefijo propio: en GitHub Pages todos los proyectos de un usuario comparten origen.
const store = {
  get(k, d) {
    try {
      let v = localStorage.getItem('vectorflick.' + k);
      if (v === null) v = localStorage.getItem('atlas.' + k);          // nombre anterior del proyecto
      return v === null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('vectorflick.' + k, JSON.stringify(v)); } catch { /* modo privado o cuota llena */ } },
};

// ------------------------------------------------------------------ guardadas
// Se guardan por id estable (TMDB, o IMDb con el bit alto), no por índice de nodo: si se
// regeneran los datos, los índices cambian y se vuelven a ubicar leyendo ids/K.bin.
const codeOf = (d) => (d.tm ? d.tm : d.im ? (0x80000000 | parseInt(d.im.slice(2), 10)) >>> 0 : 0);
function persistSaved() { store.set('saved', { v: M.v, items: saved }); }
function loadSaved() {
  const s = store.get('saved', null);
  saved = Array.isArray(s?.items) ? s.items.filter((it) => it && it.c && it.t) : [];
  savedByCode.clear();
  for (const it of saved) savedByCode.set(it.c, it);
  if (saved.length && s.v !== M.v) for (const it of saved) { it.i = -1; it.missing = false; }
  updateSavedUI();
  if (saved.some((it) => it.i < 0 && !it.missing)) remapSaved();
}
let remapping = null;
function remapSaved() {
  remapping ??= (async () => {
    const want = new Map();
    for (const it of saved) if (it.i < 0 && !it.missing) want.set(it.c, it);
    for (let k = 0; k < M.chunks.length && want.size; k++) {
      const ids = new Uint32Array(await fetchData(`ids/${k}.bin`));
      for (let j = 0; j < ids.length; j++) {
        const it = want.get(ids[j]);
        if (it) { want.delete(ids[j]); it.i = k * M.chunkSize + j; setFlag(it.i, F_SAVED, true); }
      }
    }
    for (const it of want.values()) it.missing = true;     // ya no está en esta versión del catálogo
    persistSaved(); updateSavedUI(); filtersChanged();
    if (loaded === N) fillSavedPosters();
  })().catch((e) => console.error(e)).finally(() => { remapping = null; });
  return remapping;
}
async function fillSavedPosters() {       // las importadas llegan sin miniatura
  const need = saved.filter((it) => it.i >= 0 && it.p === undefined).slice(0, 200);
  if (!need.length) return;
  await Promise.all(need.map(async (it) => { const t = await liteTile(it.i).promise; it.p = (t && t.data.p[t.map.get(it.i)]) || ''; }));
  persistSaved(); updateSavedUI();
}
function toggleSave(i = selected, d = selDetails) {
  if (i < 0 || !d) return;
  const c = codeOf(d);
  if (!c) return;
  const ex = savedByCode.get(c);
  if (ex) return removeSaved(ex);
  const it = { c, i, t: d.t, y: d.y || 0, p: d.p || '', at: Date.now() };
  saved.unshift(it); savedByCode.set(c, it); setFlag(i, F_SAVED, true);
  persistSaved(); updateSavedUI(); filtersChanged();
}
function removeSaved(it) {
  saved.splice(saved.indexOf(it), 1); savedByCode.delete(it.c);
  if (it.i >= 0) setFlag(it.i, F_SAVED, false);
  persistSaved(); updateSavedUI(); filtersChanged();
}
function syncSaveBtn() {
  const b = panelBody.querySelector('.save-btn');
  if (!b || !selDetails) return;
  const on = savedByCode.has(codeOf(selDetails));
  b.setAttribute('aria-pressed', on); b.querySelector('span').textContent = on ? 'Guardada' : 'Guardar';
}
function updateSavedUI() {
  const n = saved.length, badge = $('#saved-badge');
  badge.hidden = !n; badge.textContent = n > 999 ? '999+' : n;
  $('#saved-count').textContent = n || '';
  $('#saved-list').innerHTML = n
    ? saved.map((it, k) => `<li data-k="${k}" tabindex="0"${it.i < 0 ? ' class="missing"' : ''} style="--c:${it.i >= 0 && it.i < loaded ? colorOf(it.i) : '#444'}" title="${esc(it.t)}${it.missing ? ' — no está en esta versión del catálogo' : ''}"><div class="th"${it.p ? ` style="background-image:url(${IMG}w92${it.p})"` : ''}></div><div class="t">${esc(it.t)}</div><div class="y">${it.y || ''}</div><button class="rm" data-rm="${k}" title="Quitar de guardadas" aria-label="Quitar ${esc(it.t)}">×</button></li>`).join('')
    : '<li class="empty">Todavía no guardaste películas.<br>Abrí una ficha y tocá <b>☆ Guardar</b> (o la tecla S).</li>';
  syncSaveBtn();
}
function setOnlySaved(on) {
  filt.onlySaved = on; $('#only-saved').checked = $('#saved-only').checked = on;
  filtersChanged();
  const pts = saved.filter((it) => it.i >= 0 && it.i < loaded);
  if (!on || !pts.length) return;
  if (pts.length === 1) return focusNode(pts[0].i);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;     // encuadra todas las guardadas
  for (const { i } of pts) { x0 = Math.min(x0, XY[2 * i]); x1 = Math.max(x1, XY[2 * i]); y0 = Math.min(y0, XY[2 * i + 1]); y1 = Math.max(y1, XY[2 * i + 1]); }
  const [l, r] = insets(), s = Math.min((W - l - r) / (x1 - x0 + 40), H / (y1 - y0 + 40)) * 0.8;
  flyTo((x0 + x1) / 2 - (l - r) / 2 / Math.min(s, 14), (y0 + y1) / 2, Math.min(s, 14), 900);
}
$('#saved-list').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) return removeSaved(saved[+rm.dataset.rm]);
  const li = e.target.closest('li[data-k]');
  const it = li && saved[+li.dataset.k];
  if (it && it.i >= 0 && it.i < loaded) select(it.i);
});
$('#saved-list').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('li[data-k]')) e.target.click(); });
$('#saved-list').addEventListener('mouseover', (e) => { const li = e.target.closest('li[data-k]'), it = li && saved[+li.dataset.k]; if (it && it.i >= 0 && it.i < loaded) { hover = it.i; render(); } });
$('#saved-list').addEventListener('mouseout', () => { if (hover >= 0) { hover = -1; render(); } });
$('#saved-only').onchange = (e) => setOnlySaved(e.target.checked);
$('#only-saved').onchange = (e) => setOnlySaved(e.target.checked);
$('#saved-export').onclick = () => {
  const items = saved.map((it) => ({ title: it.t, year: it.y || null, tmdb: it.c < 0x80000000 ? it.c : null,
    imdb: it.c >= 0x80000000 ? 'tt' + String(it.c & 0x7fffffff).padStart(7, '0') : null, savedAt: new Date(it.at || Date.now()).toISOString() }));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'vectorflick', exported: new Date().toISOString(), items }, null, 2)], { type: 'application/json' }));
  a.download = 'vectorflick-guardadas.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#saved-import').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    let added = 0;
    for (const x of JSON.parse(await f.text()).items) {
      const c = x.tmdb ? x.tmdb >>> 0 : x.imdb ? (0x80000000 | parseInt(String(x.imdb).slice(2), 10)) >>> 0 : 0;
      if (!c || savedByCode.has(c)) continue;
      const it = { c, i: -1, t: String(x.title || 'Sin título'), y: +x.year || 0, at: Date.parse(x.savedAt) || Date.now() };
      saved.push(it); savedByCode.set(c, it); added++;
    }
    updateSavedUI();
    if (added) await remapSaved();
  } catch { alert('No se pudo leer el archivo: tiene que ser una lista exportada desde VectorFlick.'); }
};

// ------------------------------------------------------------------ dónde ver
// Sin token: enlaces a la página de plataformas de TMDB y a la búsqueda de JustWatch.
// Con un token de TMDB (del usuario, guardado en este navegador): plataformas en la ficha.
function guessCountry() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const byTz = { Argentina: 'AR', Buenos_Aires: 'AR', Mexico: 'MX', Bogota: 'CO', Santiago: 'CL', Lima: 'PE', Montevideo: 'UY', Caracas: 'VE', Guayaquil: 'EC',
    La_Paz: 'BO', Asuncion: 'PY', Costa_Rica: 'CR', Guatemala: 'GT', Madrid: 'ES', Sao_Paulo: 'BR', London: 'GB', Paris: 'FR', Berlin: 'DE', Rome: 'IT' };
  for (const k in byTz) if (tz.includes(k)) return byTz[k];
  try { const r = new Intl.Locale(navigator.language).maximize().region; if (JW[r]) return r; } catch { /* sin Intl.Locale */ }
  return 'US';
}
const watchCfg = { country: guessCountry(), key: '', open: false, ...store.get('watch', {}) };
if (!JW[watchCfg.country]) watchCfg.country = 'US';
watchCfg.open = false;
const provCache = new Map();
let regionNames = null;
const regionName = (cc) => { try { regionNames ??= new Intl.DisplayNames(['es'], { type: 'region' }); return regionNames.of(cc); } catch { return cc; } };
const WATCH_GROUPS = [['flatrate', 'Suscripción'], ['free', 'Gratis'], ['ads', 'Con anuncios'], ['rent', 'Alquiler'], ['buy', 'Compra']];
async function fetchProviders(tm) {
  if (provCache.has(tm)) return provCache.get(tm);
  const key = watchCfg.key, bearer = key.startsWith('eyJ');      // token v4 (JWT) va en la cabecera; la API key v3, en la URL
  const r = await fetch(`https://api.themoviedb.org/3/movie/${tm}/watch/providers${bearer ? '' : '?api_key=' + encodeURIComponent(key)}`,
    { headers: bearer ? { Authorization: 'Bearer ' + key, accept: 'application/json' } : { accept: 'application/json' } });
  if (r.status === 401) throw new Error('TMDB rechazó el token: revisalo desde “cambiar”.');
  if (r.status !== 404 && !r.ok) throw new Error(`TMDB no respondió (${r.status}).`);
  const res = r.ok ? (await r.json()).results || {} : {};
  provCache.set(tm, res);
  if (provCache.size > 300) provCache.delete(provCache.keys().next().value);
  return res;
}
async function renderWatch(d) {
  const el = panelBody.querySelector('#watch'), cfgBtn = panelBody.querySelector('[data-act=watch-cfg]');
  if (!el || !d) return;
  const seq = selSeq, cc = watchCfg.country, cname = regionName(cc);
  cfgBtn.textContent = `${cname} · ${watchCfg.open ? 'cerrar' : 'cambiar'}`;
  const tmdbUrl = d.tm ? `https://www.themoviedb.org/movie/${d.tm}/watch?locale=${cc}` : null;
  const jwUrl = `https://www.justwatch.com/${JW[cc]}?q=${encodeURIComponent(d.t)}`;
  const countries = Object.keys(JW).map((c) => [regionName(c), c]).sort((a, b) => a[0].localeCompare(b[0], 'es'));
  const cfg = `<div class="watch-cfg"${watchCfg.open ? '' : ' hidden'}>
      <label class="field"><span class="lbl">País</span><select id="w-country">${countries.map(([n, c]) => `<option value="${c}"${c === cc ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">Token de TMDB (opcional)</span><input id="w-key" type="password" autocomplete="off" spellcheck="false" placeholder="API Read Access Token" value="${esc(watchCfg.key)}"></label>
      <p class="hint">Con un token gratuito de TMDB (<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org/settings/api</a>) las plataformas aparecen acá mismo. Queda guardado solo en este navegador y se envía únicamente a TMDB.</p>
    </div>`;
  const links = `<div class="links">${tmdbUrl ? `<a href="${tmdbUrl}" target="_blank" rel="noopener">Plataformas en TMDB ↗</a>` : ''}<a href="${jwUrl}" target="_blank" rel="noopener">Buscar en JustWatch ↗</a></div>`;
  const paint = (body) => { el.innerHTML = cfg + body + links; };
  if (!d.tm) return paint('<p class="hint">Este título solo figura en IMDb: probá buscarlo en JustWatch.</p>');
  if (!watchCfg.key) return paint(watchCfg.open ? '' : '<p class="hint">Los enlaces muestran en qué plataformas está disponible. Para verlas acá mismo, agregá un token gratuito de TMDB desde “cambiar”.</p>');
  paint('<div class="skeleton" style="width:55%;height:38px;border-radius:9px"></div>');
  let body;
  try {
    const p = (await fetchProviders(d.tm))[cc];
    const groups = p ? WATCH_GROUPS.filter(([k]) => p[k]?.length).map(([k, name]) => `<div class="prov-group"><span>${name}</span><div class="provs">${p[k].map((x) => `<a class="prov" href="${esc(p.link || tmdbUrl)}" target="_blank" rel="noopener" title="${esc(x.provider_name)}"><img src="${IMG}w92${esc(x.logo_path)}" alt="${esc(x.provider_name)}" loading="lazy"></a>`).join('')}</div></div>`).join('') : '';
    body = (groups || `<p class="none-note">No figura en plataformas de ${esc(cname)}.</p>`) + '<p class="hint">Disponibilidad provista por JustWatch.</p>';
  } catch (err) { body = `<p class="none-note">${esc(err instanceof TypeError ? 'No se pudo consultar TMDB (sin conexión).' : err.message)}</p>`; }
  if (seq === selSeq && panelBody.contains(el)) paint(body);
}

// ------------------------------------------------------------------ filtros
const genresEl = $('#genres');
function buildFilters() {
  genresEl.innerHTML = M.genres.map((g, k) => `<button class="chip" aria-pressed="false" data-g="${k + 1}" style="--c:${GENRE_META[g][1]}" title="${nf.format(M.genreCounts[k + 1])} películas"><i></i>${esc(GENRE_META[g][0])}</button>`).join('');
  genresEl.onclick = (e) => { const b = e.target.closest('.chip'); if (b) toggleGenre(+b.dataset.g); };
  const yMin = $('#year-min'), yMax = $('#year-max');
  for (const el of [yMin, yMax]) { el.min = M.yearMin; el.max = M.yearMax; el.step = 1; }
  yMin.value = M.yearMin; yMax.value = M.yearMax;
  const onYear = (e) => {
    let a = +yMin.value, b = +yMax.value;
    if (a > b) { if (e?.target === yMin) yMax.value = b = a; else yMin.value = a = b; }
    const full = a <= M.yearMin && b >= M.yearMax;
    filt.y0 = full ? 0 : a - M.yearBase; filt.y1 = full ? 255 : b - M.yearBase;
    $('#year-out').textContent = full ? 'todos' : `${a} – ${b}`;
    const span = M.yearMax - M.yearMin;
    $('#year-fill').style.left = (a - M.yearMin) / span * 100 + '%'; $('#year-fill').style.right = (M.yearMax - b) / span * 100 + '%';
    filtersChanged();
  };
  yMin.oninput = yMax.oninput = onYear; onYear();
  $('#rating-min').oninput = (e) => { filt.rating = +e.target.value; $('#rating-out').textContent = filt.rating ? `★ ${(filt.rating / 10).toFixed(1)} o más` : 'cualquiera'; filtersChanged(); };
  const sel = $('#lang');
  sel.insertAdjacentHTML('beforeend', M.langs.map((l, k) => `<option value="${k + 1}">${esc(langName(l.code))} (${nf.format(l.n)})</option>`).join('') + '<option value="0">Otros / desconocido</option>');
  sel.onchange = () => { filt.lang = +sel.value; filtersChanged(); };
  $('#only-poster').onchange = (e) => { filt.onlyPoster = e.target.checked; filtersChanged(); };
  $('#hide-adult').onchange = (e) => { filt.hideAdult = e.target.checked; filtersChanged(); };
  $('#genre-mode').onclick = (e) => { filt.gall = !filt.gall; e.target.textContent = filt.gall ? 'todos' : 'cualquiera'; filtersChanged(); };
  $('#reset').onclick = () => {
    filt.gmask = 0; filt.rating = 0; filt.lang = -1; filt.onlyPoster = filt.hideAdult = filt.onlySaved = false;
    $('#rating-min').value = 0; $('#rating-out').textContent = 'cualquiera'; sel.value = -1;
    $('#only-poster').checked = $('#hide-adult').checked = $('#only-saved').checked = $('#saved-only').checked = false;
    yMin.value = M.yearMin; yMax.value = M.yearMax; syncChips(); onYear();
  };
  $('#color-mode').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    colorMode = +b.dataset.mode;
    for (const x of $('#color-mode').children) x.setAttribute('aria-checked', x === b);
    buildLegend(); render();
    if (selected >= 0) panelBody.querySelectorAll('.similar li').forEach((li) => li.style.setProperty('--c', colorOf(+li.dataset.i)));
  };
  buildLegend();
}
function buildLegend() {
  const el = $('#legend-alt');
  genresEl.classList.toggle('mono', colorMode !== 0);
  el.hidden = colorMode === 0;
  const css = (stops) => `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${(v - stops[0][0]) / (stops[stops.length - 1][0] - stops[0][0]) * 100}%`).join(', ')})`;
  if (colorMode === 1) el.innerHTML = `<div class="gradient-legend"><div class="bar" style="background:${css(YEAR_STOPS)}"></div><div class="ticks"><span>1895</span><span>1930</span><span>1960</span><span>1990</span><span>2026</span></div></div>`;
  else if (colorMode === 2) el.innerHTML = `<div class="gradient-legend"><div class="bar" style="background:${css(RATING_STOPS)}"></div><div class="ticks"><span>★ 1</span><span>4</span><span>6</span><span>8</span><span>10</span></div></div>`;
  else if (colorMode === 3) el.innerHTML = `<div class="lang-legend">${M.langs.slice(0, 12).map((l, k) => `<span><i style="background:${LANG_COLORS[k]}"></i>${esc(langName(l.code))}</span>`).join('')}<span><i style="background:#7c8698"></i>Otros</span></div>`;
}
function syncChips() {
  for (const b of genresEl.children) b.setAttribute('aria-pressed', !!(filt.gmask & (1 << (+b.dataset.g - 1))));
  genresEl.classList.toggle('has-active', filt.gmask !== 0);
}
function toggleGenre(g, only = false) {
  const bit = 1 << (g - 1);
  filt.gmask = only ? (filt.gmask === bit ? 0 : bit) : filt.gmask ^ bit;
  syncChips(); filtersChanged();
}
let countTimer = 0;
function filtersChanged() {
  render();
  clearTimeout(countTimer); countTimer = setTimeout(updateCount, 60);
  if (hover >= 0 && !passes(hover)) setHover(-1);
}
function updateCount() {
  const active = (filt.gmask ? 1 : 0) + (filt.y0 > 0 || filt.y1 < 255 ? 1 : 0) + (filt.rating ? 1 : 0) + (filt.lang >= 0 ? 1 : 0) + (filt.onlyPoster ? 1 : 0) + (filt.hideAdult ? 1 : 0) + (filt.onlySaved ? 1 : 0);
  let c = loaded;
  if (active) { c = 0; for (let i = 0; i < loaded; i++) if (passes(i)) c++; }
  const partial = loaded < N ? ` <span style="color:var(--faint)">(cargando ${Math.round(loaded / N * 100)}%)</span>` : '';
  $('#count').innerHTML = active ? `<b>${nf.format(c)}</b> de ${nf.format(N)} películas${partial}` : `<b>${nf.format(N)}</b> películas${partial}`;
  $('#reset').hidden = !active;
  const badge = $('#filter-badge'); badge.hidden = !active; badge.textContent = active;
}
// panel izquierdo: filtros o guardadas (uno a la vez)
function showLeft(which, force) {
  const el = $('#' + which), other = $(which === 'filters' ? '#saved' : '#filters');
  el.hidden = force !== undefined ? !force : !el.hidden;
  if (!el.hidden) other.hidden = true;
  if (!el.hidden && isMobile() && panel.classList.contains('full')) setSheet(false);   // el menú necesita lugar
  syncLeft();
}
function hideLeft() { $('#filters').hidden = $('#saved').hidden = true; syncLeft(); }
function syncLeft() {
  $('#btn-filters').setAttribute('aria-expanded', !$('#filters').hidden);
  $('#btn-saved').setAttribute('aria-expanded', !$('#saved').hidden);
  document.body.classList.toggle('filters-open', !($('#filters').hidden && $('#saved').hidden));
  if (isFit && M && cam.s > 0) fitView(350);
}
const toggleFilters = (force) => showLeft('filters', force);
$('#btn-filters').onclick = () => showLeft('filters');
$('#btn-saved').onclick = () => showLeft('saved');

// ------------------------------------------------------------------ búsqueda (worker)
const qEl = $('#q'), resEl = $('#results');
let worker = null, qSeq = 0, results = [], resIdx = -1;
function startWorker() {
  if (worker || !M) return;
  worker = new Worker('search-worker.js');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'r' && m.id === qSeq) showResults(m);
  };
  worker.postMessage({ type: 'init', base: new URL(DATA, location.href).href, v: M.v, counts: M.chunks, chunkSize: M.chunkSize });
}
function showResults(m) {
  results = m.items.filter((r) => r.i < loaded); resIdx = results.length ? 0 : -1;
  const words = m.q.split(' ').filter(Boolean);
  const hl = (t) => {   // resalta las coincidencias (comparando sin acentos)
    const n = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (n.length !== t.length) return esc(t);
    const marks = new Uint8Array(t.length);
    for (const w of words) { let p = -1; while ((p = n.indexOf(w, p + 1)) >= 0) marks.fill(1, p, p + w.length); }
    let out = '', open = false;
    for (let k = 0; k < t.length; k++) { if (marks[k] && !open) { out += '<mark>'; open = true; } else if (!marks[k] && open) { out += '</mark>'; open = false; } out += esc(t[k]); }
    return out + (open ? '</mark>' : '');
  };
  resEl.innerHTML = results.length
    ? results.map((r, k) => `<li role="option" data-k="${k}" aria-selected="${k === 0}"><span class="dot" style="background:${colorOf(r.i)}"></span><span class="t">${hl(r.t)}</span><span class="y">${AT[r.i * 8 + 5] & F_SAVED ? '<span style="color:var(--accent)">★</span> ' : ''}${yearOf(r.i) || ''}</span></li>`).join('')
      + (m.loading ? `<li class="more">Indexando el catálogo… ${Math.round(m.progress * 100)}%</li>` : '')
    : `<li class="empty">${m.loading ? `Buscando… (indexando ${Math.round(m.progress * 100)}%)` : 'Sin resultados para esa búsqueda.'}</li>`;
  resEl.hidden = false; qEl.setAttribute('aria-expanded', 'true');
}
function hideResults() { resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }
function chooseResult(k) {
  const r = results[k]; if (!r) return;
  hideResults(); qEl.blur();
  if (!passes(r.i)) $('#reset').click();
  select(r.i);
}
qEl.addEventListener('focus', () => { startWorker(); if (qEl.value.trim() && results.length) resEl.hidden = false; });
qEl.addEventListener('input', () => {
  startWorker();
  const q = qEl.value.trim();
  if (q.length < 2) { qSeq++; hideResults(); return; }
  worker.postMessage({ type: 'q', id: ++qSeq, q });
});
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!results.length) return;
    resIdx = (resIdx + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    [...resEl.querySelectorAll('li[data-k]')].forEach((li, k) => { li.setAttribute('aria-selected', k === resIdx); if (k === resIdx) li.scrollIntoView({ block: 'nearest' }); });
  } else if (e.key === 'Enter') chooseResult(resIdx);
  else if (e.key === 'Escape') { hideResults(); qEl.blur(); }
});
resEl.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-k]'); if (li) { e.preventDefault(); chooseResult(+li.dataset.k); } });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.searchbox') && !e.target.closest('#results')) hideResults(); });

// ------------------------------------------------------------------ controles y teclado
$('#z-in').onclick = () => zoomBy(2);
$('#z-out').onclick = () => zoomBy(0.5);
$('#z-fit').onclick = () => fitView();
$('#z-labels').onclick = toggleLabels;
$('#z-random').onclick = randomMovie;
function toggleLabels() { showLabels = !showLabels; $('#z-labels').classList.toggle('on', showLabels); $('#z-labels').setAttribute('aria-pressed', showLabels); render(); }
function randomMovie() {
  const top = Math.min(loaded, 250000);
  for (let k = 0; k < 400; k++) { const i = (Math.random() * top) | 0; if ((AT[i * 8 + 5] & F_POSTER) && passes(i)) return select(i); }
}
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === '/') { e.preventDefault(); qEl.focus(); qEl.select(); }
  else if (k === 'Escape') { if (!lightbox.hidden) closeLightbox(); else if (!panel.hidden) closePanel(); }
  else if (k === 'l' || k === 'L') toggleLabels();
  else if (k === 'f' || k === 'F') toggleFilters();
  else if (k === 'g' || k === 'G') showLeft('saved');
  else if (k === 's' || k === 'S') toggleSave();
  else if (k === 'r' || k === 'R') randomMovie();
  else if (k === 'p' || k === 'P') togglePerf();
  else if (k === '+' || k === '=') zoomBy(1.8);
  else if (k === '-' || k === '_') zoomBy(1 / 1.8);
  else if (k === '0') fitView();
  else if (k.startsWith('Arrow')) {
    const d = 120 / cam.s; anim = zoomTarget = null;
    flyTo(cam.x + (k === 'ArrowRight' ? d : k === 'ArrowLeft' ? -d : 0), cam.y + (k === 'ArrowDown' ? d : k === 'ArrowUp' ? -d : 0), cam.s, 180);
  }
});
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ arranque
async function boot() {
  initGL();
  const bar = $('#progress i');
  if (!('DecompressionStream' in window)) throw new Error('Este navegador es demasiado antiguo para VectorFlick. Probá con una versión reciente de Chrome, Edge, Firefox o Safari.');
  M = await fetch(DATA + 'manifest.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('No se pudieron cargar los datos del mapa (data/manifest.json).'); return r.json(); });
  N = M.count;
  XY = new Float32Array(2 * N); AT = new Uint8Array(8 * N); GM = new Uint32Array(N);
  const [x0, y0, x1, y1] = M.bounds;
  gx0 = x0; gy0 = y0; gcw = (x1 - x0) / GRID; gch = (y1 - y0) / GRID;
  buildPalette(); buildFilters(); toggleFilters(window.innerWidth > 760);
  loadSaved();                                       // antes de los puntos: cada trozo marca sus guardadas al llegar
  if (new URLSearchParams(location.search).has('perf')) togglePerf();   // ?perf muestra el medidor (útil en el celular)
  cam.s = 0; resize(); updateCount();
  fetchText('titles/0.txt').then((t) => { titles0 = t.split('\n'); render(); });
  let next = 0, done = 0;
  const K = M.chunks.length, pending = new Map();
  const loadOne = async (k) => {
    const buf = await fetchData(`pts/${k}.bin`);
    pending.set(k, buf);
    while (pending.has(done)) { addChunk(done, pending.get(done)); pending.delete(done); done++; }   // siempre en orden: el prefijo cargado es contiguo
    bar.style.width = done / K * 100 + '%';
    render(); clearTimeout(countTimer); countTimer = setTimeout(updateCount, 120);
    if (done === 1) onHash();
  };
  const lane = async () => { while (next < K) await loadOne(next++); };
  await loadOne(next++);                             // el primer trozo solo: primer render inmediato
  await Promise.all([lane(), lane(), lane(), lane()]);
  $('#progress').classList.add('done');
  updateCount(); updateSavedUI(); fillSavedPosters();
  onHash();       // el índice de búsqueda (~20 MB) no se baja acá: se pide recién al enfocar el buscador
}
function onHash() {
  const m = /^#p=(\d+)$/.exec(location.hash);
  if (m && +m[1] < loaded && +m[1] !== selected) { const i = +m[1]; select(i, { fly: false, push: false }); const rw = M.rMin + (M.rMax - M.rMin) * AT[i * 8] / 255; cam.s = clamp(30 / rw, sMin, sMax); focusNode(i, 1); }
}
window.addEventListener('hashchange', onHash);
boot().catch((err) => { console.error(err); const f = $('#fatal'); f.hidden = false; f.textContent = err.message || String(err); });

// para depurar desde la consola
window.atlas = {
  cam, flyTo, select, get M() { return M; }, get loaded() { return loaded; }, filt, pick, render,
  get scales() { return { sFit, sMin, sMax, dpr, W, H, drawn, quality, gpuName }; },
  togglePerf, setQuality(q) { quality = q; },
  setDpr(v) { dprOverride = v; resize(); },
  // mide el costo real por cuadro (CPU + GPU, forzando gl.finish) paneando en círculos
  bench(frames = 40) {
    const times = [], x0 = cam.x, y0 = cam.y, px = new Uint8Array(4);
    for (let k = 0; k < frames; k++) {
      cam.x = x0 + Math.cos(k / 6) * 40 / cam.s; cam.y = y0 + Math.sin(k / 6) * 40 / cam.s;
      const t = performance.now();
      drawGL(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // readPixels obliga a terminar el cuadro en la GPU
      const g = performance.now(); drawOverlay(); const o = performance.now();
      if (k > 2) times.push([g - t, o - g]);
    }
    cam.x = x0; cam.y = y0; render();
    const avg = (j) => +(times.reduce((a, b) => a + b[j], 0) / times.length).toFixed(2);
    return { glMs: avg(0), overlayMs: avg(1), worstMs: +Math.max(...times.map((t) => t[0] + t[1])).toFixed(2) };
  },
};
