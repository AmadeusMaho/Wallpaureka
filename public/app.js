/* Wallpaureka!: interfaz. Buscar → previsualizar → elegir → descargar o publicar; la cola muestra el progreso. */
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin almacenamiento */ } } }
const api = async (url, body) => {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({ error: `Respuesta no válida (${r.status})` }))
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`)
  return j
}
function toast(text, cls = '', ms = 5000) {
  const d = document.createElement('div'); d.className = `toast ${cls}`; d.textContent = text
  $('#toasts').append(d); setTimeout(() => d.remove(), ms)
}

let INFO = null, view = store.get('fl:view', 'buscar')

// ---------- navegación ----------
function setView(v) {
  if (v === 'wg' && !INFO?.whengacha.enabled) v = 'buscar'
  view = v; store.set('fl:view', v)
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v))
  $$('.view').forEach(s => s.hidden = s.id !== `v-${v}`)
  if (v === 'we' && !WE.loaded) loadWe()
  if (v === 'wg') loadWg()
  if (v === 'ajustes') renderSettings()
  // La última búsqueda se repite (desde la caché) al volver a «Buscar».
  if (v === 'buscar' && !S.q && INFO) { const lq = store.get('fl:lastQ', ''); if (lq && !$('#q').value) { $('#q').value = lq; go(false) } }
  updSel()
}
$$('#nav button').forEach(b => b.onclick = () => setView(b.dataset.v))
$('#btnQueue').onclick = () => $('#queue').classList.toggle('open')
$('#qClose').onclick = () => $('#queue').classList.remove('open')

// ---------- utilidades de fondos ----------
const pxOf = r => { const [w, h] = String(r || '0x0').split('x').map(Number); return { w: w || 0, h: h || 0, px: (w || 0) * (h || 0), ratio: h ? w / h : 0 } }
const ultra = x => pxOf(x.res).ratio > 1.9
function warnOf(x) {
  const { w, h, ratio } = pxOf(x.res), o = []
  if (!w) return ''
  if (h > w) o.push('vertical (móvil)')
  else if (w < 1920) o.push('baja resolución')
  if (ratio > 1.9) o.push('ultrapanorámico')
  else if (ratio && ratio < 1.7 && w > h) o.push('no es 16:9')
  return o.join(' · ')
}
const keyOf = x => x.src === 'we' ? `we:${x.id}` : x.post
const DETAILS = new Map() // post → promesa de la ficha
function details(x) {
  if (x.src === 'we' || x.src === 'url' || x.src === 'file') return Promise.resolve(x)
  if (!DETAILS.has(x.post)) DETAILS.set(x.post, api(`/api/item?post=${encodeURIComponent(x.post)}`).catch(e => { DETAILS.delete(x.post); throw e }))
  return DETAILS.get(x.post)
}
const media = (u, ref) => !u ? null : u.startsWith('/') ? u : `/media?u=${encodeURIComponent(u)}${ref ? `&r=${encodeURIComponent(ref)}` : ''}`
async function previewSrc(x) {
  if (x.src === 'we') return x.preview
  if (x.src === 'url') return media(x.post) || x.post
  const d = await details(x); return media(d.preview || d.original?.url, d.referer)
}

/** Tarjeta de un fondo (búsqueda y Wallpaper Engine). */
function tile(x, { sel, onToggle, extra = '' }) {
  const c = document.createElement('div')
  const selectable = x.src !== 'we' || x.isVideo
  c.className = 'card tile' + (sel.has(keyOf(x)) ? ' sel' : '') + (selectable ? '' : ' dim') + (QUEUED.has(keyOf(x)) ? ' done' : '')
  c.innerHTML = `<div class="thumb">${x.thumb ? `<img class="ph" loading="lazy" referrerpolicy="no-referrer" alt="">` : ''}<span class="badge"></span>${selectable ? '<span class="tick" title="Elegir"></span>' : ''}<button type="button" class="big" title="Ver en grande y opciones">⤢</button></div>
    <div class="body"><div class="name"></div><div class="meta"></div></div>`
  if (x.thumb) c.querySelector('img').src = x.thumb
  c.querySelector('.badge').textContent = x.src === 'we' ? (x.isVideo ? 'Vídeo' : x.typeName) : `${x.srcName || ''} · ${x.n || ''}`
  c.querySelector('.name').textContent = x.title
  const w = warnOf(x)
  c.querySelector('.meta').innerHTML = x.src === 'we'
    ? `${x.isVideo ? `<span>${esc(x.sizeText)}</span>` : '<span class="bad">no es vídeo: no se puede descargar</span>'}<span>${esc((x.tags || []).slice(0, 3).join(', '))}</span>`
    : `<span>${esc(x.res || 'resolución ¿?')}</span>${x.votes ? `<span>♥ ${x.votes}</span>` : ''}${w ? `<span class="w">${esc(w)}</span>` : ''}${extra}`
  const th = c.querySelector('.thumb')
  let hovering = false
  c.addEventListener('mouseenter', async () => {
    hovering = true
    if (th.querySelector('video') || (x.src === 'we' && !x.isVideo)) return
    const l = document.createElement('span'); l.className = 'loading'; l.textContent = 'cargando…'; th.append(l)
    let src = null; try { src = await previewSrc(x) } catch { /* sin vista previa */ }
    l.remove(); if (!src || !hovering || th.querySelector('video')) return
    const v = document.createElement('video'); Object.assign(v, { src, muted: true, loop: true, autoplay: true, playsInline: true })
    v.oncanplay = () => v.classList.add('ready'); th.append(v)
  })
  c.addEventListener('mouseleave', () => { hovering = false; th.querySelector('video')?.remove() })
  c.onclick = e => {
    if (e.target.closest('.big')) return openItem(x)
    if (!selectable) return toast('Este wallpaper no es un vídeo (es una escena o una web de Wallpaper Engine): no se puede descargar como .mp4.', 'e')
    onToggle(x, c)
  }
  return c
}

// ---------- BUSCAR ----------
const S = { q: '', items: [], per: {}, sel: new Set() }
const QUEUED = new Set()
const selKey = () => `fl:sel:${S.q.toLowerCase()}`
function renderChips() {
  const on = new Set(store.get('fl:sources', INFO.sources.map(s => s.id)))
  $('#srcChips').innerHTML = ''
  for (const s of INFO.sources) {
    const p = S.per[s.id]
    const l = document.createElement('label'); l.className = 'chip' + (p?.error ? ' err' : '')
    l.title = p?.error ? `Error: ${p.error}` : `Buscar en ${s.home}`
    l.innerHTML = `<input type="checkbox" ${on.has(s.id) ? 'checked' : ''}> ${esc(s.name)} ${p ? `<b>${p.error ? '⚠' : p.count}${p.truncated ? '+' : ''}</b>` : ''}`
    l.querySelector('input').onchange = e => { e.target.checked ? on.add(s.id) : on.delete(s.id); store.set('fl:sources', [...on]) }
    $('#srcChips').append(l)
  }
  $('#sSrc').innerHTML = '<option value="">Todas las webs</option>' + INFO.sources.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
}
const looksLink = s => /^https?:\/\//i.test(s) || /^\d{6,}$/.test(s)
$('#fSearch').onsubmit = e => { e.preventDefault(); go(false) }
async function go(fresh) {
  const q = $('#q').value.trim(); if (!q) return toast('Escribe qué buscar o pega un enlace', 'e')
  if (looksLink(q)) return openLink(q)
  const sources = store.get('fl:sources', INFO.sources.map(s => s.id))
  if (!sources.length) return toast('Marca al menos una web donde buscar', 'e')
  $('#btnSearch').disabled = true
  const st = $('#sStatus'); st.hidden = false; st.querySelector('i').style.width = '0'; st.querySelector('span').textContent = 'Buscando…'
  $('#sNotes').textContent = ''
  let last = null
  try {
    const r = await fetch('/api/search', { method: 'POST', body: JSON.stringify({ q, sources, fresh }) })
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = ''
    for (;;) {
      const { value, done } = await rd.read(); if (done) break
      buf += dec.decode(value, { stream: true }); let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue
        const m = JSON.parse(line); last = m
        if (m.progress != null) st.querySelector('i').style.width = `${Math.round(m.progress * 100)}%`
        if (m.text) st.querySelector('span').textContent = m.text
      }
    }
  } catch (e) { last = { error: e.message } }
  $('#btnSearch').disabled = false
  if (!last?.done) { st.querySelector('span').textContent = ''; st.hidden = true; return toast(last?.error || 'La búsqueda falló', 'e') }
  Object.assign(S, { q: last.q, items: last.items, per: last.per })
  store.set('fl:lastQ', last.q)
  S.sel = new Set(store.get(selKey(), []).filter(k => S.items.some(x => keyOf(x) === k)))
  const errs = Object.entries(last.per).filter(([, p]) => p.error).map(([id, p]) => `${INFO.sources.find(s => s.id === id).name}: ${p.error}`)
  const trunc = Object.entries(last.per).filter(([, p]) => p.truncated).map(([id]) => INFO.sources.find(s => s.id === id).name)
  $('#sNotes').textContent = [errs.length ? `No se pudo leer ${errs.join(' · ')}` : '', trunc.length ? `${trunc.join(', ')}: hay más páginas de las que se leen (25); afina la búsqueda.` : ''].filter(Boolean).join(' — ')
  st.querySelector('span').textContent = `${last.items.length} fondos para «${last.q}» en ${Object.keys(last.per).length} webs`
  st.querySelector('i').style.width = '100%'
  renderChips(); renderSearch()
}
;['#sFilter', '#sSrc', '#sSort', '#sHideLow', '#sOnlySel'].forEach(s => $(s).addEventListener('input', renderSearch))
function renderSearch() {
  const g = $('#sGrid'); g.innerHTML = ''
  $('#sTools').hidden = !S.items.length
  if (!S.q) {
    g.innerHTML = `<div class="empty"><h3>Busca un fondo animado</h3>Se buscan en MoeWalls, WallpaperWaifu, DesktopHut y MotionBGs a la vez (página a página, sin saturar las webs).
      <div class="chips" style="margin-top:12px">${['arknights', 'genshin impact', 'lofi', 'cyberpunk', 'wuthering waves'].map(t => `<span class="chip" data-q="${t}">${t}</span>`).join('')}</div>
      <div class="steps"><span><b>1</b> Busca o pega un enlace</span><span><b>2</b> Pasa el ratón: se ve el vídeo · ⤢ en grande</span><span><b>3</b> Clic para elegir</span><span><b>4</b> Descargar o publicar</span></div></div>`
    g.querySelectorAll('[data-q]').forEach(c => c.onclick = () => { $('#q').value = c.dataset.q; go(false) })
    return updSel()
  }
  if (!S.items.length) { g.innerHTML = `<div class="empty"><h3>Sin resultados para «${esc(S.q)}»</h3>Prueba en inglés, con menos palabras o marca más webs arriba.</div>`; return updSel() }
  const f = $('#sFilter').value.trim().toLowerCase(), src = $('#sSrc').value, by = $('#sSort').value
  let list = S.items.filter(x => (!f || x.title.toLowerCase().includes(f)) && (!src || x.src === src) && (!$('#sOnlySel').checked || S.sel.has(keyOf(x)))
    && (!$('#sHideLow').checked || (pxOf(x.res).w >= 1920 && pxOf(x.res).w > pxOf(x.res).h)))
  if (by === 'votes') list = [...list].sort((a, b) => b.votes - a.votes)
  if (by === 'res') list = [...list].sort((a, b) => pxOf(b.res).px - pxOf(a.res).px)
  if (by === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title))
  $('#sCount').textContent = list.length === S.items.length ? `${S.items.length} fondos` : `se ven ${list.length} de ${S.items.length}`
  if (!list.length) g.innerHTML = '<div class="empty">Nada coincide con los filtros.</div>'
  for (const x of list) g.append(tile(x, { sel: S.sel, onToggle: toggleSearch }))
  updSel()
}
function toggleSearch(x, c) {
  const k = keyOf(x); S.sel.has(k) ? S.sel.delete(k) : S.sel.add(k); store.set(selKey(), [...S.sel])
  c.classList.toggle('sel', S.sel.has(k)); updSel(); if ($('#sOnlySel').checked) renderSearch()
}

// ---------- enlace pegado ----------
async function openLink(url) {
  $('#btnSearch').disabled = true; toast('Leyendo el enlace…')
  try {
    const r = await api('/api/link', { url })
    if (r.kind === 'we') { setView('we'); $('#wLink').value = url; showWorkshop(r.item) }
    else openItem(r.item)
  } catch (e) { toast(e.message, 'e', 8000) }
  $('#btnSearch').disabled = false
}
$('#pickLocal').onclick = e => { e.preventDefault(); $('#localFile').click() }
$('#localFile').onchange = async () => {
  const f = $('#localFile').files[0]; if (!f) return
  toast(`Cargando ${f.name}…`)
  try {
    const r = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }); const j = await r.json()
    if (!j.upload) throw new Error(j.error || 'No se pudo leer el archivo')
    openItem({ src: 'file', upload: j.upload, post: `archivo:${f.name}`, srcName: 'Tu PC', title: f.name.replace(/\.\w+$/, ''), preview: `/work/${j.upload}`, original: { url: '' } })
  } catch (e) { toast(e.message, 'e') }
  $('#localFile').value = ''
}

// ---------- ficha (⤢) ----------
async function openItem(x) {
  const d = $('#dItem'); $('#iTitle').textContent = x.title; $('#iMeta').innerHTML = '<dt>…</dt><dd>leyendo la ficha</dd>'; $('#iActs').innerHTML = ''
  $('#iProblem').hidden = true; $('#iNoVideo').hidden = true; const v = $('#iVideo'); v.hidden = false; v.removeAttribute('src')
  if (!d.open) d.showModal()
  let det
  try { det = await details(x) } catch (e) { $('#iMeta').innerHTML = ''; $('#iProblem').hidden = false; $('#iProblem').textContent = e.message; return }
  const it = { ...x, ...det, res: det.res || x.res, n: x.n }
  $('#iTitle').textContent = it.title
  const src = x.src === 'we' ? it.preview : x.src === 'file' ? it.preview : media(it.preview || it.original?.url, it.referer) || (x.src === 'url' ? x.post : null)
  if (src) v.src = src; else { v.hidden = true; $('#iNoVideo').hidden = false; $('#iNoVideo').textContent = it.problem || 'Sin vista previa.' }
  const rows = [
    ['Web', it.srcName || (it.src === 'we' ? 'Wallpaper Engine' : '')],
    ['Resolución', it.res ? `${it.res}${warnOf(it) ? ` (${warnOf(it)})` : ''}` : ''],
    ['Original', it.original?.url ? `${it.original.res || 'sí'}${it.original.sizeText ? ` · ${it.original.sizeText}` : ''}` : it.src === 'we' ? (it.isVideo ? `${it.file} · ${it.sizeText}` : '') : 'no disponible: se descarga la vista previa'],
    ['Autor', it.author || ''], ['Nota', it.note || ''], ['Tipo', it.src === 'we' ? it.typeName : ''],
  ].filter(r => r[1])
  $('#iMeta').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')
    + (it.post && /^https?:/.test(it.post) ? `<dt>Enlace</dt><dd><a href="${esc(it.post)}" target="_blank" rel="noopener">abrir la página ↗</a></dd>` : '')
    + (it.source && it.source !== it.post ? `<dt>Origen</dt><dd><a href="${esc(it.source)}" target="_blank" rel="noopener">${esc(new URL(it.source).hostname)} ↗</a></dd>` : '')
  if (it.originalNote) { $('#iProblem').hidden = false; $('#iProblem').textContent = it.originalNote }
  if (it.problem) { $('#iProblem').hidden = false; $('#iProblem').textContent = it.problem }
  const acts = $('#iActs'), can = it.src !== 'we' || it.isVideo
  const btn = (t, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; if (cls) b.className = cls; b.onclick = fn; acts.append(b); return b }
  if (can) {
    btn('Descargar…', 'primary', () => { d.close(); askDownload([it]) })
    if (INFO.whengacha.enabled) btn('Añadir a WhenGacha…', '', () => { d.close(); askWg([it]) })
    const sel = view === 'we' ? WE.sel : S.sel
    if ((view === 'buscar' && S.items.some(y => keyOf(y) === keyOf(x))) || (view === 'we' && it.src === 'we')) {
      const b = btn(sel.has(keyOf(x)) ? 'Quitar de elegidos' : 'Elegir', '', () => {
        sel.has(keyOf(x)) ? sel.delete(keyOf(x)) : sel.add(keyOf(x)); b.textContent = sel.has(keyOf(x)) ? 'Quitar de elegidos' : 'Elegir'
        if (view === 'we') { store.set('fl:wesel', [...WE.sel]); renderWe() } else { store.set(selKey(), [...S.sel]); renderSearch() }
      })
    }
  }
  if (it.src === 'we') btn('Abrir en Steam', '', () => location.href = it.steamUrl || `steam://url/CommunityFilePage/${it.id}`)
}
$('#dItem').addEventListener('close', () => { const v = $('#iVideo'); v.pause(); v.removeAttribute('src'); v.load() })

