<script setup lang="ts">
// The deep-sea scene behind and in front of the page. The drawing itself
// lives in utils/sea/engine.ts and runs in a background thread
// (workers/sea.worker.ts) wherever the browser can hand a canvas to one, so
// it never competes with scrolling. Where it can't, the same code runs here.
//
// This component is the go-between. It owns the canvases and everything that
// needs the page: the fonts (it draws the glyph sheets and the hidden copy
// of the first name for its reflection), where the waterline and the bottom
// of the page are, the cursor, which section is showing, and which letters
// of the big headings the creatures weave behind. It sends those over as
// messages, only when they change, and passes the surface's shape back to
// the cursor.
import { MONO, RAMP, drawGlyphSheet, monoReady, type GlyphSheet } from '~/utils/ascii'
import { ping } from '~/utils/sound'
import { isLite, watchQuality } from '~/utils/lite'
import { waterlineY, hasFinePointer, cursorState, seaSurface, tow, skyMoonR } from '~/utils/water'
import { isDay, toggleDay, HOLD_MS } from '~/utils/theme'
import {
  createSeaEngine,
  type FromEngine,
  type NameGeometry,
  type Rect,
  type ReflectionSource,
  type SeaCanvases,
  type ToEngine,
} from '~/utils/sea/engine'

const route = useRoute()

const wrap = ref<HTMLElement>()
const back = ref<HTMLCanvasElement>()
const main = ref<HTMLCanvasElement>()
const glow = ref<HTMLCanvasElement>()
let stop = () => {}
let alive = true

const GLYPHS = RAMP + "|/\\-·'o><(){}[]~_^v,*+:@O="

// Start the background thread and check it can draw; resolves to null if not
function startWorker(): Promise<Worker | null> {
  if (typeof OffscreenCanvas === 'undefined' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/sea.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(null)
      return
    }
    const give = (w: Worker | null) => {
      clearTimeout(timer)
      worker.onmessage = null
      worker.onerror = null
      if (!w) worker.terminate()
      resolve(w)
    }
    const timer = setTimeout(() => give(null), 2000)
    worker.onerror = () => give(null)
    worker.onmessage = (e: MessageEvent<{ type: string; ok?: boolean }>) => {
      if (e.data?.type === 'hello') give(e.data.ok ? worker : null)
    }
    worker.postMessage({ type: 'hello' })
  })
}

