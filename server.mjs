/*
 * Wallpaureka!: buscar, previsualizar, descargar y convertir fondos animados (live wallpapers).
 * Arranque: doble clic en «Abrir Wallpaureka!.cmd» (o `node server.mjs`) → http://localhost:5200 (PORT para cambiarlo).
 * Solo escucha en este equipo. Node 18+ sin dependencias; ffmpeg opcional (imageio-ffmpeg de Python o PATH).
 *
 * Fuentes: MoeWalls, WallpaperWaifu, DesktopHut, MotionBGs (lib/sources.mjs) y Wallpaper Engine local (lib/steam.mjs).
 * Perfil opcional WhenGacha (lib/whengacha.mjs): publicar en R2, editar skins.ts y créditos, compilar y subir.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { initCache, download, mb, slugify, UA } from './lib/net.mjs'
import { SOURCES, sourceById, sourceOf, searchSource, resolvePost, MEDIA_HOSTS } from './lib/sources.mjs'
import { ffmpegPath, convert, probe, poster } from './lib/media.mjs'
import { steamPath, workshopDirs, listLocal, localById, localFile, workshop, isWorkshopLink, notVideoMsg } from './lib/steam.mjs'
import { whengacha, SKIN_NAMES, wgSlug, wgTitle } from './lib/whengacha.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(HERE, 'datos')
const WORK = path.join(os.tmpdir(), 'wallpaureka')
const PORT = Number(process.env.PORT) || 5200
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(WORK, { recursive: true })
initCache(DATA)

// ---------- ajustes ----------
const CONFIG_FILE = path.join(DATA, 'config.json')
const defaultWg = path.resolve(HERE, '../app')
let config = {
  downloadDir: path.join(os.homedir(), 'Videos', 'Wallpaureka'),
  whengachaRoot: fs.existsSync(path.join(defaultWg, 'src/skins/skins.ts')) ? defaultWg : '',
  whengachaEnabled: fs.existsSync(path.join(defaultWg, 'src/skins/skins.ts')),
}
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } } catch { /* primera vez */ }
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))

let WG = null, wgError = null
function loadWg() {
  WG = null; wgError = null
  if (!config.whengachaEnabled || !config.whengachaRoot) return
  try { WG = whengacha(config.whengachaRoot) } catch (e) { wgError = e.message }
}
loadWg()

// ---------- cola de trabajos (uno detrás de otro) ----------
const jobs = []
let seq = 0, running = null
const pub = j => ({ id: j.id, kind: j.kind, title: j.title, thumb: j.thumb, srcName: j.srcName, status: j.status, progress: j.progress, text: j.text, warn: j.warn, result: j.result, at: j.at })
function addJob(kind, input) {
  const j = { id: ++seq, kind, input, title: input.title || input.item?.title || 'Fondo', thumb: input.item?.thumb || input.thumb || '', srcName: input.srcName || '', status: 'cola', progress: 0, text: 'En cola', warn: [], at: Date.now() }
  jobs.push(j); pump(); return j
}
async function pump() {
  if (running) return
  const j = jobs.find(x => x.status === 'cola'); if (!j) return
  running = j; j.status = 'activo'; j.ctrl = new AbortController()
  const step = (p, text) => { if (p != null) j.progress = Math.max(0, Math.min(1, p)); if (text) j.text = text }
  try {
    const r = await RUNNERS[j.kind](j, step)
    j.status = 'listo'; j.progress = 1; j.result = r?.result ?? null; j.text = r?.text || 'Hecho'
  } catch (e) {
    j.status = j.ctrl.signal.aborted ? 'cancelado' : 'error'; j.text = j.ctrl.signal.aborted ? 'Cancelado' : e.message
  }
  running = null; pump()
}

