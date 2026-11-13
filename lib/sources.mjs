/*
 * Webs de fondos animados: búsqueda (todas las páginas, una tras otra) y ficha de cada fondo (vista previa y original).
 * Cada fuente: { id, name, home, hosts, searchUrl(q, page, prev), parseList(html), hasNext(html, page, url), resolve(post) }.
 * Formato de un resultado: { src, post, title, thumb, res, votes, cat }.
 * Formato de una ficha: { src, post, title, slug, thumb, res, preview, original: {url, res, sizeText} | null, author, source, note, referer }.
 */
import { getPage, decHtml, slugify, cacheGet, cacheSet } from './net.mjs'
import { steamDetails, workshopId } from './steam.mjs'

const abs = (u, base) => { try { return new URL(decHtml(u), base).href } catch { return '' } }
const cleanTitle = t => decHtml(t).replace(/\s*[—-]\s*animated wallpaper$/i, '').replace(/\s*(4K\s*)?(Live|Animated) Wallpaper(\s+for PC)?$/i, '').trim()
const first = (s, re) => (s.match(re) || [])[1] || ''

/** El enlace «Source» de MoeWalls y WallpaperWaifu va en base64 (casi siempre una ficha del Steam Workshop). */
function sourceLink(html) {
  const seg = first(html, /Source\s*<\/[^>]+>([\s\S]{0,600})/)
  for (const b of seg.match(/[A-Za-z0-9+/]{16,}={0,2}/g) || []) {
    try { const d = Buffer.from(b, 'base64').toString('utf8'); if (/^https?:\/\/[\x21-\x7e]+$/.test(d)) return d } catch { /* no es base64 */ }
  }
  return null
}
/** Autor desde Steam si el origen es una ficha del Workshop. */
async function authorFrom(source) {
  const id = /steamcommunity\.com/.test(source || '') ? workshopId(source) : null
  if (!id) return {}
  try { const d = await steamDetails(id); return { author: d.author, steamTitle: d.title, note: d.aiNote } } catch { return {} }
}

// ---------- WordPress (MoeWalls y WallpaperWaifu comparten estructura de enlaces) ----------
function wpSearchUrl(home) { return (q, p) => `${home}/${p > 1 ? `page/${p}/` : ''}?s=${encodeURIComponent(q)}` }

const moewalls = {
  id: 'moewalls', name: 'MoeWalls', home: 'https://moewalls.com', hosts: ['moewalls.com'],
  searchUrl: wpSearchUrl('https://moewalls.com'),
  parseList(html) {
    const out = []
    for (const it of html.split('<li class="g1-collection-item').slice(1)) {
      const m = it.match(/entry-title[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)</); if (!m) continue
      out.push({
        post: m[1], title: cleanTitle(m[2]), res: first(it, /resolution\/(\d+x\d+)/),
        votes: Number(first(it, /entry-votes[^>]*>\s*<strong>(\d+)/) || 0), cat: decHtml(first(it, /class="entry-category[^"]*">([^<]+)</)),
        thumb: first(it, /(https:\/\/\S+?-thumb-728x\d+\.\w+) 728w/) || first(it, /<img[^>]+src="([^"]+)"/),
      })
    }
    return out
  },
  hasNext: (html, p) => html.includes(`/page/${p + 1}/`),
  async resolve(post) {
    const { html } = await getPage(post, 24 * 3600e3)
    if (!html) throw new Error('MoeWalls no devolvió la página del fondo')
    const thumb = first(html, /property="og:image" content="([^"]+)"/)
    const title = cleanTitle(first(html, /<title>([^<]+)/).split(' - ')[0])
    const tm = thumb.match(/\/uploads\/(\d{4})\/\d{2}\/(.+?)-thumb[^/]*\.\w+$/)
    // El vídeo del reproductor es la fuente fiable; deducirlo del póster falla a veces (p. ej. «frostnova-arknights-2»).
    let preview = abs(first(html, /<video[\s\S]{0,1500}?<source src="([^"]+)"/), 'https://moewalls.com') || null
    if (!preview && tm) preview = `https://moewalls.com/wp-content/uploads/preview/${tm[1]}/${tm[2]}-preview.webm`
    const res = first(html, /resolution\/(\d+x\d+)\/" rel="tag"/)
    const source = sourceLink(html)
    return { title, slug: tm?.[2] || slugify(title), thumb, res, preview, original: null, source: source || post, ...(await authorFrom(source)), referer: 'https://moewalls.com/' }
  },
}

