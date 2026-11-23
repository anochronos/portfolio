<script setup lang="ts">
// A picture that can turn into characters on demand.
// `cell` is the character width in CSS pixels: 0 shows the picture itself,
// larger numbers give fewer, bigger characters.
// With no `src` it draws a pattern generated from `seed`, so every project
// has tile art until a real screenshot is added.
import { RAMP, MONO, COLORS, HUE, ASPECT, colorIndex, hueOf, rampIndex, monoReady, tileGlyphs, hash2 } from '~/utils/ascii'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    seed: string
    fit?: 'cover' | 'contain'
    pixelArt?: boolean
    cell?: number
  }>(),
  { src: undefined, alt: '', fit: 'cover', pixelArt: false, cell: 0 },
)

const ABYSS = '#01040a'

const box = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
let source: HTMLImageElement | HTMLCanvasElement | null = null
let sourceW = 0
let sourceH = 0
let scratch: HTMLCanvasElement | null = null
let ro: ResizeObserver | undefined
let alive = true

function seeded(text: string) {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

// Tile art for projects without a screenshot: a drifting field of
// characters, like a patch of the hero's sea, with one brighter current.
function makePattern(seed: string): HTMLCanvasElement {
  const cols = 64
  const rows = 26
  const cw = 8
  const ch = cw * ASPECT
  const out = document.createElement('canvas')
  out.width = Math.round(cols * cw)
  out.height = Math.round(rows * ch)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = ABYSS
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.font = `${cw / 0.6}px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const rand = seeded(seed)
  const a = 2 + rand() * 3
  const b = 1.5 + rand() * 2.5
  const p = rand() * 6.28
  const q = rand() * 6.28
  const cx = 0.25 + rand() * 0.5
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / cols
      const v = j / rows
      const wave =
        0.5 +
        0.28 * Math.sin(u * a * 6.28 + p + Math.sin(v * b * 6.28 + q) * 1.4) +
        0.22 * Math.sin(v * b * 6.28 - u * 3 + q)
      const current = Math.exp(-(((u - cx) * 2.2 + Math.sin(v * 5 + p) * 0.18) ** 2) / 0.03)
      const value = Math.min(1, Math.max(0, wave * 0.75 + current * 0.55 + (hash2(i, j) - 0.5) * 0.15))
      const k = rampIndex(value ** 1.6)
      if (k === 0) continue
      const hue = current > 0.5 ? HUE.ice : value > 0.6 ? HUE.cyan : HUE.blue
      ctx.fillStyle = COLORS[colorIndex(hue, Math.floor(2 + value * 7.5))]!
      ctx.fillText(RAMP[k]!, (i + 0.5) * cw, (j + 0.5) * ch)
    }
  }
  return out
}

function render() {
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx || !source || !el.width || !el.height) return
  const W = el.width
  const H = el.height

  const scale = props.fit === 'contain' ? Math.min(W / sourceW, H / sourceH) : Math.max(W / sourceW, H / sourceH)
  const dw = sourceW * scale
  const dh = sourceH * scale
  const dx = (W - dw) / 2
  const dy = (H - dh) / 2

  ctx.fillStyle = ABYSS
  ctx.fillRect(0, 0, W, H)

  if (props.cell <= 0) {
    ctx.imageSmoothingEnabled = !props.pixelArt
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, dx, dy, dw, dh)
    return
  }

  // Shrink the picture to one pixel per character, then draw a character
  // for each pixel: its brightness picks the character, its colour the hue.
  const dpr = W / el.clientWidth || 1
  const gw = props.cell * dpr
  const gh = gw * ASPECT
  const cols = Math.max(1, Math.ceil(W / gw))
  const rows = Math.max(1, Math.ceil(H / gh))
  scratch ??= document.createElement('canvas')
  scratch.width = cols
  scratch.height = rows
  const sctx = scratch.getContext('2d', { willReadFrequently: true })!
  sctx.fillStyle = ABYSS
  sctx.fillRect(0, 0, cols, rows)
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(source, (dx * cols) / W, (dy * rows) / H, (dw * cols) / W, (dh * rows) / H)
  const px = sctx.getImageData(0, 0, cols, rows).data

  const glyphs = tileGlyphs()
  const tw = (glyphs.tw / 24) * gw
  const th = (glyphs.th / (24 * ASPECT)) * gh
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const o = (r * cols + c) * 4
      const red = px[o]!
      const green = px[o + 1]!
      const blue = px[o + 2]!
      const lum = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
      const v = Math.min(1, lum ** 0.8 * 1.15)
      const k = rampIndex(v)
      if (k === 0) continue
      const ci = colorIndex(hueOf(red, green, blue), Math.floor(2 + v * 7.99))
      glyphs.draw(ctx, RAMP[k]!, ci, c * gw - (tw - gw) / 2, r * gh - (th - gh) / 2, tw, th)
    }
  }
}

watch(() => props.cell, render)

onMounted(async () => {
  if (props.src) {
    const img = new Image()
    img.src = props.src
    try {
      await img.decode()
      source = img
      sourceW = img.naturalWidth
      sourceH = img.naturalHeight
    } catch {
      source = null
    }
  }
  await monoReady(40)
  if (!alive || !box.value || !canvas.value) return
  if (!source) {
    source = makePattern(props.seed)
    sourceW = source.width
    sourceH = source.height
  }

  ro = new ResizeObserver(() => {
    const el = canvas.value
    const wrap = box.value
    if (!el || !wrap) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    el.width = Math.round(wrap.clientWidth * dpr)
    el.height = Math.round(wrap.clientHeight * dpr)
    render()
  })
  ro.observe(box.value)
})

onBeforeUnmount(() => {
  alive = false
  ro?.disconnect()
})
</script>

<template>
  <span ref="box" class="pixel-image">
    <img v-if="src" :src="src" :alt="alt" :class="{ 'is-contain': fit === 'contain' }" />
    <canvas ref="canvas" aria-hidden="true" />
  </span>
</template>
