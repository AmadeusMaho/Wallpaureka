/*
 * Wallpaper Engine (Steam, app 431960) sin credenciales:
 *  - Se lee la carpeta local de suscripciones: <biblioteca>/steamapps/workshop/content/431960/<id>/ (project.json + el vídeo).
 *  - Las bibliotecas salen de libraryfolders.vdf; Steam se encuentra por el registro (HKCU\Software\Valve\Steam).
 *  - Título, autor y tipo de un enlace del Workshop: API pública GetPublishedFileDetails (sin clave).
 * Nunca se piden contraseñas ni se usa SteamCMD.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { UA, cacheGet, cacheSet, mb } from './net.mjs'

export const WE_APP = '431960'
const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|avi|wmv)$/i

let steamRoot
export function steamPath() {
  if (steamRoot !== undefined) return steamRoot
  const tries = []
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true })
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/); if (m) tries.push(m[1].trim())
  } catch { /* sin registro */ }
  tries.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', path.join(process.env.HOME || process.env.USERPROFILE || '', '.steam/steam'))
  steamRoot = tries.map(p => path.normalize(p)).find(p => fs.existsSync(path.join(p, 'steamapps'))) || null
  return steamRoot
}

/** Carpetas de suscripciones de Wallpaper Engine en todas las bibliotecas de Steam. */
export function workshopDirs() {
  const root = steamPath(); if (!root) return []
  const libs = new Set([root])
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.normalize(m[1].replace(/\\\\/g, '\\')))
  } catch { /* solo la principal */ }
  // En Windows el registro da la ruta en minúsculas y el .vdf no: se quitan los repetidos sin mirar mayúsculas.
  const seen = new Set()
  return [...libs].map(l => path.join(l, 'steamapps', 'workshop', 'content', WE_APP))
    .filter(d => { const k = d.toLowerCase(); if (seen.has(k) || !fs.existsSync(d)) return false; seen.add(k); return true })
}

function readProject(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}
const typeName = t => ({ video: 'vídeo', scene: 'escena', web: 'web', application: 'programa' }[t] || t || 'desconocido')
export const notVideoMsg = t => `Este wallpaper es de tipo «${typeName(t)}»: no es un vídeo, solo funciona dentro de Wallpaper Engine. No se puede descargar como .mp4.`

function localEntry(dir, id) {
  const p = readProject(dir); if (!p) return null
  const type = String(p.type || '').toLowerCase()
  let file = p.file && fs.existsSync(path.join(dir, p.file)) ? p.file : null
  if (type === 'video' && !file) file = fs.readdirSync(dir).find(f => VIDEO_EXT.test(f)) || null
  const isVideo = type === 'video' && !!file
  let size = 0; if (isVideo) try { size = fs.statSync(path.join(dir, file)).size } catch { /* nada */ }
  return {
    src: 'we', id, post: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
    title: String(p.title || id).trim(), type, typeName: typeName(type), isVideo,
    file: isVideo ? file : null, size, sizeText: size ? mb(size) : '',
    thumb: p.preview && fs.existsSync(path.join(dir, p.preview)) ? `/we/${id}/${encodeURIComponent(p.preview)}` : '',
    preview: isVideo ? `/we/${id}/${encodeURIComponent(file)}` : null,
    tags: p.tags || [], dir,
  }
}

let listMemo = null
/** Todas las suscripciones locales (se vuelve a leer si cambia alguna carpeta). */
export function listLocal(force = false) {
  const dirs = workshopDirs()
  const stamp = dirs.map(d => { try { return `${d}:${fs.statSync(d).mtimeMs}` } catch { return d } }).join('|')
  if (!force && listMemo?.stamp === stamp) return listMemo.items
  // Un mismo id puede estar en dos bibliotecas (restos de una copia vieja): se queda el que tiene el vídeo.
  const byId = new Map()
  for (const d of dirs) for (const id of fs.readdirSync(d)) {
    if (!/^\d+$/.test(id)) continue
    const e = localEntry(path.join(d, id), id); if (!e) continue
    const prev = byId.get(id); if (!prev || (!prev.isVideo && e.isVideo)) byId.set(id, e)
  }
  const items = [...byId.values()]
  items.sort((a, b) => Number(b.isVideo) - Number(a.isVideo) || a.title.localeCompare(b.title))
  listMemo = { stamp, items }
  return items
}
export function localById(id) {
  for (const d of workshopDirs()) { const dir = path.join(d, String(id)); if (fs.existsSync(dir)) return localEntry(dir, String(id)) }
  return null
}
/** Ruta segura a un archivo de una suscripción (para servir el vídeo o la miniatura). */
export function localFile(id, name) {
  if (!/^\d+$/.test(id)) return null
  for (const d of workshopDirs()) {
    const dir = path.join(d, id), f = path.resolve(dir, name)
    if (f.startsWith(dir + path.sep) && fs.existsSync(f)) return f
  }
  return null
}

