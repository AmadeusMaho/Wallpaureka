/*
 * Red: peticiones educadas a las webs de fondos.
 *  - Una cola por sitio: nunca dos peticiones a la vez al mismo sitio, y una pausa entre una y otra.
 *  - Caché en memoria y en disco (datos/cache.json): búsquedas 30 min, fichas de cada fondo 24 h.
 */
import fs from 'node:fs'
import path from 'node:path'

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
export const sleep = ms => new Promise(r => setTimeout(r, ms))

const GAP = 800 // ms entre dos peticiones al mismo sitio
const lanes = new Map() // host → promesa de la última petición
/** fetch en fila por sitio, con pausa. */
export function politeFetch(url, opts = {}) {
  const host = new URL(url).hostname.replace(/^www\./, '')
  const prev = lanes.get(host) || Promise.resolve()
  const run = prev.then(async () => {
    try { return await fetch(url, { ...opts, headers: { 'user-agent': UA, 'accept-language': 'en,es;q=0.8', ...(opts.headers || {}) } }) }
    finally { await sleep(GAP) }
  })
  lanes.set(host, run.catch(() => {}))
  return run
}

// ---------- caché ----------
let CACHE_FILE = null, cache = {}, saveTimer = null
export function initCache(dir) {
  CACHE_FILE = path.join(dir, 'cache.json')
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch { cache = {} }
  // Se tira lo caducado al arrancar.
  const now = Date.now(); for (const k in cache) if (cache[k].exp < now) delete cache[k]
}
export function cacheGet(key) { const e = cache[key]; return e && e.exp > Date.now() ? e : null }
export function cacheSet(key, value, ttlMs) {
  cache[key] = { at: Date.now(), exp: Date.now() + ttlMs, value }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)) } catch { /* sin caché en disco */ } }, 1500)
}
export function cacheDrop(prefix) { for (const k in cache) if (k.startsWith(prefix)) delete cache[k] }

/** Texto de una página con caché. */
export async function getPage(url, ttlMs = 30 * 60e3, { fresh = false, referer } = {}) {
  const key = `page:${url}`
  if (!fresh) { const c = cacheGet(key); if (c) return c.value }
  const r = await politeFetch(url, { headers: referer ? { referer } : {} })
  const value = { status: r.status, url: r.url, html: r.ok ? await r.text() : '' }
  if (r.ok) cacheSet(key, value, ttlMs)
  return value
}

/** Descarga a un archivo con progreso (0..1). Devuelve los bytes. */
export async function download(url, dest, onProgress = () => {}, { referer, signal } = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...(referer ? { referer } : {}) }, redirect: 'follow', signal })
  if (!r.ok) throw new Error(`La web respondió ${r.status} al descargar el vídeo`)
  const type = r.headers.get('content-type') || ''
  if (/text\/html/.test(type)) throw new Error('La web devolvió una página en vez del vídeo (puede que pida abrirla en el navegador)')
  const total = Number(r.headers.get('content-length')) || 0
  let got = 0, last = 0
  const tmp = dest + '.part'
  const out = fs.createWriteStream(tmp)
  try {
    for await (const chunk of r.body) {
      if (!out.write(chunk)) await new Promise(res => out.once('drain', res))
      got += chunk.length
      if (got - last > 256 * 1024) { last = got; onProgress(total ? got / total : null, got, total) }
    }
    await new Promise((res, rej) => out.end(err => err ? rej(err) : res()))
  } catch (e) { out.destroy(); fs.rmSync(tmp, { force: true }); throw e }
  fs.renameSync(tmp, dest)
  onProgress(1, got, total)
  return got
}

export const mb = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`
export const decHtml = s => String(s ?? '').replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#821[12];/g, '–').replace(/&#038;|&amp;/g, '&')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
export const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fondo'