// ---------- selección ----------
function curSel() {
  if (view === 'we') return { set: WE.sel, items: WE.items.filter(x => WE.sel.has(keyOf(x))), save: () => store.set('fl:wesel', [...WE.sel]), render: renderWe }
  if (view === 'buscar') return { set: S.sel, items: S.items.filter(x => S.sel.has(keyOf(x))), save: () => store.set(selKey(), [...S.sel]), render: renderSearch }
  return null
}
function updSel() {
  const s = curSel(); const n = s?.items.length || 0
  $('#selbar').hidden = !n
  if (!n) return
  $('#selTxt').innerHTML = `<b>${n}</b> elegido${n > 1 ? 's' : ''}${s.items.some(ultra) ? ` · ${s.items.filter(ultra).length} ultrapanorámico(s)` : ''}`
  $('#selWg').hidden = !INFO?.whengacha.enabled
}
$('#selClear').onclick = () => { const s = curSel(); s.set.clear(); s.save(); s.render() }
$('#selCopy').onclick = async () => {
  const txt = curSel().items.map((x, i) => `${i + 1}. ${x.title}${x.res ? ` (${x.res})` : ''} — ${x.post}`).join('\n')
  try { await navigator.clipboard.writeText(txt); toast('Lista copiada', 'ok') } catch { toast('No se pudo copiar al portapapeles', 'e') }
}
$('#selDl').onclick = () => askDownload(curSel().items)
$('#selWg').onclick = () => askWg(curSel().items)

