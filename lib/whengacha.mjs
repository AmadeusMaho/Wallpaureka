/*
 * Perfil opcional «WhenGacha»: lo mismo que hacía app/scripts/fondos/ (ver src/skins/README.md, "Fondos en R2").
 *  - Publicar: mp4 al bucket R2 `whengacha-fondos` con wrangler (sesión de `npx wrangler login`), póster a public/skins/<skin>/,
 *    copia en ../fondos-skins/r2/<skin>/, nombre en FONDOS de src/skins/skins.ts y crédito en public/acerca.html.
 *  - Quitar, ordenar, compilar (npm run build:prod) y subir (git add + commit + push).
 * Solo se activa si en Ajustes hay una carpeta «app» de WhenGacha con src/skins/skins.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from './media.mjs'

export const SKIN_NAMES = { wuwa: 'Wuthering Waves', genshin: 'Genshin Impact', zzz: 'Zenless Zone Zero', hsr: 'Honkai: Star Rail', nikke: 'NIKKE', uma: 'Umamusume', arknights: 'Arknights' }
const BUCKET = 'whengacha-fondos'
export const slugOk = s => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 60
const skinOk = s => Object.hasOwn(SKIN_NAMES, s)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const q = s => `"${String(s).replace(/"/g, '\\"')}"`

/** Nombre de archivo para WhenGacha: sin "live wallpaper" ni el nombre del juego ("texas-x-exusiai-arknights" → "texas-x-exusiai"). */
export function wgSlug(s) {
  return String(s || '').toLowerCase()
    .replace(/-(wuthering-waves|genshin-impact|honkai-?star-?rail|zenless-zone-zero|uma-?musume|umamusume|nikke).*$/, '')
    .replace(/(^|-)arknights(-?endfield)?(?=-|$)/g, '')
    .replace(/(^|-)live-wallpaper(?=-|$)/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}
/** Título para los créditos, sin el nombre del juego. */
export function wgTitle(t) {
  return String(t || '').replace(/\s*Live Wallpaper$/i, '')
    .replace(/\s*\b(Wuthering Waves|Genshin Impact|Honkai:? ?Star ?Rail|Zenless Zone Zero|Uma ?Musume:? ?(Pretty Derby)?|Umamusume|Goddess of Victory:? ?Nikke|Nikke|Arknights:? ?(Endfield)?)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ').trim() || t
}

export function whengacha(root) {
  const ROOT = path.resolve(root)
  const SKINS_TS = path.join(ROOT, 'src/skins/skins.ts')
  const ACERCA = path.join(ROOT, 'public/acerca.html')
  const PUBLIC_SKINS = path.join(ROOT, 'public/skins')
  const BACKUP = path.resolve(ROOT, '../fondos-skins')
  if (!fs.existsSync(SKINS_TS)) throw new Error(`No encuentro src/skins/skins.ts en ${ROOT}`)

  function readSkinsTs() {
    const src = fs.readFileSync(SKINS_TS, 'utf8')
    const m = src.match(/(\/\/ <fondos>[^\n]*\n)([\s\S]*?)(\/\/ <\/fondos>)/)
    if (!m) throw new Error('No encuentro el bloque // <fondos> … // </fondos> en src/skins/skins.ts')
    const body = m[2].replace(/^export const FONDOS[^=]*=\s*/, '').trim()
    const json = body.replace(/'/g, '"').replace(/([{,\s])(\w+):/g, '$1"$2":').replace(/,(\s*[\]}])/g, '$1')
    const cdn = (src.match(/LIVE_CDN = '([^']+)'/) || [])[1] || ''
    return { src, match: m, fondos: JSON.parse(json), cdn }
  }
  function fmtList(names) {
    if (!names.length) return '[]'
    const lines = []; let line = '   '
    for (const n of names) { const t = ` '${n}',`; if (line.length + t.length > 140) { lines.push(line); line = '   ' } line += t }
    lines.push(line.replace(/,$/, ''))
    return `[\n${lines.join('\n')}\n  ]`
  }
  function writeFondos(fondos) {
    const { src, match } = readSkinsTs()
    const order = Object.keys(SKIN_NAMES).filter(k => k in fondos).concat(Object.keys(fondos).filter(k => !(k in SKIN_NAMES)))
    const body = `export const FONDOS: Record<string, string[]> = {\n${order.map(k => `  ${k}: ${fmtList(fondos[k])},\n`).join('')}}\n`
    fs.writeFileSync(SKINS_TS, src.replace(match[0], match[1] + body + match[3]))
  }

  // ---------- acerca.html: créditos ----------
  const T = d => Object.entries(d).map(([k, v]) => `<span class="t" lang="${k === 'zh' ? 'zh-CN' : k}">${v}</span>`).join('')
  const siteName = link => { try { const h = new URL(link).hostname.replace(/^www\./, ''); return h === 'steamcommunity.com' ? 'Steam Workshop' : h } catch { return '' } }
  function creditLi(skin, slug, c) {
    const title = `<strong>${esc(c.title || slug)}</strong>`
    let parts
    if (c.author) {
      const who = c.link ? `<a href="${esc(c.link)}" rel="nofollow noopener">${esc(c.author)}</a>` : esc(c.author)
      const site = c.link ? ` (${esc(siteName(c.link))})` : ''
      parts = { es: `animación: ${who}${site}`, en: `animation: ${who}${site}`, zh: `动态制作: ${who}${site}` }
    } else {
      const via = c.link ? ` (<a href="${esc(c.link)}" rel="nofollow noopener">${esc(siteName(c.link))}</a>)` : ''
      parts = { es: `autor no indicado${via}`, en: `author not stated${via}`, zh: `未注明作者${via}` }
    }
    if (c.note) for (const k in parts) parts[k] += ` · ${esc(c.note)}`
    return `<li data-fondo="${skin}/${slug}">${title} — ${T(parts)}</li>`
  }
  function readCredits() {
    const html = fs.readFileSync(ACERCA, 'utf8'); const out = {}
    for (const m of html.matchAll(/<li data-fondo="([^"]+)">([\s\S]*?)<\/li>/g)) {
      const es = (m[2].match(/<span class="t" lang="es">([\s\S]*?)<\/span>/) || [])[1] || ''
      out[m[1]] = (m[2].match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] + ' — ' + es.replace(/<[^>]+>/g, '')
    }
    return out
  }
  function addCredit(skin, slug, c) {
    const html = fs.readFileSync(ACERCA, 'utf8')
    const a = html.indexOf('<section class="credits">'); if (a < 0) throw new Error('No encuentro la sección de créditos en acerca.html')
    const end = html.indexOf('</section>', a)
    let sec = html.slice(a, end)
    sec = sec.replace(new RegExp(`<li data-fondo="${skin}/${slug}">[\\s\\S]*?</li>\\n?`), '')
    if (sec.indexOf(`<h3 data-skin="${skin}">`) < 0) sec += `<h3 data-skin="${skin}">${esc(SKIN_NAMES[skin])}</h3><ul>\n</ul>\n`
    const h2 = sec.indexOf(`<h3 data-skin="${skin}">`); const close = sec.indexOf('</ul>', h2)
    sec = sec.slice(0, close) + creditLi(skin, slug, c) + '\n' + sec.slice(close)
    fs.writeFileSync(ACERCA, html.slice(0, a) + sec + html.slice(end))
  }
  function removeCredit(skin, slug) {
    let html = fs.readFileSync(ACERCA, 'utf8')
    html = html.replace(new RegExp(`<li data-fondo="${skin}/${slug}">[\\s\\S]*?</li>\\n?`), '')
    html = html.replace(new RegExp(`<h3 data-skin="${skin}">[^<]*</h3><ul>\\s*</ul>\\n?`), '')
    fs.writeFileSync(ACERCA, html)
  }

  const wrangler = (args, log) => run(`npx wrangler ${args}`, [], { cwd: ROOT, shell: true, log, onErr: log })
  function gitPending() {
    try {
      const out = execFileSync('git', ['status', '--porcelain', '--', 'src/skins/skins.ts', 'public/acerca.html', 'public/skins', 'dist'], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
      return out.split('\n').filter(Boolean).length
    } catch { return null }
  }

  return {
    root: ROOT,
    posterFile: rel => { const r = path.resolve(PUBLIC_SKINS, rel); return r.startsWith(PUBLIC_SKINS + path.sep) ? r : null },
    state() {
      const { fondos, cdn } = readSkinsTs(); const credits = readCredits()
      return {
        root: ROOT, cdn, pending: gitPending(),
        skins: Object.entries(SKIN_NAMES).map(([id, name]) => ({
          id, name,
          fondos: (fondos[id] || []).map(n => ({
            name: n, poster: `/wg/poster/${id}/live-${n}.webp`, video: `${cdn}/${id}/live-${n}.mp4`,
            credit: credits[`${id}/${n}`] || (id === 'nikke' ? 'oficial (nikke-en.com)' : null),
          })),
        })),
      }
    },
    has(skin, slug) { return (readSkinsTs().fondos[skin] || []).includes(slug) },
    /** mp4 y webp ya convertidos → R2, public/, copia, skins.ts y créditos. */
    async publish({ skin, slug, mp4, webp, credit, official }, step) {
      if (!skinOk(skin)) throw new Error('Skin desconocida')
      if (!slugOk(slug)) throw new Error('El nombre solo puede llevar minúsculas, números y guiones (p. ej. special-week-verano)')
      const { fondos } = readSkinsTs()
      if ((fondos[skin] || []).includes(slug)) throw new Error(`Ya hay un fondo «${slug}» en ${SKIN_NAMES[skin]}. Usa otro nombre (los vídeos se guardan un año en caché).`)
      step(.05, `Subiendo ${skin}/live-${slug}.mp4 a R2…`)
      const errs = []
      const code = await wrangler(`r2 object put ${q(`${BUCKET}/${skin}/live-${slug}.mp4`)} --file ${q(mp4)} --content-type video/mp4 --cache-control ${q('public, max-age=31536000, immutable')} --remote`,
        l => { if (/error|✘|not logged|login/i.test(l)) errs.push(l) })
      if (code !== 0) throw new Error(`No se pudo subir a R2. ¿Sesión de wrangler iniciada? Ejecuta «npx wrangler login» en la carpeta app.${errs[0] ? ` (${errs[0]})` : ''}`)
      step(.6, 'Subido. Comprobando que R2 lo sirve…')
      const { cdn } = readSkinsTs()
      const head = await fetch(`${cdn}/${skin}/live-${slug}.mp4`, { method: 'HEAD' }).catch(() => null)
      if (!head?.ok) step(.65, 'Aviso: R2 aún no responde con el vídeo (a veces tarda unos segundos).')
      fs.mkdirSync(path.join(PUBLIC_SKINS, skin), { recursive: true })
      fs.copyFileSync(webp, path.join(PUBLIC_SKINS, skin, `live-${slug}.webp`))
      fs.mkdirSync(path.join(BACKUP, 'r2', skin), { recursive: true })
      fs.copyFileSync(mp4, path.join(BACKUP, 'r2', skin, `live-${slug}.mp4`)); fs.copyFileSync(webp, path.join(BACKUP, 'r2', skin, `live-${slug}.webp`))
      const f2 = readSkinsTs().fondos; f2[skin] = [...(f2[skin] || []), slug]; writeFondos(f2)
      if (credit && !official) addCredit(skin, slug, credit)
      return `Publicado «${slug}» en ${SKIN_NAMES[skin]}. Falta «Subir a la web» para que se vea.`
    },
    async remove({ skin, slug, deleteR2 }) {
      if (!skinOk(skin) || !slugOk(slug)) throw new Error('Fondo desconocido')
      const { fondos } = readSkinsTs()
      fondos[skin] = (fondos[skin] || []).filter(n => n !== slug); writeFondos(fondos)
      removeCredit(skin, slug)
      const poster = path.join(PUBLIC_SKINS, skin, `live-${slug}.webp`)
      if (fs.existsSync(poster)) { fs.mkdirSync(path.join(BACKUP, 'antiguos', skin), { recursive: true }); fs.renameSync(poster, path.join(BACKUP, 'antiguos', skin, `live-${slug}.webp`)) }
      let msg = `Quitado «${slug}» de ${SKIN_NAMES[skin]} (el póster va a fondos-skins/antiguos/).`
      if (deleteR2) {
        const code = await wrangler(`r2 object delete ${q(`${BUCKET}/${skin}/live-${slug}.mp4`)} --remote`, () => {})
        msg += code === 0 ? ' Borrado también de R2.' : ' No se pudo borrar de R2 (se puede borrar desde el panel de Cloudflare).'
      }
      return msg
    },
    move({ skin, slug, dir }) {
      const { fondos } = readSkinsTs(); const l = fondos[skin] || []
      const i = l.indexOf(slug), j = i + (dir < 0 ? -1 : 1)
      if (i < 0 || j < 0 || j >= l.length) return
      ;[l[i], l[j]] = [l[j], l[i]]; writeFondos(fondos)
    },
    async build(step) {
      step(.05, 'Compilando (npm run build:prod)…')
      const errs = []
      const code = await run('npm run build:prod', [], { cwd: ROOT, shell: true, log: l => { if (/error/i.test(l)) errs.push(l.replace(/\x1b\[[0-9;]*m/g, '')) }, onErr: l => { if (/error/i.test(l)) errs.push(l.replace(/\x1b\[[0-9;]*m/g, '')) } })
      if (code !== 0) throw new Error(`La compilación falló${errs[0] ? `: ${errs[0]}` : ''}`)
      return 'Compilado. dist/ está al día.'
    },
    async push(message, step) {
      const msg = String(message || '').trim() || 'Fondos de las skins: cambios desde la app de fondos'
      step(.1, 'Compilando antes de subir…')
      if (await run('npm run build:prod', [], { cwd: ROOT, shell: true }) !== 0) throw new Error('La compilación falló: no se sube nada.')
      step(.5, 'Guardando el commit…')
      await run('git', ['add', '-A', '--', 'src/skins/skins.ts', 'public/acerca.html', 'public/skins', 'dist', 'server/bundle'], { cwd: ROOT })
      const c = await run('git', ['commit', '-m', `${msg}\n\nHecho con la app de fondos (Wallpaureka!, perfil WhenGacha).`], { cwd: ROOT })
      if (c !== 0) step(.6, 'No había nada nuevo que guardar (o el commit falló).')
      step(.75, 'Subiendo a GitHub (git push)…')
      const out = []
      if (await run('git', ['push'], { cwd: ROOT, log: l => out.push(l), onErr: l => out.push(l) }) !== 0) throw new Error(`git push falló: ${out.slice(-2).join(' ')}`)
      return 'Subido. Botkeep lo despliega en unos minutos.'
    },
  }
}
