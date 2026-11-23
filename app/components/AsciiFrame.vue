<script setup lang="ts">
// A driftwood frame drawn in characters, like everything else in the sea:
// four planks with their grain running along them, mitred at the corners,
// lit from the top left, bleached and stained with algae, with rusted nails
// and pieces broken off. Each frame breaks in its own places (from `seed`).
//
// It sits over its parent's border (the parent sets --frame, see main.css),
// and the broken bits are see-through, so the sea shows through them. It is
// drawn once, and again only when the frame changes size.
import { MONO, hash2, monoReady } from '~/utils/ascii'

const props = defineProps<{ seed: number }>()
const canvas = ref<HTMLCanvasElement>()
let stop = () => {}

// Smooth noise from 0 to 1, for the wood grain and the stains
function noise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function grain(x: number, y: number): number {
  return 0.6 * noise(x, y) + 0.3 * noise(x * 2.3 + 7, y * 2.3) + 0.1 * noise(x * 5 + 3, y * 5)
}

const mix = (a: number[], b: number[], t: number) => a.map((v, k) => Math.round(v + (b[k]! - v) * t))

const DARK = [46, 38, 30]
const LIGHT = [188, 170, 138]
const ALGAE = [70, 128, 100]
const RUST = [150, 88, 48]

interface Break {
  plank: number // 0 top, 1 bottom, 2 left, 3 right
  at: number // where along the plank, 0 to 1
  len: number // how many cells long
  deep: boolean // through the whole plank, or just the outer edge
}

function draw() {
  const cv = canvas.value
  const host = cv?.parentElement
  const ctx = cv?.getContext('2d')
  if (!cv || !host || !ctx) return
  const F = parseFloat(getComputedStyle(host).borderTopWidth) || 0
  const W = host.offsetWidth
  const H = host.offsetHeight
  if (!F || !W || !H) return

  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  // Two rows of characters make the top and bottom planks; the sides are as
  // many columns as fit the same thickness
  const fs = F / 2 / 1.1
  ctx.font = `${fs}px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const mw = ctx.measureText('M').width || fs * 0.6
  const cols = Math.max(8, Math.floor(W / mw))
  const rows = Math.max(6, Math.round(H / (F / 2)))
  const cw = W / cols
  const rh = H / rows
  const side = Math.max(2, Math.round(F / cw))

  // Where this frame has broken
  const s = props.seed * 17.3
  const breaks: Break[] = []
  const count = 3 + Math.floor(hash2(s, 1) * 3)
  for (let k = 0; k < count; k++) {
    breaks.push({
      plank: Math.floor(hash2(s, k + 10) * 4),
      at: 0.1 + 0.8 * hash2(s, k + 20),
      len: 2 + Math.floor(hash2(s, k + 30) * 6),
      deep: hash2(s, k + 40) > 0.55,
    })
  }
  // Now and then a whole corner has gone
  const lostCorner = hash2(s, 50) > 0.45 ? Math.floor(hash2(s, 51) * 4) : -1

  const missing = (plank: number, along: number, across: number, length: number, corner: number) => {
    if (corner === lostCorner && corner >= 0) return true
    for (const b of breaks) {
      if (b.plank !== plank) continue
      const start = Math.floor(b.at * length)
      if (along < start || along >= start + b.len) continue
      // A jagged bite: some cells only lose their outer row
      const bite = b.deep && hash2(along, plank + s) > 0.25 ? 99 : 1
      if (across < bite) return true
    }
    return false
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const top = r < 2
      const bottom = r >= rows - 2
      const left = c < side
      const right = c >= cols - side
      if (!top && !bottom && !left && !right) continue

      // Which plank this cell belongs to: in the corners, the mitre decides
      let horizontal = top || bottom
      let corner = -1
      if ((top || bottom) && (left || right)) {
        const dx = (left ? c : cols - 1 - c) / side
        const dy = (top ? r : rows - 1 - r) / 2
        horizontal = dy <= dx
        corner = top ? (left ? 0 : 1) : left ? 3 : 2
      }
      const plank = horizontal ? (top ? 0 : 1) : left ? 2 : 3
      const along = horizontal ? c : r
      const across = horizontal ? (top ? r : rows - 1 - r) : left ? c : cols - 1 - c
      const length = horizontal ? cols : rows
      const thick = horizontal ? 2 : side

      if (missing(plank, along, across, length, corner)) continue
      const brokenNext =
        missing(plank, along - 1, across, length, -1) || missing(plank, along + 1, across, length, -1)

      // Grain runs along the plank; light comes from the top left, and the
      // inner edge is in the shadow of the recess
      const g = grain(along * 0.18 + plank * 31 + s, across * 1.6 + plank * 7)
      const lit = plank === 0 ? 0.8 : plank === 2 ? 0.72 : plank === 3 ? 0.6 : 0.56
      const inner = across === thick - 1 ? 0.75 : 1
      let v = lit * (0.45 + 0.7 * g) * inner
      v = Math.max(0, Math.min(1, v))

      let glyph: string
      if (brokenNext) glyph = hash2(along, across + s) > 0.5 ? '/' : '\\'
      else if (horizontal) glyph = v < 0.26 ? '.' : v < 0.42 ? '-' : v < 0.66 ? '=' : '#'
      else glyph = v < 0.26 ? '.' : v < 0.42 ? ':' : v < 0.66 ? '|' : '#'
      // Knots in the wood
      if (!brokenNext && grain(along * 0.5 + s, plank * 3.1) > 0.82 && across === Math.floor(thick / 2)) glyph = 'o'

      let rgb = mix(DARK, LIGHT, v)
      // Green algae, mostly low down and along the bottom plank
      const stain = noise(along * 0.09 + plank * 11 + s, across * 0.5)
      if (stain > (plank === 1 ? 0.55 : 0.7)) rgb = mix(rgb, ALGAE, 0.55)

      // A rusted nail at each corner joint that's still there
      if (corner >= 0 && across === Math.floor(thick / 2) && along === (horizontal ? (left ? 1 : cols - 2) : top ? 1 : rows - 2)) {
        glyph = 'o'
        rgb = RUST
      }

      ctx.fillStyle = `rgb(${rgb.join(',')})`
      ctx.fillText(glyph, (c + 0.5) * cw, (r + 0.5) * rh)
    }
  }
}

onMounted(async () => {
  await monoReady(10)
  draw()
  const host = canvas.value?.parentElement
  if (!host) return
  let id = 0
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(id)
    id = requestAnimationFrame(draw)
  })
  ro.observe(host)
  stop = () => {
    cancelAnimationFrame(id)
    ro.disconnect()
  }
})

onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="canvas" class="ascii-frame" aria-hidden="true" />
</template>