// ---------- diálogo de descarga ----------
function seg(id, value) { $$(`${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === value)) }
$$('.seg button').forEach(b => b.addEventListener('click', () => seg('#' + b.parentElement.id, b.dataset.v)))
const segVal = id => $(`${id} button.on`)?.dataset.v
function ask(dlg) { return new Promise(res => { dlg.returnValue = ''; dlg.onclose = () => res(dlg.returnValue === 'ok' || dlg.returnValue === 'yes'); dlg.showModal() }) }
async function askDownload(items) {
  if (!items.length) return
  const n = items.length
  $('#dlN').textContent = n > 1 ? `${n} fondos` : `«${items[0].title}»`
  const prev = store.get('fl:dl', { what: 'original', fmt: 'none', audio: false })
  const onlyLocal = items.every(x => x.src === 'we' || x.src === 'url' || x.src === 'file')
  $$('#dlWhat button').forEach(b => b.disabled = onlyLocal && b.dataset.v === 'preview')
  seg('#dlWhat', onlyLocal ? 'original' : prev.what)
  const noOrig = items.filter(x => ['moewalls', 'wallpaperwaifu'].includes(x.src)).length
  $('#dlWhatHint').textContent = onlyLocal ? 'Se usa el archivo tal como está en el PC.' : noOrig ? `MoeWalls y WallpaperWaifu solo ofrecen la vista previa (${noOrig} de ${n}): para esos se usa la vista previa.` : 'DesktopHut y MotionBGs ofrecen el original en buena calidad.'
  $('#dlFmt').value = INFO.ffmpeg ? prev.fmt : 'none'; $('#dlFmt').disabled = !INFO.ffmpeg; $('#dlFfWarn').hidden = !!INFO.ffmpeg
  const nu = items.filter(ultra).length
  $('#dlCrop').checked = nu > 0; $('#dlCropN').textContent = nu ? `(${nu} de ${n})` : '(ninguno lo es)'
  $('#dlAudio').checked = prev.audio
  $('#dlDir').value = INFO.config.downloadDir
  const syncCrop = () => { const conv = $('#dlFmt').value !== 'none'; $('#dlCrop').disabled = !conv || !nu; $('#dlAudio').disabled = !conv }
  $('#dlFmt').onchange = syncCrop; syncCrop()
  if (!await ask($('#dDl'))) return
  const what = segVal('#dlWhat'), fmt = $('#dlFmt').value, dir = $('#dlDir').value.trim()
  store.set('fl:dl', { what, fmt, audio: $('#dlAudio').checked })
  const jobs = items.map(x => ({ kind: 'download', title: x.title, srcName: x.srcName || (x.src === 'we' ? 'Wallpaper Engine' : ''), item: slim(x), what, format: fmt,
    crop169: fmt !== 'none' && $('#dlCrop').checked && ultra(x), audio: $('#dlAudio').checked, dir }))
  await enqueue(jobs)
}
const slim = x => ({ src: x.src, id: x.id, post: x.post, title: x.title, thumb: x.thumb, res: x.res, upload: x.upload })
$('#dlPick').onclick = async () => { const r = await api('/api/pick-folder', { start: $('#dlDir').value }); if (r.path) $('#dlDir').value = r.path }

// ---------- diálogo WhenGacha ----------
async function askWg(items) {
  if (!items.length || !INFO.whengacha.enabled) return
  if (REPL && items.length > 1) return toast(`Para reemplazar «${REPL.slug}» elige un solo fondo (o cancela el reemplazo arriba).`, 'e', 7000)
  const n = items.length
  $('#wgN').textContent = n > 1 ? `(${n})` : ''
  const skins = INFO.whengacha.skins
  const q = (S.q || '').toLowerCase(), guess = skins.find(k => q.includes(k.id) || q.includes(k.name.toLowerCase()))?.id
  $('#wgSkin').innerHTML = skins.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join('')
  $('#wgSkin').value = REPL ? REPL.skin : guess || store.get('fl:wgskin', skins[0].id)
  $('#wgSkin').disabled = !!REPL
  $('#wgRepl').hidden = !REPL
  if (REPL) $('#wgRepl').textContent = `Reemplazará a «${REPL.slug}» en ${REPL.skinName}, en la misma posición. «${REPL.slug}» pasa a guardados (sigue en R2).`
  const hasOrig = items.some(x => ['desktophut', 'motionbgs', 'we', 'url', 'file'].includes(x.src))
  seg('#wgWhat', hasOrig && items.every(x => !['moewalls', 'wallpaperwaifu'].includes(x.src)) ? 'original' : 'preview')
  const nu = items.filter(ultra).length
  $('#wgCrop').checked = nu > 0; $('#wgCropN').textContent = nu ? `(${nu} de ${n})` : ''
  $('#wgSingle').hidden = n > 1
  if (n === 1) {
    const d = await details(items[0]).catch(() => items[0])
    $('#wgSlug').value = wgSlug(d.slug || d.title)
    $('#wgCTitle').value = wgTitle(d.title); $('#wgCAuthor').value = d.author || ''
    $('#wgCLink').value = d.author ? (d.source || d.post) : (d.source || d.post || ''); $('#wgCNote').value = d.note || ''
    $('#wgOfficial').checked = $('#wgSkin').value === 'nikke'
    $('#wgCredit').hidden = $('#wgOfficial').checked
  }
  if (!await ask($('#dWg'))) return
  const skin = $('#wgSkin').value; store.set('fl:wgskin', skin)
  const what = segVal('#wgWhat'), [width, crf] = what === 'original' ? [1920, 26] : [1280, 27]
  const jobs = items.map(x => {
    const j = { kind: 'whengacha', title: x.title, srcName: x.srcName || '', item: slim(x), skin, what, width, crf, crop169: $('#wgCrop').checked && ultra(x) }
    if (n === 1) {
      j.slug = $('#wgSlug').value.trim(); j.official = $('#wgOfficial').checked
      j.credit = { title: $('#wgCTitle').value.trim(), author: $('#wgCAuthor').value.trim(), link: $('#wgCLink').value.trim(), note: $('#wgCNote').value.trim() }
      if (REPL) j.replace = REPL.slug
    }
    return j
  })
  await enqueue(jobs)
  if (REPL) setReplace(null)
}
$('#wgOfficial').onchange = () => $('#wgCredit').hidden = $('#wgOfficial').checked
// Igual que lib/whengacha.mjs (para proponer el nombre en el diálogo).
const wgSlug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/-(wuthering-waves|genshin-impact|honkai-?star-?rail|zenless-zone-zero|uma-?musume|umamusume|nikke).*$/, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^|-)arknights(-?endfield)?(?=-|$)/g, '').replace(/(^|-)live-wallpaper(?=-|$)/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const wgTitle = t => String(t || '').replace(/\s*\b(Wuthering Waves|Genshin Impact|Honkai:? ?Star ?Rail|Zenless Zone Zero|Uma ?Musume:? ?(Pretty Derby)?|Umamusume|Goddess of Victory:? ?Nikke|Nikke|Arknights:? ?(Endfield)?)\b/gi, ' ').replace(/\s{2,}/g, ' ').trim() || t

// ---------- cola ----------
async function enqueue(jobs) {
  try {
    await api('/api/queue/add', { jobs })
    jobs.forEach(j => QUEUED.add(j.item ? keyOf(j.item) : ''))
    const s = curSel(); if (s) { jobs.forEach(j => j.item && s.set.delete(keyOf(j.item))); s.save(); s.render() }
    toast(`${jobs.length} ${jobs.length > 1 ? 'trabajos añadidos' : 'trabajo añadido'} a la cola`, 'ok')
    if (innerWidth <= 1100) $('#queue').classList.add('open')
    pollQueue()
  } catch (e) { toast(e.message, 'e') }
}
let qTimer = null, lastJobs = ''
const STATE = { cola: 'en cola', activo: 'en curso', listo: 'listo', error: 'error', cancelado: 'cancelado' }
async function pollQueue() {
  clearTimeout(qTimer)
  let q; try { q = await api('/api/queue') } catch { qTimer = setTimeout(pollQueue, 4000); return }
  const active = q.jobs.filter(j => j.status === 'cola' || j.status === 'activo').length
  $('#qCount').textContent = active || q.jobs.length; $('#btnQueue').classList.toggle('busy', active > 0)
  const sig = JSON.stringify(q.jobs.map(j => [j.id, j.status, Math.round(j.progress * 100), j.text]))
  if (sig !== lastJobs) {
    const was = JSON.parse(lastJobs || '[]'); lastJobs = sig
    for (const j of q.jobs) {
      const prev = was.find(w => w[0] === j.id)
      if (prev && prev[1] !== j.status && (j.status === 'listo' || j.status === 'error')) {
        toast(`${j.title}: ${j.text}`, j.status === 'listo' ? 'ok' : 'e', 7000)
        if (j.kind.startsWith('wg') || j.kind === 'whengacha') { if (view === 'wg') loadWg() }
      }
    }
    renderQueue(q.jobs)
  }
  qTimer = setTimeout(pollQueue, active ? 700 : 3000)
}
function renderQueue(list) {
  const el = $('#qList')
  if (!list.length) { el.innerHTML = '<div class="empty">La cola está vacía.<br>Lo que descargues o publiques aparece aquí con su progreso, uno detrás de otro.</div>'; return }
  const order = { activo: 0, cola: 1, error: 2, listo: 3, cancelado: 4 }
  el.innerHTML = ''
  for (const j of [...list].sort((a, b) => order[a.status] - order[b.status] || (a.status === 'cola' ? a.id - b.id : b.id - a.id))) {
    const d = document.createElement('div'); d.className = `job ${j.status}`
    const kind = { download: 'Descarga', whengacha: 'WhenGacha', 'wg-build': 'Compilar', 'wg-push': 'Subir a la web', 'wg-remove': 'Quitar', 'wg-activate': 'Reactivar' }[j.kind] || j.kind
    d.innerHTML = `<div class="jt"></div><div class="jn"></div><div class="muted" style="font-size:.78rem">${kind}${j.srcName ? ` · ${esc(j.srcName)}` : ''}<span class="state ${j.status}">${STATE[j.status]}</span></div>
      ${j.status === 'activo' ? `<div class="bar"><i style="width:${Math.round(j.progress * 100)}%"></i></div>` : ''}<div class="js"></div><div class="ja"></div>`
    if (j.thumb) d.querySelector('.jt').style.backgroundImage = `url("${j.thumb.replace(/"/g, '%22')}")`
    d.querySelector('.jn').textContent = j.title; d.querySelector('.js').textContent = j.text
    const a = d.querySelector('.ja'), b = (t, fn, cls = 'small') => { const x = document.createElement('button'); x.className = cls; x.textContent = t; x.onclick = fn; a.append(x) }
    if (j.status === 'cola' || j.status === 'activo') b('Cancelar', () => api('/api/queue/cancel', { id: j.id }).then(pollQueue))
    if (j.status === 'error' || j.status === 'cancelado') b('Reintentar', () => api('/api/queue/retry', { id: j.id }).then(pollQueue))
    if (j.status === 'listo' && j.result?.file) b('Mostrar en la carpeta', () => api('/api/open', { job: j.id }))
    if (j.status === 'listo' && (j.kind === 'whengacha' || j.kind === 'wg-activate')) b('Ver en WhenGacha', () => { setView('wg'); WG.skin = j.result?.skin || WG.skin; loadWg() })
    el.append(d)
  }
}
$('#qClear').onclick = () => api('/api/queue/clear', {}).then(() => { lastJobs = ''; pollQueue() })

