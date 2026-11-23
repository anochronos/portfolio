// Runs the sea (utils/sea/engine.ts) in a background thread, so drawing it
// never holds up scrolling, clicks or the rest of the page. SeaScene.vue
// hands over its canvases and then sends what it measures from the page;
// this sends back the surface's shape for the cursor.
import { createSeaEngine, type SeaCanvases, type ToEngine } from '../utils/sea/engine'

type Incoming = { type: 'hello' } | { type: 'init'; canvases: SeaCanvases } | ToEngine

const scope = self as unknown as {
  postMessage: (m: unknown) => void
  onmessage: ((e: MessageEvent<Incoming>) => void) | null
}

let engine: ReturnType<typeof createSeaEngine> | null = null

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'hello') {
    // Tell the page whether canvases can be drawn here at all
    let ok = false
    try {
      ok = typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d')
    } catch {
      ok = false
    }
    scope.postMessage({ type: 'hello', ok })
    return
  }
  if (m.type === 'init') {
    engine = createSeaEngine(
      m.canvases,
      (out) => scope.postMessage(out),
      (w, h) => new OffscreenCanvas(w, h),
    )
    return
  }
  engine?.handle(m)
}