const wallpaperwaifu = {
  id: 'wallpaperwaifu', name: 'WallpaperWaifu', home: 'https://wallpaperwaifu.com', hosts: ['wallpaperwaifu.com'],
  searchUrl: wpSearchUrl('https://wallpaperwaifu.com'),
  parseList(html) {
    const out = []
    for (const it of html.split('<article data-id="post-').slice(1)) {
      const m = it.match(/<a href="([^"]+)" title="([^"]+)"/); if (!m) continue
      out.push({
        post: m[1], title: cleanTitle(m[2]), res: first(it, /resolutions-(\d+x\d+)/) || first(it, /resolution\/(\d+x\d+)/),
        votes: Number(first(it, /wall-fav">\s*(\d+)/) || 0), cat: decHtml(first(it, /category-([a-z0-9-]+)/)),
        thumb: first(it, /data-src="([^"]+)"/) || first(it, /<img[^>]+src="([^"]+)"/),
      })
    }
    return out
  },
  hasNext: (html, p) => html.includes(`/page/${p + 1}/`),
  async resolve(post) {
    const { html } = await getPage(post, 24 * 3600e3)
    if (!html) throw new Error('WallpaperWaifu no devolvió la página del fondo')
    const thumb = first(html, /property="og:image" content="([^"]+)"/)
    const title = cleanTitle(first(html, /<h1>([^<]+)<\/h1>/) || first(html, /<title>([^<]+)/).split(' - ')[0])
    const src = first(html, /"src":"(\\?\/wp-content\\?\/uploads\\?\/preview\\?\/[^"]+)"/).replace(/\\\//g, '/')
    const preview = src ? abs(src, 'https://wallpaperwaifu.com') : null
    const res = first(html, /resolution\/(\d+x\d+)\/" rel="tag"/)
    const source = sourceLink(html)
    // La descarga del original va cifrada y detrás de anuncios: solo se usa la vista previa.
    return { title, slug: slugify(first(preview || '', /\/([^/]+?)-preview\.\w+$/) || title), thumb, res, preview, original: null, source: source || post, ...(await authorFrom(source)), referer: 'https://wallpaperwaifu.com/', originalNote: 'WallpaperWaifu solo deja descargar el original desde su web (con anuncios); aquí se usa la vista previa.' }
  },
}

const desktophut = {
  id: 'desktophut', name: 'DesktopHut', home: 'https://www.desktophut.com', hosts: ['desktophut.com', 'media.desktophut.com'],
  searchUrl: (q, p) => `https://www.desktophut.com/search/${encodeURIComponent(q)}${p > 1 ? `?page=${p}` : ''}`,
  parseList(html) {
    const out = []
    const parts = html.split(/(?=<a href="[^"]+" class="wallpaper-card")/).slice(1)
    for (const it of parts) {
      const m = it.match(/^<a href="([^"]+)" class="wallpaper-card" title="([^"]+)"/); if (!m) continue
      const card = it.slice(0, 3000)
      out.push({
        post: abs(m[1], 'https://www.desktophut.com'), title: cleanTitle(m[2]),
        res: first(card, /badge-res">(\d+x\d+)/), votes: Number(first(card, /card-vote-score[^>]*>\s*\S+\s*(-?\d+)/) || 0),
        cat: first(card, /badge-downloads">([^<]+)/), thumb: first(card, /<img src="([^"]+)"/),
      })
    }
    return out
  },
  hasNext: (html, p) => html.includes(`page=${p + 1}`),
  async resolve(post) {
    const { html } = await getPage(post, 24 * 3600e3)
    if (!html) throw new Error('DesktopHut no devolvió la página del fondo')
    const title = cleanTitle(first(html, /<h1[^>]*>([^<]+)</) || first(html, /property="og:title" content="([^"]+)"/))
    const thumb = first(html, /property="og:image" content="([^"]+)"/)
    const preview = first(html, /<source src="(https:\/\/media\.desktophut\.com\/previews\/[^"]+)"/) || null
    let orig = first(html, /(https:\/\/media\.desktophut\.com\/files\/[^"'\s<]+)/)
    if (!orig) { const c = first(html, /"contentUrl":\s*"(https:\/\/www\.desktophut\.com\/files\/[^"]+)"/); if (c) orig = encodeURI(c.replace('https://www.desktophut.com/', 'https://media.desktophut.com/')) }
    const res = first(html, /badge-res">(\d+x\d+)/) || first(html, /(\d{3,4}x\d{3,4})/)
    const ext = (orig.match(/\.(\w+)(\?|$)/) || [])[1]?.toLowerCase()
    return {
      title, slug: slugify(title), thumb, res, preview,
      original: orig && /^(mp4|webm|mov|mkv)$/.test(ext) ? { url: orig, res, ext } : null,
      originalNote: orig && !/^(mp4|webm|mov|mkv)$/.test(ext || '') ? 'El original no es un vídeo (es un paquete de Wallpaper Engine).' : null,
      source: post, referer: 'https://www.desktophut.com/',
    }
  },
}

const motionbgs = {
  id: 'motionbgs', name: 'MotionBGs', home: 'https://motionbgs.com', hosts: ['motionbgs.com'],
  // La búsqueda redirige a una etiqueta (/tag:arknights/) cuando coincide con una; las etiquetas se paginan con /tag:x/2/.
  searchUrl: (q, p, prev) => p === 1 || !prev ? `https://motionbgs.com/search?q=${encodeURIComponent(q)}`
    : /\/tag:[^/]+\/?/.test(prev) ? prev.replace(/(\/tag:[^/]+\/).*$/, `$1${p}/`) : `https://motionbgs.com/search?q=${encodeURIComponent(q)}&page=${p}`,
  parseList(html) {
    const out = []
    // HTML minimizado: atributos sin comillas.
    for (const m of html.matchAll(/<a title="([^"]+)" href=(\/[^ >]+)>([\s\S]*?)<\/a>/g)) {
      if (/^\/(tag:|page\/|dl\/|i\/)/.test(m[2])) continue
      const body = m[3], img = first(body, /<img [^>]*src=([^ >]+)/)
      const frm = decHtml(first(body, /class=frm>([^<]*)</))
      const resIn = first(img, /\.(\d{3,4}x\d{3,4})\./)
      out.push({
        post: abs(m[2], 'https://motionbgs.com'), title: cleanTitle(decHtml(first(body, /class=ttl>([^<]*)</) || m[1])),
        res: resIn || (/4k/i.test(frm) ? '3840x2160' : /hd/i.test(frm) ? '1920x1080' : ''), votes: 0, cat: frm,
        thumb: abs(img, 'https://motionbgs.com'),
      })
    }
    return out
  },
  hasNext: (html, p, url) => /\/tag:/.test(url) ? html.includes(`/${p + 1}/>`) || html.includes(`/${p + 1}/ `) : html.includes(`page=${p + 1}`),
  async resolve(post) {
    const { html } = await getPage(post, 24 * 3600e3)
    if (!html) throw new Error('MotionBGs no devolvió la página del fondo')
    const title = cleanTitle(decHtml(first(html, /<h1><span>([^<]+)<\/span>/) || first(html, /<title>([^<|]+)/)))
    const thumb = abs(first(html, /content=(\S+?) property=og:image/), 'https://motionbgs.com')
    const preview = abs(first(html, /content=(\S+?\.mp4) property=og:video/) || first(html, /<source src=([^ >]+\.mp4)/), 'https://motionbgs.com') || null
    // Botones de descarga: /dl/hd/<n> (1920x1080), a veces /dl/4k/<n>. Se usa el de mayor resolución que aparezca.
    const dls = [...html.matchAll(/href=(\/dl\/(\w+)\/(\d+))[^>]*>([\s\S]{0,900}?)<\/a>/g)].map(m => ({
      url: abs(m[1] + '/', 'https://motionbgs.com'), res: first(m[4], /(\d{3,4}x\d{3,4})/), sizeText: first(m[4], /\(([\d.]+\s*[MG]b)\)/i), ext: 'mp4',
    }))
    const px = r => r ? r.split('x').reduce((a, b) => a * b, 1) : 0
    dls.sort((a, b) => px(b.res) - px(a.res))
    const original = dls[0] || null
    return { title, slug: slugify(first(post, /motionbgs\.com\/([^/?#]+)/) || title), thumb, res: original?.res || '', preview, previewRes: '960x540', original, source: post, referer: 'https://motionbgs.com/' }
  },
}

export const SOURCES = [moewalls, wallpaperwaifu, desktophut, motionbgs]
export const sourceById = id => SOURCES.find(s => s.id === id)
export function sourceOf(url) {
  try { const h = new URL(url).hostname.replace(/^www\./, ''); return SOURCES.find(s => s.hosts.some(x => h === x || h.endsWith('.' + x))) || null } catch { return null }
}
export const MEDIA_HOSTS = ['moewalls.com', 'wallpaperwaifu.com', 'desktophut.com', 'motionbgs.com']

/** Busca en una fuente, página a página (con pausa, nunca en paralelo). 30 min en caché. */
export async function searchSource(src, q, { fresh = false, maxPages = 25, onPage = () => {} } = {}) {
  const key = `search:${src.id}:${q.toLowerCase()}`
  if (!fresh) { const c = cacheGet(key); if (c) { onPage({ page: 0, count: c.value.items.length, cached: true, at: c.at }); return c.value } }
  const items = [], seen = new Set(); let prevUrl = null, truncated = false
  for (let p = 1; p <= maxPages; p++) {
    const url = src.searchUrl(q, p, prevUrl)
    const r = await getPage(url, 30 * 60e3, { fresh })
    if (r.status === 404) break
    if (!r.html) throw new Error(`${src.name} respondió ${r.status} en la página ${p}`)
    prevUrl = r.url
    let n = 0
    for (const it of src.parseList(r.html)) {
      if (seen.has(it.post)) continue
      seen.add(it.post); n++; items.push({ src: src.id, ...it })
    }
    onPage({ page: p, count: items.length, added: n })
    if (!n || !src.hasNext(r.html, p, r.url)) break
    if (p === maxPages) truncated = true
  }
  const value = { items, truncated }
  cacheSet(key, value, 30 * 60e3)
  return value
}

/** Ficha completa de un fondo (24 h en caché). */
export async function resolvePost(post) {
  const src = sourceOf(post); if (!src) throw new Error('Ese enlace no es de ninguna web conocida (MoeWalls, WallpaperWaifu, DesktopHut, MotionBGs)')
  const key = `post:${post}`; const c = cacheGet(key); if (c) return c.value
  const d = await src.resolve(post)
  const value = { src: src.id, srcName: src.name, post, ...d, title: d.title || 'Sin título' }
  if (value.preview || value.original) cacheSet(key, value, 24 * 3600e3)
  return value
}