onMounted(async () => {
  const host = wrap.value
  const bv = back.value
  const cv = main.value
  const gv = glow.value
  if (!host || !bv || !cv || !gv) return

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

  await monoReady(11)
  if (!alive) return
  // Decide early whether to draw the lighter way, before the canvases are sized
  const stopWatching = watchQuality()

  // ---- the engine, in a worker or here ------------------------------------
  function onEngine(m: FromEngine) {
    if (m.type === 'surface') {
      seaSurface.clock = m.clock
      seaSurface.amp = m.amp
      seaSurface.cw = m.cw
      seaSurface.boat = m.boat
      seaSurface.crab = m.crab
    } else if (m.type === 'cssBlur') {
      gv!.classList.add('is-css-blur')
    }
  }

  const worker = await startWorker()
  if (!alive) {
    worker?.terminate()
    return
  }
  let send: (m: ToEngine, transfer?: Transferable[]) => void
  if (worker) {
    const canvases: SeaCanvases = {
      back: bv.transferControlToOffscreen(),
      main: cv.transferControlToOffscreen(),
      glow: gv.transferControlToOffscreen(),
    }
    worker.postMessage({ type: 'init', canvases }, [canvases.back, canvases.main, canvases.glow] as unknown as Transferable[])
    worker.onmessage = (e: MessageEvent<FromEngine>) => onEngine(e.data)
    send = (m, transfer = []) => worker.postMessage(m, transfer)
  } else {
    const engine = createSeaEngine({ back: bv, main: cv, glow: gv }, onEngine, (w, h) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c
    })
    send = (m) => engine.handle(m)
  }

  // ---- layout -------------------------------------------------------------
  let W = 0
  let H = 0
  let cw = 6
  let ch = 11
  let cols = 0
  let rows = 0
  let laidOut = false

  // A glyph sheet as something that can be sent: an image for the worker,
  // the canvas itself when drawing here
  async function portable(sheet: GlyphSheet & { image: HTMLCanvasElement }): Promise<GlyphSheet> {
    if (!worker) return sheet
    return { ...sheet, image: await createImageBitmap(sheet.image) }
  }

  let layoutRun = 0
  async function layout() {
    const run = ++layoutRun
    W = host!.clientWidth
    H = host!.clientHeight
    if (!W || !H) return
    // Without graphics acceleration (utils/lite.ts) everything is drawn at
    // ordinary resolution, which is a quarter of the pixels on a sharp screen
    const dpr = isLite() ? 1 : Math.min(2, window.devicePixelRatio || 1)
    // The back layer is soft light, waves and snow: on very sharp screens it
    // is drawn at a lower resolution, which saves a lot of pixels
    const backDpr = Math.min(dpr, 1.5)
    const fs = W < 768 ? 8.5 : Math.max(9, Math.min(12, W * 0.0072))
    const m = document.createElement('canvas').getContext('2d')!
    m.font = `${fs}px ${MONO}`
    cw = m.measureText('M').width || fs * 0.6
    ch = Math.round(fs * 1.16 * 10) / 10
    cols = Math.ceil(W / cw)
    rows = Math.ceil(H / ch)

    const front = drawGlyphSheet(GLYPHS, fs, cw, ch, dpr)
    const backSheet = backDpr === dpr ? front : drawGlyphSheet(GLYPHS, fs, cw, ch, backDpr)
    const atlas = await portable(front)
    const backAtlas = backSheet === front ? atlas : await portable(backSheet)
    if (run !== layoutRun || !alive) return

    const transfer: Transferable[] = []
    if (worker) {
      transfer.push(atlas.image as ImageBitmap)
      if (backAtlas !== atlas) transfer.push(backAtlas.image as ImageBitmap)
    }
    send({ type: 'layout', W, H, dpr, backDpr, cw, ch, fine: hasFinePointer(), waterY: waterlineY(), atlas, backAtlas }, transfer)
    laidOut = true
    measureLetters()
    measureName()
    sendReflection()
    sendState(true)
  }

  // ---- weaving through the big text --------------------------------------
  // The jellyfish and some creatures (see `weave` in sealife.ts) pass behind
  // every other letter of the large text (your name, the contact links, the
  // project titles) and in front of the rest. Each such letter is
  // measured once, in page coordinates, then drawn into a tiny mask (one
  // pixel per character cell) whenever the page scrolls, and sent over.
  const WEAVE_TEXT = '.contact-links a, .project-title'
  const mask = document.createElement('canvas')
  const mctx = mask.getContext('2d', { willReadFrequently: true })!
  let letters: { ch: string; x: number; y: number; h: number; font: string; ascent: number }[] = []
  let maskAt = NaN

  function measureLetters() {
    letters = []
    maskAt = NaN
    const range = document.createRange()
    document.querySelectorAll<HTMLElement>(WEAVE_TEXT).forEach((el) => {
      const cs = getComputedStyle(el)
      const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      mctx.font = font
      const ascent = mctx.measureText('H').fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.9
      let n = 0
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.num')) continue
        const text = node.textContent ?? ''
        for (let k = 0; k < text.length; k++) {
          if (/\s/.test(text[k]!)) continue
          if (n++ % 2) continue // every other letter stays behind the creature
          range.setStart(node, k)
          range.setEnd(node, k + 1)
          const r = range.getBoundingClientRect()
          letters.push({ ch: text[k]!, x: r.left, y: r.top + window.scrollY, h: r.height, font, ascent })
        }
      }
    })
    // The name is SVG text: each letter's place comes from the SVG, turned
    // into screen pixels. (Not the wet copy of the first name, which only
    // tints it under the water.)
    document.querySelectorAll<SVGTextElement>('.hero-name text:not(.hero-wet)').forEach((t) => {
      const ctm = t.getScreenCTM()
      const text = t.textContent ?? ''
      if (!ctm || !text) return
      const cs = getComputedStyle(t)
      const font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * ctm.a}px ${cs.fontFamily}`
      mctx.font = font
      const ascent = mctx.measureText('H').fontBoundingBoxAscent || parseFloat(cs.fontSize) * ctm.a * 0.9
      const baseline = t.y.baseVal.numberOfItems ? t.y.baseVal.getItem(0).value : 0
      let n = 0
      for (let k = 0; k < t.getNumberOfChars(); k++) {
        if (/\s/.test(text[k]!) || n++ % 2) continue
        const e = t.getExtentOfChar(k)
        const p = new DOMPoint(e.x, baseline).matrixTransform(ctm)
        letters.push({ ch: text[k]!, x: p.x, y: p.y - ascent + window.scrollY, h: e.height * ctm.d, font, ascent })
      }
    })
  }

  function sendWeave() {
    if (!laidOut || window.scrollY === maskAt) return
    maskAt = window.scrollY
    const out = new Uint8Array(cols * rows)
    const visible = letters.filter((L) => L.y - maskAt < H && L.y - maskAt + L.h > 0)
    if (visible.length) {
      mask.width = cols
      mask.height = rows
      mctx.setTransform(1 / cw, 0, 0, 1 / ch, 0, 0)
      mctx.fillStyle = '#fff'
      mctx.textBaseline = 'alphabetic'
      for (const L of visible) {
        mctx.font = L.font
        mctx.fillText(L.ch, L.x, L.y - maskAt + L.ascent)
      }
      const data = mctx.getImageData(0, 0, cols, rows).data
      for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3]! > 70 ? 1 : 0
    }
    send({ type: 'weave', mask: out }, [out.buffer])
  }

  // ---- the first name, for its reflection --------------------------------
  const SRC_SCALE = 0.5 // hidden-canvas pixels per unit of the name's SVG
  let nameBox: { x: number; width: number } | null = null

  // Where the name sits in its SVG's own units; only changes with the layout
  function measureName() {
    nameBox = null
    const text = document.querySelector<SVGTextElement>('svg[data-water-y] text')
    try {
      const b = text?.getBBox()
      if (b && b.width) nameBox = { x: b.x, width: b.width }
    } catch {
      nameBox = null
    }
  }

  function nameGeometry(): NameGeometry | null {
    const svg = document.querySelector<SVGSVGElement>('svg[data-water-y]')
    const vb = svg?.viewBox.baseVal
    if (!svg || !vb || !vb.width || !nameBox) return null
    const r = svg.getBoundingClientRect()
    const k = r.width / vb.width
    const x0 = r.left + (nameBox.x - vb.x) * k
    return { x0, x1: x0 + nameBox.width * k, k, gap: Number(svg.dataset.waterY) }
  }

  // "Akshun" drawn once, small, into a hidden canvas
  function sendReflection() {
    const text = document.querySelector<SVGTextElement>('svg[data-water-y] text')
    const word = text?.textContent?.trim()
    if (!text || !word) {
      send({ type: 'reflection', src: null })
      return
    }
    const cs = getComputedStyle(text)
    const size = 100 * SRC_SCALE
    const font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`
    // The name's own letter spacing, scaled down to the hidden copy
    const spacing = `${((parseFloat(cs.letterSpacing) || 0) * SRC_SCALE).toFixed(2)}px`
    const c = document.createElement('canvas')
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.font = font
    x.letterSpacing = spacing
    const base = Math.ceil(size * 0.8)
    const w = Math.ceil(x.measureText(word).width) + 4
    const h = base + 4
    c.width = w
    c.height = h
    x.font = font
    x.letterSpacing = spacing
    x.fillStyle = '#fff'
    x.textBaseline = 'alphabetic'
    x.fillText(word, 2, base)
    const src: ReflectionSource = { data: x.getImageData(0, 0, w, h).data, w, h, base, scale: SRC_SCALE }
    send({ type: 'reflection', src }, [src.data.buffer])
  }

  // ---- the state of the page, sent only when it changes -------------------
  const pointer = { x: 0, y: 0, on: false }
  let lastKey = ''

  // Every other project tile stays in front of the sea life (WorkStrip.vue
  // marks them is-front): fish and jellyfish pass behind those, and in front
  // of the rest
  function frontRects(): Rect[] {
    const out: Rect[] = []
    document.querySelectorAll<HTMLElement>('.work-track li.is-front .tile').forEach((tile) => {
      const r = tile.getBoundingClientRect()
      if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) return
      out.push({ x0: Math.round(r.left), y0: Math.round(r.top), x1: Math.round(r.right), y1: Math.round(r.bottom) })
    })
    return out
  }

  function sendState(force = false) {
    if (!laidOut) return
    const waterY = waterlineY()
    const floorY = document.documentElement.scrollHeight - window.scrollY
    const name = Number.isFinite(waterY) ? nameGeometry() : null
    const fronts = frontRects()
    const links = document.querySelector('.contact-links')
    const reefTop = links ? links.getBoundingClientRect().top : NaN
    const key = [
      reefTop,
      waterY,
      fronts.map((f) => `${f.x0},${f.y0},${f.x1},${f.y1}`).join(';'),
      floorY,
      name?.x0,
      name?.k,
      pointer.x,
      pointer.y,
      pointer.on,
      cursorState.mode,
      cursorState.x,
      cursorState.y,
      cursorState.moon?.x,
      cursorState.moon?.y,
      cursorState.sub?.x,
      cursorState.sub?.y,
    ].join()
    if (!force && key === lastKey) return
    lastKey = key
    send({
      type: 'state',
      waterY,
      fronts,
      reefTop,
      floorY,
      name,
      pointer: { ...pointer },
      cursor: {
        mode: cursorState.mode,
        x: cursorState.x,
        y: cursorState.y,
        moon: cursorState.moon && { ...cursorState.moon },
        sub: cursorState.sub && { ...cursorState.sub },
      },
    })
  }

  // A light loop on the page: a few measurements a frame, sent if they changed
  let pumpId = 0
  function pump() {
    pumpId = requestAnimationFrame(pump)
    sendState()
    sendWeave()
  }

  // The sea rests while the arcade game (ArcadeMode.vue) is open over it
  let arcade = false
  function sendRun() {
    send({ type: 'run', visible: !document.hidden && !arcade, focused: document.hasFocus(), reduce: reduce.matches })
    cancelAnimationFrame(pumpId)
    pumpId = 0
    if (!document.hidden && !arcade) pumpId = requestAnimationFrame(pump)
  }
  const onCrab = (e: Event) => send({ type: 'crab', talking: !!(e as CustomEvent<boolean>).detail })
  const onArcade = (e: Event) => {
    arcade = !!(e as CustomEvent<boolean>).detail
    sendRun()
  }

  // ---- events ---------------------------------------------------------------
  function onMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.on = true
  }
  function onLeave(e: MouseEvent) {
    if (!e.relatedTarget) pointer.on = false
  }
  // On a touch screen the moon (or sun) hangs in a fixed spot in the sky;
  // pressing and holding it switches day and night
  let touchHold = 0
  let touchAt = { x: 0, y: 0 }
  function onTouchHold(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false
    const level = waterlineY()
    if (!Number.isFinite(level) || level <= 110) return false
    const mx = W * 0.8
    const my = level * 0.36
    const mr = skyMoonR(level)
    if (Math.hypot(e.clientX - mx, e.clientY - my) > mr * 1.5) return false
    touchAt = { x: e.clientX, y: e.clientY }
    clearTimeout(touchHold)
    touchHold = window.setTimeout(() => {
      touchHold = 0
      toggleDay()
    }, HOLD_MS)
    return true
  }
  function cancelTouchHold(e: PointerEvent) {
    if (!touchHold) return
    if (e.type === 'pointermove' && Math.hypot(e.clientX - touchAt.x, e.clientY - touchAt.y) < 16) return
    clearTimeout(touchHold)
    touchHold = 0
  }

  // A sonar ping where the water was clicked or tapped, which the crew
  // (ShipCalls.vue) hears about too
  function sonar(x: number, y: number) {
    send({ type: 'ping', x, y })
    ping(x)
    window.dispatchEvent(new Event('sea:ping'))
  }

  // A mouse pings as soon as it's pressed. A finger only pings on a tap:
  // lifted again quickly, without moving or scrolling the page, so swiping
  // to scroll stays quiet.
  let tap: { x: number; y: number; t: number; scroll: number } | null = null
  const controls = 'a, button, input, textarea, select, label, .depth-meter, .arcade'
  function onDown(e: PointerEvent) {
    if (onTouchHold(e)) return
    // Clicking a link or button shouldn't set off a ping
    if ((e.target as Element | null)?.closest?.(controls)) return
    if (e.pointerType === 'mouse') sonar(e.clientX, e.clientY)
    else tap = { x: e.clientX, y: e.clientY, t: performance.now(), scroll: window.scrollY }
  }
  function onUp(e: PointerEvent) {
    const t = tap
    tap = null
    if (!t || e.type !== 'pointerup') return
    const still = Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && Math.abs(window.scrollY - t.scroll) < 4
    if (still && performance.now() - t.t < 350) sonar(e.clientX, e.clientY)
  }
  function onTheme(e?: Event) {
    // On load it's already set: no sunrise, just the remembered sky
    send({ type: 'theme', day: isDay(), instant: !e })
  }

  function onTow(e: Event) {
    const dx = (e as CustomEvent<number>).detail
    send({ type: 'tow', dx })
    // The names are in place: measure their letters for the weave
    if (!dx) measureLetters()
  }
  function onLift(e: Event) {
    const d = (e as CustomEvent<{ x: number; bottom: number } | null>).detail
    send(d ? { type: 'lift', x: d.x, bottom: d.bottom } : { type: 'lift', x: null, bottom: null })
  }

  function onZone(e: Event) {
    const zone = (e as CustomEvent<number>).detail
    if (typeof zone === 'number') send({ type: 'zone', zone })
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  // The moon and submarine move on their own too (SeaCursor.vue)
  const onCursor = () => sendState()
  window.addEventListener('sea:cursor', onCursor)
  document.addEventListener('mouseout', onLeave)
  window.addEventListener('pointerdown', onDown, { passive: true })
  window.addEventListener('pointerup', cancelTouchHold, { passive: true })
  window.addEventListener('pointercancel', cancelTouchHold, { passive: true })
  window.addEventListener('pointerup', onUp, { passive: true })
  window.addEventListener('pointercancel', onUp, { passive: true })
  window.addEventListener('pointermove', cancelTouchHold, { passive: true })
  window.addEventListener('sea:theme', onTheme)
  window.addEventListener('sea:zone', onZone)
  window.addEventListener('sea:tow', onTow)
  window.addEventListener('sea:lift', onLift)
  if (tow.first) send({ type: 'tow', dx: tow.first })
  document.addEventListener('visibilitychange', sendRun)
  window.addEventListener('focus', sendRun)
  window.addEventListener('blur', sendRun)
  reduce.addEventListener?.('change', sendRun)

  // The page's content moves under the sea when the route or the page's size changes
  const remeasure = () => {
    measureLetters()
    measureName()
    sendState(true)
  }
  const stopRoute = watch(
    () => route.path,
    () =>
      nextTick(() => {
        remeasure()
        sendReflection()
      }),
  )
  document.fonts?.ready.then(() => {
    remeasure()
    sendReflection()
  })
  const pageSize = new ResizeObserver(remeasure)
  pageSize.observe(document.body)

  let resizeId = 0
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(resizeId)
    resizeId = requestAnimationFrame(() => layout())
  })
  ro.observe(host)

  // Switching to the lighter way: tell the sea, and redraw at the new size
  const onLite = () => {
    send({ type: 'lite' })
    layout()
  }
  window.addEventListener('sea:lite', onLite)
  window.addEventListener('sea:arcade', onArcade)
  window.addEventListener('sea:crab', onCrab)
  if (isLite()) send({ type: 'lite' })

  await layout()
  onTheme()
  sendRun()

  stop = () => {
    cancelAnimationFrame(pumpId)
    cancelAnimationFrame(resizeId)
    ro.disconnect()
    pageSize.disconnect()
    stopRoute()
    window.removeEventListener('pointermove', onMove)
    document.removeEventListener('mouseout', onLeave)
    window.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointerup', cancelTouchHold)
    window.removeEventListener('pointercancel', cancelTouchHold)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    window.removeEventListener('pointermove', cancelTouchHold)
    window.removeEventListener('sea:theme', onTheme)
    clearTimeout(touchHold)
    window.removeEventListener('sea:zone', onZone)
    window.removeEventListener('sea:tow', onTow)
    window.removeEventListener('sea:lift', onLift)
    document.removeEventListener('visibilitychange', sendRun)
    window.removeEventListener('focus', sendRun)
    window.removeEventListener('blur', sendRun)
    reduce.removeEventListener?.('change', sendRun)
    window.removeEventListener('sea:lite', onLite)
    window.removeEventListener('sea:arcade', onArcade)
    window.removeEventListener('sea:crab', onCrab)
    stopWatching()
    send({ type: 'stop' })
    worker?.terminate()
  }
})

onBeforeUnmount(() => {
  alive = false
  stop()
})
</script>

<template>
  <div class="sea-root" aria-hidden="true">
    <div class="sea-backdrop" />
    <canvas ref="back" class="sea-back" />
    <div ref="wrap" class="sea">
      <canvas ref="main" />
      <canvas ref="glow" class="sea-bloom" />
    </div>
  </div>
</template>
