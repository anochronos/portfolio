// The lighter way of drawing the sea, for computers without graphics
// acceleration (or with it switched off), where the browser does all its
// drawing on the main processor and the full effect can't keep up.
//
// It switches on straight away when the browser says it's drawing in
// software, and otherwise if the page measures itself running slowly once
// the opening has played. It marks the page with the `lite` class (see
// "Lite" in main.css) and tells the sea, the cursor and anything else
// listening with a 'sea:lite' event. Then:
//   - the sea and cursor canvases are drawn at ordinary resolution, not
//     the sharper resolution of high-density screens
//   - the sea's glow is blended in by the sea itself, in its background
//     thread, instead of by the browser as a separate layer over the page
//   - the sea runs at a slightly lower frame rate
//   - the CRT scanlines and blurred effects are left out
//
// To try either way on any computer, set localStorage 'sea-quality' to
// 'lite' or 'full' and reload.

const KEY = 'sea-quality'

export function isLite(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('lite')
}

export function setLite() {
  if (isLite()) return
  document.documentElement.classList.add('lite')
  window.dispatchEvent(new Event('sea:lite'))
}

// Whether the browser is drawing in software: no WebGL at all, or a
// software renderer behind it
function software(): boolean {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return true
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '')
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)
  } catch {
    return false
  }
}

// Decide now, and keep an eye on the frame rate for a little while after
// the opening. Returns a function that stops watching.
export function watchQuality(): () => void {
  let forced: string | null = null
  try {
    forced = localStorage.getItem(KEY)
  } catch {}
  if (forced === 'full') return () => {}
  if (forced === 'lite' || software()) {
    setLite()
    return () => {}
  }

  // Measure for two seconds, starting once the opening is over
  let id = 0
  let start = 0
  let frames = 0
  const count = (now: number) => {
    if (!start) start = now
    frames++
    if (now - start < 2000) id = requestAnimationFrame(count)
    else if (!document.hidden && (frames * 1000) / (now - start) < 40) setLite()
  }
  const timer = window.setTimeout(() => {
    if (!document.hidden) id = requestAnimationFrame(count)
  }, 6000)
  return () => {
    clearTimeout(timer)
    cancelAnimationFrame(id)
  }
}