// ---------- WALLPAPER ENGINE ----------
const WE = { items: [], sel: new Set(store.get('fl:wesel', [])), loaded: false }
async function loadWe(refresh) {
  $('#wGrid').innerHTML = '<div class="empty">Leyendo tus suscripciones de Wallpaper Engine…</div>'
  try {
    const r = await api(`/api/we/list${refresh ? '?refresh=1' : ''}`)
    WE.items = r.items.map(x => ({ ...x, srcName: 'Wallpaper Engine' })); WE.loaded = true; WE.steam = r.steam; WE.dirs = r.dirs
    WE.sel = new Set([...WE.sel].filter(k => WE.items.some(x => keyOf(x) === k && x.isVideo)))
    renderWe()
  } catch (e) { $('#wGrid').innerHTML = `<div class="empty"><h3>No se pudo leer la carpeta de Steam</h3>${esc(e.message)}</div>` }
}
$('#wRefresh').onclick = () => loadWe(true)
;['#wFilter', '#wType', '#wOnlySel'].forEach(s => $(s).addEventListener('input', renderWe))
function renderWe() {
  const g = $('#wGrid'); g.innerHTML = ''
  if (!WE.steam) { g.innerHTML = '<div class="empty"><h3>No encuentro Steam en este equipo</h3>Instala Steam y Wallpaper Engine, o pega un enlace del Workshop arriba para ver su ficha.</div>'; return updSel() }
  if (!WE.dirs.length || !WE.items.length) { g.innerHTML = '<div class="empty"><h3>No tienes suscripciones de Wallpaper Engine</h3>Suscríbete a un fondo en el Steam Workshop y, cuando Wallpaper Engine lo descargue, pulsa «↻ Releer».</div>'; return updSel() }
  const f = $('#wFilter').value.trim().toLowerCase(), t = $('#wType').value
  const list = WE.items.filter(x => (!t || (t === 'video' ? x.isVideo : x.type === t)) && (!f || x.title.toLowerCase().includes(f) || (x.tags || []).some(y => y.toLowerCase().includes(f))) && (!$('#wOnlySel').checked || WE.sel.has(keyOf(x))))
  const nv = WE.items.filter(x => x.isVideo).length
  $('#wCount').textContent = `${WE.items.length} suscripciones · ${nv} de vídeo${list.length !== WE.items.length ? ` · se ven ${list.length}` : ''}`
  if (!list.length) g.innerHTML = `<div class="empty">Nada coincide.${t === 'video' && !nv ? ' Ninguna suscripción es de vídeo (las escenas y webs no se pueden descargar).' : ''}</div>`
  for (const x of list) g.append(tile(x, { sel: WE.sel, onToggle: (x, c) => { const k = keyOf(x); WE.sel.has(k) ? WE.sel.delete(k) : WE.sel.add(k); store.set('fl:wesel', [...WE.sel]); c.classList.toggle('sel', WE.sel.has(k)); updSel() } }))
  updSel()
}
$('#fWorkshop').onsubmit = async e => {
  e.preventDefault(); const url = $('#wLink').value.trim(); if (!url) return
  $('#wResult').innerHTML = '<p class="sub">Consultando Steam…</p>'
  try { showWorkshop(await api('/api/we/workshop', { url })) } catch (err) { $('#wResult').innerHTML = `<p class="warnbox">${esc(err.message)}</p>` }
}
function showWorkshop(it) {
  const box = $('#wResult')
  box.innerHTML = `<div class="wecard"><img alt=""><div class="info"><h3></h3><div class="meta"></div><p class="okbox" hidden></p><p class="warnbox" hidden></p><div class="acts"></div></div></div>`
  const img = box.querySelector('img'); if (it.thumb) img.src = it.thumb; else img.remove()
  box.querySelector('h3').textContent = it.title
  box.querySelector('.meta').innerHTML = [it.author ? `de ${esc(it.author)}` : '', it.type ? `tipo: ${esc(it.typeName)}` : '', it.sizeText, it.subscribed ? '<span class="ok">en este PC</span>' : '<span class="w">no está en este PC</span>'].filter(Boolean).map(s => `<span>${s}</span>`).join('')
  if (it.problem) { const w = box.querySelector('.warnbox'); w.hidden = false; w.textContent = it.problem }
  else { const o = box.querySelector('.okbox'); o.hidden = false; o.textContent = `Listo para usar: ${it.file}` }
  const acts = box.querySelector('.acts')
  const b = (t, cls, fn) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = t; if (cls) x.className = cls; x.onclick = fn; acts.append(x) }
  if (it.isVideo) {
    const x = { ...it, srcName: 'Wallpaper Engine' }
    b('Descargar…', 'primary', () => askDownload([x]))
    if (INFO.whengacha.enabled) b('Añadir a WhenGacha…', '', () => askWg([x]))
    b('Ver en grande', '', () => openItem(x))
  }
  b('Abrir en Steam', it.subscribed ? '' : 'primary', () => { location.href = it.steamUrl })
  if (!it.subscribed) b('Comprobar de nuevo', '', async () => { try { showWorkshop(await api('/api/we/workshop', { url: it.post })); loadWe(true) } catch (e) { toast(e.message, 'e') } })
  const a = document.createElement('a'); a.href = it.post; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Ficha en la web ↗'; a.style.alignSelf = 'center'; acts.append(a)
}

