/*
 * Vídeo: ffmpeg (el de imageio-ffmpeg de Python o, si no, el de PATH), conversión a mp4 H.264, póster y medidas.
 */
import fs from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'

let FFMPEG
/** Ruta de ffmpeg o null si no hay. */
export function ffmpegPath() {
  if (FFMPEG !== undefined) return FFMPEG
  for (const py of ['python', 'py', 'python3']) {
    try {
      const p = execFileSync(py, ['-c', 'import imageio_ffmpeg as f;print(f.get_ffmpeg_exe())'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (p && fs.existsSync(p)) return (FFMPEG = p)
    } catch { /* siguiente */ }
  }
  try { execFileSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }); return (FFMPEG = 'ffmpeg') } catch { /* no hay */ }
  return (FFMPEG = null)
}

/** Ejecuta un programa; cada línea va a log (stdout) u onErr (stderr). Resuelve con el código de salida. */
export function run(cmd, args, { cwd, log = () => {}, onErr, shell = false, signal } = {}) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd, shell, windowsHide: true })
    // Las líneas pueden llegar partidas entre dos trozos: se guarda el final hasta el siguiente.
    const rest = { false: '', true: '' }
    const emit = (l, err) => { if (l.trim()) (err && onErr ? onErr : log)(l) }
    const feed = (buf, err) => { const parts = (rest[err] + String(buf)).split(/\r?\n|\r/); rest[err] = parts.pop(); parts.forEach(l => emit(l, err)) }
    p.stdout.on('data', b => feed(b, false)); p.stderr.on('data', b => feed(b, true))
    p.on('error', e => { log(`No se pudo ejecutar ${cmd}: ${e.message}`); resolve(-1) })
    p.on('close', code => { emit(rest.false, false); emit(rest.true, true); resolve(code) })
    signal?.addEventListener('abort', () => p.kill())
  })
}

/** Medidas y duración de un vídeo. */
export async function probe(file) {
  const ff = ffmpegPath(); if (!ff) return {}
  let w = 0, h = 0, duration = 0, audio = false, fps = 0
  await run(ff, ['-hide_banner', '-i', file], {
    onErr: l => {
      const d = l.match(/Duration: (\d+):(\d+):([\d.]+)/); if (d) duration = d[1] * 3600 + d[2] * 60 + Number(d[3])
      if (/Stream .*Video:/.test(l) && !w) { const m = l.match(/, (\d{2,5})x(\d{2,5})/); if (m) { w = +m[1]; h = +m[2] } const f = l.match(/([\d.]+) fps/); if (f) fps = +f[1] }
      if (/Stream .*Audio:/.test(l)) audio = true
    },
  })
  return { w, h, duration, audio, fps, dims: w ? `${w}×${h}` : '' }
}

/**
 * Convierte a mp4 H.264 (yuv420p, faststart).
 * opts: width (máx.), crf, fps (null = el original, máx. 60), crop169 (recorta al centro en 16:9), audio (conservar sonido).
 */
export async function convert(input, output, opts, onProgress = () => {}, signal) {
  const ff = ffmpegPath(); if (!ff) throw new Error('No hay ffmpeg en este equipo. Instálalo (pip install imageio-ffmpeg, o ffmpeg en el PATH) o descarga sin convertir.')
  const width = Math.min(3840, Math.max(320, Number(opts.width) || 1920)), crf = Math.min(40, Math.max(14, Number(opts.crf) || 23))
  const crop = opts.crop169 ? "crop='min(iw,trunc(ih*16/9/2)*2)':ih," : ''
  // Sin fps fijo se conserva el original, salvo que pase de 60.
  const srcFps = opts.fps ? 0 : (await probe(input)).fps || 0
  const fps = opts.fps ? `,fps=${Number(opts.fps)}` : srcFps > 60.5 ? ',fps=60' : ''
  let duration = 0, lastErr = ''
  const tmp = output.replace(/\.mp4$/i, '') + '.tmp.mp4'
  const code = await run(ff, ['-y', '-hide_banner', '-i', input, ...(opts.audio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-vf', `${crop}scale='min(${width},iw)':-2:flags=lanczos${fps}`, '-c:v', 'libx264', '-preset', opts.preset || 'slow',
    '-crf', String(crf), ...(opts.tune ? ['-tune', opts.tune] : []), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', tmp], {
    signal,
    log: l => { const m = l.match(/^out_time_us=(\d+)/); if (m && duration) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration)) },
    onErr: l => { const d = l.match(/Duration: (\d+):(\d+):([\d.]+)/); if (d) duration = d[1] * 3600 + d[2] * 60 + Number(d[3]); else if (/error|invalid/i.test(l)) lastErr = l },
  })
  if (code !== 0) { fs.rmSync(tmp, { force: true }); throw new Error(signal?.aborted ? 'Cancelado' : `ffmpeg no pudo convertir el vídeo${lastErr ? `: ${lastErr}` : ' (¿es un vídeo válido?)'}`) }
  fs.renameSync(tmp, output)
  return probe(output)
}

/** Póster webp del primer fotograma. */
export async function poster(mp4, webp, width = 960) {
  const ff = ffmpegPath(); if (!ff) return false
  return (await run(ff, ['-y', '-v', 'error', '-i', mp4, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-c:v', 'libwebp', '-quality', '72', webp])) === 0
}