/** Elige el vídeo a usar y lo deja en un archivo local. Devuelve { file, details, used }. */
async function fetchVideo(j, step, what) {
  const it = j.input.item || {}
  if (it.src === 'we') {
    const d = localById(it.id)
    if (!d) throw new Error('Ese wallpaper ya no está en la carpeta de Steam (¿te desuscribiste?)')
    if (!d.isVideo) throw new Error(notVideoMsg(d.type))
    j.title = d.title
    return { file: path.join(d.dir, d.file), details: { ...d, original: { res: '' } }, used: 'original', local: true }
  }
  if (it.src === 'file') {
    const f = path.resolve(WORK, String(it.upload || ''))
    if (!f.startsWith(WORK + path.sep) || !fs.existsSync(f)) throw new Error('No encuentro el archivo que elegiste; vuelve a elegirlo')
    return { file: f, details: { title: it.title, slug: slugify(it.title) }, used: 'original', local: true }
  }
  if (it.src === 'url') {
    const ext = (it.post.match(/\.(mp4|webm|mov|mkv|m4v)(\?|$)/i) || [])[1]?.toLowerCase() || 'mp4'
    const file = path.join(WORK, `j${j.id}-src.${ext}`)
    step(.02, 'Descargando…')
    const n = await download(it.post, file, (p, got) => step(p == null ? null : p * .5, `Descargando… ${p == null ? mb(got) : Math.round(p * 100) + ' %'}`), { signal: j.ctrl.signal })
    return { file, details: { title: it.title, slug: slugify(it.title) }, used: 'original', size: n }
  }
  step(.01, 'Leyendo la ficha del fondo…')
  const d = await resolvePost(it.post)
  j.srcName = d.srcName; if (d.thumb && !j.thumb) j.thumb = d.thumb
  let pick = what === 'original' ? d.original : null, used = pick ? 'original' : 'preview'
  if (!pick) {
    if (what === 'original') j.warn.push(d.originalNote || `${d.srcName} no ofrece el original: se usa la vista previa.`)
    pick = d.preview ? { url: d.preview } : d.original
    if (!d.preview && d.original) used = 'original'
  }
  if (!pick?.url) throw new Error('No encontré ningún vídeo en esa página')
  const ext = (pick.url.match(/\.(mp4|webm|mov|mkv)(\?|$|\/)/i) || [])[1]?.toLowerCase() || (pick.ext || 'mp4')
  const file = path.join(WORK, `j${j.id}-src.${ext}`)
  step(.03, `Descargando ${used === 'original' ? 'el original' : 'la vista previa'}…`)
  const n = await download(pick.url, file, (p, got, total) => step(p == null ? null : .03 + p * .47, `Descargando ${used === 'original' ? 'el original' : 'la vista previa'}… ${p == null ? mb(got) : `${Math.round(p * 100)} % de ${mb(total)}`}`), { referer: d.referer, signal: j.ctrl.signal })
  return { file, details: d, used, size: n }
}
function freeName(dir, base, ext) {
  let name = `${base}.${ext}`, i = 2
  while (fs.existsSync(path.join(dir, name))) name = `${base}-${i++}.${ext}`
  return path.join(dir, name)
}
const FORMATS = {
  none: null,
  hd: { width: 1920, crf: 20 },
  full: { width: 3840, crf: 20 },
  light: { width: 1280, crf: 27, fps: 24, tune: 'animation' },
}