export const workshopId = s => String(s || '').match(/(?:[?&]id=|^)(\d{6,})/)?.[1] || null
export const isWorkshopLink = s => /steamcommunity\.com\/(sharedfiles|workshop)\/filedetails/.test(s) || /^\d{6,}$/.test(String(s).trim())

/** Ficha pública del Workshop (título, autor, tipo), en caché 24 h. */
export async function steamDetails(id) {
  const key = `steam:${id}`; const c = cacheGet(key); if (c) return c.value
  const body = new URLSearchParams({ itemcount: '1', 'publishedfileids[0]': id })
  const j = await (await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', { method: 'POST', body, headers: { 'user-agent': UA } })).json()
  const d = j?.response?.publishedfiledetails?.[0] || {}
  if (d.result !== 1) throw new Error('Steam no encuentra ese elemento del Workshop (¿es privado o lo han borrado?)')
  let author = null
  if (d.creator) {
    try {
      const x = await (await fetch(`https://steamcommunity.com/profiles/${d.creator}/?xml=1`, { headers: { 'user-agent': UA } })).text()
      author = (x.match(/<steamID><!\[CDATA\[([\s\S]*?)\]\]>/) || [])[1]?.trim() || null
    } catch { /* sin autor */ }
  }
  const tags = (d.tags || []).map(t => t.tag)
  const type = (tags.find(t => /^(video|scene|web|application)$/i.test(t)) || '').toLowerCase() || null
  const value = {
    id, app: String(d.consumer_app_id || ''), title: d.title || id, author, creator: d.creator || null, tags, type,
    thumb: d.preview_url || '', size: Number(d.file_size) || 0, description: d.description || '',
    aiNote: /\bAI\b|人工智能|AI software/i.test(d.description || '') ? 'hecho con ayuda de IA (según su autor)' : null,
  }
  cacheSet(key, value, 24 * 3600e3)
  return value
}

/** Enlace o id del Workshop → ficha completa: si está suscrito, con el vídeo local. */
export async function workshop(link) {
  const id = workshopId(link); if (!id) throw new Error('No reconozco el enlace del Workshop. Debe ser como steamcommunity.com/sharedfiles/filedetails/?id=123456789')
  if (!steamPath()) throw new Error('No encuentro Steam en este equipo.')
  let remote = null
  try { remote = await steamDetails(id) } catch (e) { remote = { error: e.message } }
  if (remote?.app && remote.app !== WE_APP) throw new Error('Ese elemento del Workshop no es de Wallpaper Engine.')
  const local = localById(id)
  const type = local?.type || remote?.type || null
  const out = {
    src: 'we', id, post: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
    title: local?.title || remote?.title || id, author: remote?.author || null, note: remote?.aiNote || null,
    thumb: local?.thumb || remote?.thumb || '', type, typeName: typeName(type),
    subscribed: !!local, isVideo: !!local?.isVideo, file: local?.file || null,
    preview: local?.preview || null, sizeText: local?.sizeText || (remote?.size ? mb(remote.size) : ''),
    steamUrl: `steam://url/CommunityFilePage/${id}`, source: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
    remoteError: remote?.error || null,
  }
  if (local && !local.isVideo) out.problem = notVideoMsg(type)
  else if (!local && type && type !== 'video') out.problem = notVideoMsg(type)
  else if (!local) out.problem = 'Aún no está en este equipo. Suscríbete en Steam (botón «Abrir en Steam»), espera a que Wallpaper Engine lo descargue y pulsa «Comprobar de nuevo».'
  return out
}