// ---------- WHENGACHA ----------
const WG = { skin: store.get('fl:wgtab', 'wuwa'), state: null }
async function loadWg() {
  try { WG.state = await api('/api/wg/state') } catch (e) { $('#wgGrid').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
  renderWg()
}
function renderWg() {
  const s = WG.state; if (!s?.enabled) { $('#wgGrid').innerHTML = `<div class="empty">El perfil WhenGacha no está activo. ${esc(s?.error || '')}</div>`; return }
  $('#wgRoot').textContent = s.root
  $('#wgPending').textContent = s.pending == null ? 'git ¿?' : s.pending ? `${s.pending} cambios sin subir` : 'Todo subido'
  $('#wgPending').className = 'pill' + (s.pending ? ' warn' : '')
  $('#wgTabs').innerHTML = ''
  if (!s.skins.some(k => k.id === WG.skin)) WG.skin = s.skins[0].id
  for (const k of s.skins) {
    const b = document.createElement('button'); b.className = k.id === WG.skin ? 'on' : ''
    b.innerHTML = `${esc(k.name)}<b>${k.fondos.length}</b>`; b.onclick = () => { WG.skin = k.id; store.set('fl:wgtab', k.id); renderWg() }
    $('#wgTabs').append(b)
  }
  const k = s.skins.find(x => x.id === WG.skin)
  $('#wgHint').textContent = k.fondos.length ? 'Pasa el ratón para ver el vídeo. El orden es el de la rotación. Para añadir fondos: búscalos en «Buscar» o «Wallpaper Engine» y usa «Añadir a WhenGacha».' : ''
  const g = $('#wgGrid'); g.innerHTML = ''
  if (!k.fondos.length) g.innerHTML = '<div class="empty">Esta skin aún no tiene fondos animados. Búscalos en «Buscar» y elige «Añadir a WhenGacha».</div>'
  k.fondos.forEach((f, i) => {
    const c = document.createElement('div'); c.className = 'card'
    c.innerHTML = `<div class="thumb"><span class="badge">${i + 1}</span></div><div class="body"><div class="name"></div><div class="credit"></div></div>
      <div class="acts"><button title="Antes en la rotación" data-a="up" ${i ? '' : 'disabled'}>↑</button><button title="Después en la rotación" data-a="down" ${i < k.fondos.length - 1 ? '' : 'disabled'}>↓</button><span class="sp"></span><button data-a="repl" title="Cambiarlo por otro en la misma posición">Reemplazar</button><button class="danger" data-a="del">Quitar</button></div>`
    c.querySelector('.thumb').style.backgroundImage = `url("${f.poster}")`
    c.querySelector('.name').textContent = f.name
    const cr = c.querySelector('.credit'); cr.textContent = f.credit || 'sin crédito en «Acerca de»'; if (!f.credit) cr.classList.add('none')
    const th = c.querySelector('.thumb')
    c.addEventListener('mouseenter', () => { if (th.querySelector('video')) return; const v = document.createElement('video'); Object.assign(v, { src: f.video, muted: true, loop: true, autoplay: true, playsInline: true }); v.oncanplay = () => v.classList.add('ready'); th.append(v) })
    c.addEventListener('mouseleave', () => th.querySelector('video')?.remove())
    c.querySelector('[data-a=up]').onclick = () => wgMove(f.name, -1)
    c.querySelector('[data-a=down]').onclick = () => wgMove(f.name, 1)
    c.querySelector('[data-a=del]').onclick = () => wgDel(f.name, k.name)
    c.querySelector('[data-a=repl]').onclick = () => setReplace({ skin: k.id, slug: f.name, skinName: k.name })
    if (REPL && REPL.skin === k.id && REPL.slug === f.name) c.classList.add('repl')
    g.append(c)
  })
  // Guardados sin usar
  $('#wgInaTitle').textContent = `Guardados sin usar (${k.inactive.length})`
  const gi = $('#wgIna'); gi.innerHTML = ''
  if (!k.inactive.length) gi.innerHTML = '<div class="empty">No hay vídeos guardados fuera de la rotación para esta skin. Lo que quites aparecerá aquí.</div>'
  for (const f of k.inactive) {
    const c = document.createElement('div'); c.className = 'card ina'
    const here = REPL && REPL.skin === k.id
    c.innerHTML = `<div class="thumb"><span class="badge">guardado</span></div><div class="body"><div class="name"></div><div class="credit"></div></div>
      <div class="acts"><span class="sp"></span><button class="primary" data-a="on"></button></div>`
    if (f.poster) c.querySelector('.thumb').style.backgroundImage = `url("${f.poster}")`
    c.querySelector('.name').textContent = f.name
    const cr = c.querySelector('.credit'); cr.textContent = `${f.credit || 'crédito: se busca al activarlo'} · ${(f.size / 1048576).toFixed(1)} MB`
    const th = c.querySelector('.thumb')
    c.addEventListener('mouseenter', () => { if (th.querySelector('video')) return; const v = document.createElement('video'); Object.assign(v, { src: f.video, muted: true, loop: true, autoplay: true, playsInline: true }); v.oncanplay = () => v.classList.add('ready'); th.append(v) })
    c.addEventListener('mouseleave', () => th.querySelector('video')?.remove())
    const b = c.querySelector('[data-a=on]')
    b.textContent = here ? `Poner en lugar de «${REPL.slug}»` : 'Activar'
    b.title = here ? 'Ocupa la misma posición; el reemplazado pasa a guardados' : 'Lo añade al final de la rotación'
    b.onclick = () => {
      enqueue([{ kind: 'wg-activate', title: `${here ? 'Reemplazar' : 'Activar'} ${f.name}`, srcName: k.name, thumb: f.poster, skin: k.id, slug: f.name, replace: here ? REPL.slug : undefined }])
      if (here) setReplace(null)
    }
    gi.append(c)
  }
}

// ---------- reemplazar ----------
let REPL = null
function setReplace(r) {
  REPL = r
  $('#replBar').hidden = !r
  if (r) {
    $('#replTxt').innerHTML = `Reemplazando <b>${esc(r.slug)}</b> en ${esc(r.skinName)}: elige uno de «Guardados sin usar» o busca uno nuevo en «Buscar» o «Wallpaper Engine» y pulsa «Añadir a WhenGacha».`
    if (view === 'wg') $('#wgIna').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  if (view === 'wg' && WG.state) renderWg()
}
$('#replCancel').onclick = () => setReplace(null)
$('#replGo').onclick = () => { if (REPL) { WG.skin = REPL.skin; setView('wg'); setTimeout(() => $('#wgIna').scrollIntoView({ behavior: 'smooth' }), 300) } }
async function wgMove(slug, dir) { try { WG.state = await api('/api/wg/move', { skin: WG.skin, slug, dir }); renderWg() } catch (e) { toast(e.message, 'e') } }
function confirmBox(text, extra = '') { $('#askText').textContent = text; $('#askExtra').innerHTML = extra; return ask($('#dAsk')) }
async function wgDel(slug, name) {
  if (!await confirmBox(`¿Quitar «${slug}» de ${name}? Se quita de la lista y de los créditos; el póster se guarda en fondos-skins/antiguos/.`,
    '<label class="check"><input type="checkbox" id="delR2"> Borrar también el vídeo de R2 (no se puede deshacer)</label>')) return
  enqueue([{ kind: 'wg-remove', title: `Quitar ${slug}`, skin: WG.skin, slug, deleteR2: $('#delR2').checked }])
}
$('#wgBuild').onclick = () => enqueue([{ kind: 'wg-build', title: 'Compilar WhenGacha' }])
$('#wgPush').onclick = async () => {
  if (!await confirmBox('Esto compila la web, guarda un commit con los cambios de fondos y hace push a GitHub. Botkeep lo despliega en unos minutos y lo verá todo el mundo.',
    '<label for="msg" style="display:block;margin:10px 0 4px" class="muted">Mensaje del commit</label><input id="msg" type="text" style="width:100%" value="Fondos de las skins: cambios desde la app de fondos">')) return
  enqueue([{ kind: 'wg-push', title: 'Subir WhenGacha a la web', message: $('#msg').value }])
}

// ---------- AJUSTES ----------
function renderSettings() {
  const c = INFO.config
  $('#cfgDir').value = c.downloadDir
  $('#cfgFf').innerHTML = INFO.ffmpeg ? `<span class="ok">✓ ffmpeg encontrado</span> <span class="muted">${esc(INFO.ffmpeg)}</span>` : '<span class="bad">✗ No hay ffmpeg.</span> Se puede descargar «tal cual», pero no convertir. Para convertir: <code>pip install imageio-ffmpeg</code> o instala ffmpeg en el PATH, y reinicia la app.'
  $('#cfgSteam').innerHTML = INFO.steam.path ? `<span class="ok">✓ Steam en</span> ${esc(INFO.steam.path)}<br>${INFO.steam.dirs.length ? `Carpetas de Wallpaper Engine: ${INFO.steam.dirs.map(esc).join('<br>')}` : '<span class="muted">Sin carpeta de suscripciones de Wallpaper Engine todavía.</span>'}` : '<span class="bad">✗ No encuentro Steam.</span>'
  $('#cfgWgOn').checked = c.whengachaEnabled; $('#cfgWgRoot').value = c.whengachaRoot || ''
  $('#cfgWgState').innerHTML = INFO.whengacha.enabled ? '<span class="ok">✓ Activo</span>' : INFO.whengacha.error ? `<span class="bad">✗ ${esc(INFO.whengacha.error)}</span>` : 'Inactivo.'
}
$('#cfgPick').onclick = async () => { const r = await api('/api/pick-folder', { start: $('#cfgDir').value }); if (r.path) $('#cfgDir').value = r.path }
$('#cfgWgPick').onclick = async () => { const r = await api('/api/pick-folder', { start: $('#cfgWgRoot').value }); if (r.path) $('#cfgWgRoot').value = r.path }
$('#cfgOpen').onclick = () => api('/api/open', {})
$('#cfgSave').onclick = async () => {
  try {
    INFO = await api('/api/config', { downloadDir: $('#cfgDir').value, whengachaRoot: $('#cfgWgRoot').value, whengachaEnabled: $('#cfgWgOn').checked })
    applyInfo(); renderSettings(); toast('Ajustes guardados', 'ok')
  } catch (e) { toast(e.message, 'e') }
}

function applyInfo() { $('#nav [data-v=wg]').hidden = !INFO.whengacha.enabled; renderChips(); updSel() }

// ---------- arranque ----------
;(async () => {
  try { INFO = await api('/api/info') } catch (e) { document.body.innerHTML = `<p style="padding:30px">No se pudo hablar con la app: ${esc(e.message)}. ¿Está abierta la ventana de Wallpaureka!?</p>`; return }
  applyInfo()
  setView(view)
  renderSearch()
  pollQueue()
})()