const RUNNERS = {
  async download(j, step) {
    const o = j.input, dir = o.dir || config.downloadDir
    fs.mkdirSync(dir, { recursive: true })
    const v = await fetchVideo(j, step, o.what || 'original')
    const base = slugify(o.name || v.details.title || j.title)
    const fmt = FORMATS[o.format] ?? null
    let dest
    if (!fmt) {
      const ext = path.extname(v.file).slice(1) || 'mp4'
      dest = freeName(dir, base, ext)
      step(.9, 'Guardando…')
      if (v.local) fs.copyFileSync(v.file, dest); else fs.renameSync(v.file, dest)
    } else {
      dest = freeName(dir, base, 'mp4')
      step(.5, `Convirtiendo a mp4 H.264${o.crop169 ? ', recortado a 16:9' : ''}…`)
      await convert(v.file, dest, { ...fmt, crop169: o.crop169, audio: o.audio }, p => step(.5 + p * .48, `Convirtiendo… ${Math.round(p * 100)} %`), j.ctrl.signal)
      if (!v.local) fs.rmSync(v.file, { force: true })
    }
    const info = await probe(dest), size = fs.statSync(dest).size
    const what = v.used === 'original' ? 'original' : 'vista previa'
    return { result: { file: dest, dims: info.dims, size, sizeText: mb(size), duration: Math.round(info.duration || 0), used: v.used },
      text: `Guardado (${what}${info.dims ? `, ${info.dims}` : ''}, ${mb(size)})${j.warn.length ? ' · ' + j.warn.join(' ') : ''}` }
  },
  async whengacha(j, step) {
    if (!WG) throw new Error('El perfil WhenGacha no está activo (Ajustes)')
    const o = j.input
    const v = await fetchVideo(j, step, o.what || 'preview')
    const d = v.details
    const slug = wgSlug(o.slug || d.slug || slugify(d.title))
    if (WG.has(o.skin, slug)) return { text: `«${slug}» ya está en ${SKIN_NAMES[o.skin]}: no se repite.` }
    const mp4 = path.join(WORK, `j${j.id}.mp4`), webp = path.join(WORK, `j${j.id}.webp`)
    const width = o.width || (v.used === 'original' ? 1920 : 1280), crf = o.crf || (v.used === 'original' ? 26 : 27)
    step(.5, `Convirtiendo a ${width} px, CRF ${crf}${o.crop169 ? ', recortado a 16:9' : ''}…`)
    const info = await convert(v.file, mp4, { width, crf, fps: 24, tune: 'animation', crop169: o.crop169 }, p => step(.5 + p * .3, `Convirtiendo… ${Math.round(p * 100)} %`), j.ctrl.signal)
    await poster(mp4, webp)
    const size = fs.statSync(mp4).size
    if (size > 4.5 * 1048576) j.warn.push(`pesa ${mb(size)} (prueba CRF 28–29)`)
    const credit = o.credit || { title: wgTitle(d.title), author: d.author || '', link: d.author ? d.source : (d.source || d.post), note: d.note || '' }
    const msg = await WG.publish({ skin: o.skin, slug, mp4, webp, credit, official: o.official }, (p, t) => step(.8 + p * .2, t))
    if (!v.local) fs.rmSync(v.file, { force: true })
    return { result: { slug, skin: o.skin, dims: info.dims, sizeText: mb(size) }, text: `${msg} (${info.dims}, ${mb(size)})${j.warn.length ? ' · ' + j.warn.join(' ') : ''}` }
  },
  async 'wg-remove'(j) { if (!WG) throw new Error('Perfil WhenGacha inactivo'); return { text: await WG.remove(j.input) } },
  async 'wg-build'(j, step) { if (!WG) throw new Error('Perfil WhenGacha inactivo'); return { text: await WG.build(step) } },
  async 'wg-push'(j, step) { if (!WG) throw new Error('Perfil WhenGacha inactivo'); return { text: await WG.push(j.input.message, step) } },
}

// ---------- utilidades HTTP ----------
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)) }
const readBody = req => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; if (s.length > 1e6) reject(new Error('Demasiado grande')) }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch (e) { reject(e) } }) })
function stream(res) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' })
  const send = o => res.write(JSON.stringify(o) + '\n')
  return { send, end: o => { send(o); res.end() } }
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml' }
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('No existe') }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
    if (range && type.startsWith('video/')) {
      const start = Number(range[1] || 0), end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
      return fs.createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })
}
/** Vídeo remoto a través de la app (con el referer de su web y peticiones por rangos), solo de las webs conocidas. */
async function proxyMedia(req, res, u, referer) {
  let url; try { url = new URL(u) } catch { return json(res, 400, { error: 'Enlace no válido' }) }
  const h = url.hostname.replace(/^www\./, '')
  if (url.protocol !== 'https:' || !MEDIA_HOSTS.some(x => h === x || h.endsWith('.' + x))) return json(res, 403, { error: 'Web no permitida' })
  const headers = { 'user-agent': UA, ...(req.headers.range ? { range: req.headers.range } : {}) }
  if (referer && /^https:\/\//.test(referer)) headers.referer = referer
  const ac = new AbortController(); req.on('close', () => ac.abort())
  try {
    const r = await fetch(url, { headers, signal: ac.signal })
    const out = { 'content-type': r.headers.get('content-type') || 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' }
    for (const k of ['content-length', 'content-range']) if (r.headers.get(k)) out[k] = r.headers.get(k)
    res.writeHead(r.status, out)
    for await (const c of r.body) res.write(c)
    res.end()
  } catch { if (!res.headersSent) json(res, 502, { error: 'No se pudo leer el vídeo' }); else res.end() }
}
function openPath(p, select) {
  spawn('explorer.exe', [select ? `/select,${p}` : p], { detached: true, windowsHide: false }).unref()
}
function pickFolder(start) {
  return new Promise(resolve => {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false}; ` +
      `$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Carpeta para guardar los fondos'; $d.ShowNewFolderButton = $true; ` +
      `$d.SelectedPath = $env:FL_START; if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }`
    const p = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, env: { ...process.env, FL_START: start || '' } })
    let out = ''; p.stdout.on('data', d => out += d); p.on('close', () => resolve(out.trim() || null)); p.on('error', () => resolve(null))
  })
}

