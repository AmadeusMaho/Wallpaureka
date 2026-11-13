# Wallpaureka!

Buscar, previsualizar, descargar y convertir fondos animados (live wallpapers). Funciona solo en este PC; no necesita cuentas ni contraseñas.

## Abrirla

Haz doble clic en **`Abrir Wallpaureka!.cmd`**. Se abre una ventana negra (el servidor) y el navegador en `http://localhost:5200`.
Para cerrar la app, cierra esa ventana. Si ya estaba abierta, el doble clic solo abre otra pestaña del navegador.

Requisitos:
- **Node.js 18 o más nuevo** (https://nodejs.org).
- **ffmpeg** para convertir (opcional): `pip install imageio-ffmpeg` o ffmpeg en el PATH. Sin ffmpeg se puede descargar «tal cual».
- Otro puerto: `set PORT=5300` antes de `node server.mjs`. `NO_OPEN=1` evita que abra el navegador.

## Uso

1. **Buscar**: escribe qué buscar (en inglés suele dar más resultados) y marca las webs: MoeWalls, WallpaperWaifu, DesktopHut y MotionBGs.
   Se leen todas las páginas de resultados, una tras otra con pausa (nunca en paralelo), y se guardan 30 min.
   También puedes **pegar un enlace**: un post de esas webs, una ficha del Steam Workshop o un `.mp4`/`.webm` directo; o usar un vídeo del PC.
2. **Previsualizar**: pasa el ratón por una tarjeta para ver el vídeo; **⤢** lo abre en grande con sus datos (resolución, original, autor).
3. **Elegir**: clic en las tarjetas. Filtros: nombre, web, orden, ocultar baja resolución, solo elegidos.
   Avisos en amarillo: baja resolución, vertical (de móvil), ultrapanorámico, no 16:9.
4. **Descargar…**: original o vista previa, tal cual o convertido a MP4 H.264 (hasta 1920 px, a su tamaño hasta 4K, o ligero a 1280 px/24 fps),
   recorte al centro en 16:9 para ultrapanorámicos, con o sin sonido, y la carpeta (botón «Elegir…»).
5. La **Cola** (a la derecha) muestra el progreso de cada trabajo, uno detrás de otro: cancelar, reintentar y «Mostrar en la carpeta».

Qué da cada web:

| Web | Vista previa | Original |
|---|---|---|
| MoeWalls | sí | no (detrás de anuncios): se usa la vista previa |
| WallpaperWaifu | sí | no (cifrado y con anuncios): se usa la vista previa |
| DesktopHut | sí | sí (`media.desktophut.com/files/…`) |
| MotionBGs | 960×540 | sí, 1920×1080 (y 4K si la web lo ofrece) |

## Wallpaper Engine (Steam)

Pestaña **Wallpaper Engine**:
- **Mis suscripciones**: lo que ya tienes en `<Steam>/steamapps/workshop/content/431960/` en todas tus bibliotecas (se leen de `libraryfolders.vdf`).
  Se puede filtrar, ver al pasar el ratón y descargar o convertir como cualquier otro fondo.
- **Pegar un enlace del Workshop** (`steamcommunity.com/sharedfiles/filedetails/?id=…`): muestra título, autor y tipo (API pública de Steam).
  Si no está en tu PC, pulsa «Abrir en Steam», suscríbete, espera a que Wallpaper Engine lo descargue y pulsa «Comprobar de nuevo».
- Los wallpapers de tipo **escena** o **web** no son vídeos: se avisa y no se pueden descargar como .mp4.

La app nunca pide ni guarda contraseñas de Steam ni usa SteamCMD.

## Perfil WhenGacha (opcional)

Si en **Ajustes** está activado y apunta a la carpeta `app` de WhenGacha, aparecen:
- **Añadir a WhenGacha…** en la barra de elegidos y en cada ficha: convierte (vista previa 1280 px CRF 27, u original 1920 px CRF 26, a 24 fps),
  sube el mp4 al bucket R2 `whengacha-fondos` con wrangler (`npx wrangler login` en la carpeta app), copia el póster a `public/skins/<skin>/`,
  guarda copia en `fondos-skins/r2/`, lo añade a `FONDOS` en `src/skins/skins.ts` y su crédito en `public/acerca.html`.
- La pestaña **WhenGacha**: los fondos de cada skin, ordenar (↑ ↓), quitar (con opción de borrarlo de R2), **Compilar** y **Subir a la web** (commit + push).

Es lo mismo que hace `app/scripts/fondos/` (que sigue funcionando en el puerto 5199).

## Archivos

- `server.mjs`: servidor local, cola de trabajos y rutas.
- `lib/sources.mjs`: las webs (búsqueda y ficha de cada fondo). `lib/net.mjs`: peticiones en fila por sitio, con pausa y caché.
- `lib/steam.mjs`: Wallpaper Engine. `lib/media.mjs`: ffmpeg. `lib/whengacha.mjs`: el perfil WhenGacha.
- `public/`: la interfaz. `datos/`: ajustes (`config.json`) y caché (`cache.json`); se pueden borrar sin problema.
- Los archivos temporales van a `%TEMP%\wallpaureka`.