function info() {
  const dirs = workshopDirs()
  return {
    config, ffmpeg: ffmpegPath(), port: PORT,
    sources: SOURCES.map(s => ({ id: s.id, name: s.name, home: s.home })),
    steam: { path: steamPath(), dirs },
    whengacha: { enabled: !!WG, root: config.whengachaRoot, error: wgError, skins: Object.entries(SKIN_NAMES).map(([id, name]) => ({ id, name })) },
  }
}

/** Búsqueda en varias fuentes, una detrás de otra. */
async function search(body, out) {
  const q = String(body.q || '').trim().slice(0, 80)
  if (!q) throw new Error('Escribe qué buscar (p. ej. arknights)')
  const ids = (Array.isArray(body.sources) && body.sources.length ? body.sources : SOURCES.map(s => s.id)).filter(id => sourceById(id))
  const per = {}, items = []
  for (const [i, id] of ids.entries()) {
    const s = sourceById(id)
    out.send({ source: id, progress: i / ids.length, text: `${s.name}: buscando…` })
    try {
      const r = await searchSource(s, q, { fresh: !!body.fresh, onPage: p => out.send({ source: id, progress: (i + Math.min(.9, p.page * .15)) / ids.length, text: p.cached ? `${s.name}: ${p.count} (guardado hace ${Math.max(1, Math.round((Date.now() - p.at) / 60e3))} min)` : `${s.name}: página ${p.page}, ${p.count} fondos` }) })
      per[id] = { count: r.items.length, truncated: r.truncated }
      items.push(...r.items.map((x, k) => ({ ...x, n: k + 1, srcName: s.name })))
    } catch (e) { per[id] = { count: 0, error: e.message } }
  }
  out.end({ done: true, progress: 1, q, items, per })
}

/** Enlace pegado: Workshop, post de una web conocida o vídeo directo. */
async function link(url) {
  url = String(url || '').trim()
  if (isWorkshopLink(url)) return { kind: 'we', item: await workshop(url) }
  let u; try { u = new URL(url) } catch { throw new Error('Eso no parece un enlace. Pega la dirección completa (https://…)') }
  if (/\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(u.pathname)) {
    const name = decodeURIComponent(u.pathname.split('/').pop()).replace(/\.\w+$/, '')
    return { kind: 'url', item: { src: 'url', srcName: u.hostname, post: url, title: name, original: { url }, preview: null } }
  }
  const s = sourceOf(url)
  if (!s) throw new Error(`No sé leer ${u.hostname}. Webs admitidas: ${SOURCES.map(x => x.name).join(', ')}, Steam Workshop (Wallpaper Engine) o un enlace directo a un .mp4/.webm.`)
  return { kind: 'post', item: await resolvePost(url) }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`), P = url.pathname
  try {
    if (req.method === 'GET') {
      if (P === '/') return serveFile(req, res, path.join(HERE, 'public', 'index.html'))
      if (/^\/(app\.js|app\.css|icono\.svg)$/.test(P)) return serveFile(req, res, path.join(HERE, 'public', P.slice(1)))
      if (P === '/api/info') return json(res, 200, info())
      if (P === '/api/item') return json(res, 200, await resolvePost(url.searchParams.get('post') || ''))
      if (P === '/api/queue') return json(res, 200, { jobs: jobs.map(pub), running: running?.id || null })
      if (P === '/api/we/list') return json(res, 200, { items: listLocal(url.searchParams.has('refresh')), dirs: workshopDirs(), steam: steamPath() })
      if (P === '/media') return proxyMedia(req, res, url.searchParams.get('u'), url.searchParams.get('r'))
      if (P.startsWith('/we/')) { const [, , id, ...rest] = P.split('/'); const f = localFile(id, decodeURIComponent(rest.join('/'))); return f ? serveFile(req, res, f) : json(res, 404, {}) }
      if (P === '/api/wg/state') { if (!WG) return json(res, 200, { enabled: false, error: wgError }); return json(res, 200, { enabled: true, ...WG.state() }) }
      if (P.startsWith('/wg/poster/') && WG) { const f = WG.posterFile(decodeURIComponent(P.slice(11))); return f ? serveFile(req, res, f) : json(res, 404, {}) }
    }
    if (req.method === 'GET' && P.startsWith('/work/')) { const f = path.resolve(WORK, decodeURIComponent(P.slice(6))); return f.startsWith(WORK + path.sep) ? serveFile(req, res, f) : json(res, 400, {}) }
    if (req.method === 'POST' && P === '/api/upload') {
      // Vídeo del PC: se copia a la carpeta de trabajo para convertirlo o publicarlo.
      const ext = (url.searchParams.get('name') || '').match(/\.(mp4|webm|mov|mkv|m4v|gif)$/i)?.[0]?.toLowerCase() || '.mp4'
      const name = `u${Date.now().toString(36)}${ext}`
      const out = fs.createWriteStream(path.join(WORK, name)); req.pipe(out)
      return out.on('finish', () => json(res, 200, { upload: name })).on('error', e => json(res, 500, { error: e.message }))
    }
    if (req.method === 'POST') {
      const b = await readBody(req)
      if (P === '/api/search') { const out = stream(res); try { await search(b, out) } catch (e) { out.end({ error: e.message }) } return }
      if (P === '/api/link') return json(res, 200, await link(b.url))
      if (P === '/api/we/workshop') return json(res, 200, await workshop(b.url))
      if (P === '/api/config') {
        if (typeof b.downloadDir === 'string' && b.downloadDir.trim()) config.downloadDir = path.resolve(b.downloadDir.trim())
        if (typeof b.whengachaRoot === 'string') config.whengachaRoot = b.whengachaRoot.trim()
        if (typeof b.whengachaEnabled === 'boolean') config.whengachaEnabled = b.whengachaEnabled
        saveConfig(); loadWg(); return json(res, 200, info())
      }
      if (P === '/api/pick-folder') return json(res, 200, { path: await pickFolder(b.start || config.downloadDir) })
      if (P === '/api/open') {
        // Solo carpetas de descarga o archivos que haya hecho la cola.
        const f = b.job ? jobs.find(j => j.id === b.job)?.result?.file : null
        if (f && fs.existsSync(f)) openPath(f, true)
        else { fs.mkdirSync(config.downloadDir, { recursive: true }); openPath(config.downloadDir) }
        return json(res, 200, { ok: true })
      }
      if (P === '/api/queue/add') {
        const list = (b.jobs || []).filter(x => RUNNERS[x.kind]).map(x => addJob(x.kind, x))
        return json(res, 200, { ids: list.map(j => j.id) })
      }
      if (P === '/api/queue/cancel') {
        const j = jobs.find(x => x.id === b.id)
        if (j?.status === 'cola') { j.status = 'cancelado'; j.text = 'Cancelado' } else if (j?.status === 'activo') j.ctrl.abort()
        return json(res, 200, { ok: true })
      }
      if (P === '/api/queue/retry') {
        const j = jobs.find(x => x.id === b.id)
        if (j && (j.status === 'error' || j.status === 'cancelado')) { Object.assign(j, { status: 'cola', progress: 0, text: 'En cola', warn: [] }); pump() }
        return json(res, 200, { ok: true })
      }
      if (P === '/api/queue/clear') { for (let i = jobs.length - 1; i >= 0; i--) if (!['cola', 'activo'].includes(jobs[i].status)) jobs.splice(i, 1); return json(res, 200, { ok: true }) }
      if (P === '/api/wg/move') { if (!WG) throw new Error('Perfil WhenGacha inactivo'); WG.move(b); return json(res, 200, { enabled: true, ...WG.state() }) }
    }
    json(res, 404, { error: 'No existe' })
  } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message }); else res.end() }
})

const openBrowser = () => { if (process.env.NO_OPEN !== '1') spawn('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true, detached: true }).unref() }
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`Wallpaureka! ya estaba abierta en http://localhost:${PORT}: la abro en el navegador.`); openBrowser(); setTimeout(() => process.exit(0), 500) }
  else { console.error(e.message); process.exit(1) }
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Wallpaureka! en http://localhost:${PORT}  (cierra esta ventana para salir)`)
  if (!ffmpegPath()) console.log('Aviso: no hay ffmpeg; se puede descargar sin convertir. Para convertir: pip install imageio-ffmpeg')
  openBrowser()
})
