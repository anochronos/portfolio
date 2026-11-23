<script setup lang="ts">
// The name is SVG text so its outline can be traced on load (see
// "name-trace" in main.css). On wide screens it sits on one line with the
// surname a little lower; on phones it stacks, both lines centred.
// The numbers are in SVG units at a font size of 100.
//
// The first name floats on the surface: each letter rides the swell under it
// (nameRide in utils/water.ts, the same waves the sea draws) by moving and
// tilting its own glyph with the text's per-character dy and rotate lists, so
// the word stays one <text> and its outline trace still works.
import { nameRide, NAME_TILT, seaSurface, waveAt, tow } from '~/utils/water'

const GAP = 24 // space between the names on one line
const DROP = 100 // how far the surname sits below the first name, under water
const LEADING = 118 // line spacing when stacked
const WATER = -7 // the waterline, a little above the first name's baseline, so it sits in the water
// Below the surface the first name is seen through the water: a copy of it in
// the water's colour, clipped to below the moving wave line (CLIP), lies over
// it. Until the waves are known the line is flat at the waterline.
const CLIP = 'name-water'
const FLAT = `M-9999 ${WATER}H9999V9999H-9999Z`

// On load the boat tows the first name in and fish pull the surname in
// (TowIn.vue), by moving each name's group, so the measurements here leave
// those groups' offsets out.
const svg = ref<SVGSVGElement>()
const first = ref<SVGTextElement>()
const wet = ref<SVGTextElement>()
const wave = ref<SVGPathElement>()
const last = ref<SVGTextElement>()

// Measured in a browser with the site font; replaced by real measurements on load.
const firstX = ref(0)
const lastX = ref(351)
const lastY = ref(DROP)
const anchor = ref<'start' | 'middle'>('start')
const viewBox = ref('-4 -101 570 229')

function layout() {
  const a = first.value
  const b = last.value
  const root = svg.value
  if (!a || !b || !root) return

  if (window.innerWidth < 768) {
    anchor.value = 'middle'
    firstX.value = 0
    lastX.value = 0
    lastY.value = LEADING
  } else {
    anchor.value = 'start'
    firstX.value = 0
    lastX.value = a.getComputedTextLength() + GAP
    lastY.value = DROP
  }

  nextTick(() => {
    // The two names' own boxes, not their group's, which would take in where
    // they are while being towed in
    const p = a.getBBox()
    const q = b.getBBox()
    const x0 = Math.min(p.x, q.x)
    const y0 = Math.min(p.y, q.y)
    const box = { x: x0, y: y0, width: Math.max(p.x + p.width, q.x + q.width) - x0, height: Math.max(p.y + p.height, q.y + q.height) - y0 }
    const pad = 4
    viewBox.value = [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2]
      .map((n) => Math.round(n))
      .join(' ')
    nextTick(measureLetters)
  })
}

// ---- riding the swell ------------------------------------------------------
// Each letter's centre and width on screen, and screen pixels per SVG unit.
// Only horizontal positions matter, and those don't change with scrolling.
let letters: { x: number; w: number }[] = []
let unit = 1
let left = 0 // the SVG's left edge on screen
let vbX = 0
let vbW = 0
let rideId = 0
let lastClock = NaN
let inView = true

function measureLetters() {
  const a = first.value
  const root = svg.value
  const vb = root?.viewBox.baseVal
  if (!a || !root || !vb?.width) return
  const r = root.getBoundingClientRect()
  unit = r.width / vb.width
  left = r.left
  vbX = vb.x
  vbW = vb.width
  letters = []
  for (let i = 0; i < a.getNumberOfChars(); i++) {
    const e = a.getExtentOfChar(i)
    letters.push({ x: r.left + (e.x + e.width / 2 - vb.x) * unit, w: e.width * unit })
  }
  lastClock = NaN
}

function ride() {
  rideId = requestAnimationFrame(ride)
  const a = first.value
  const { clock, amp, cw } = seaSurface
  if (!a || !inView || !letters.length || !amp || clock === lastClock) return
  lastClock = clock
  // Offsets go in as dy, each relative to the letter before: absolute y
  // values would split the word into pieces that are each centred on their
  // own when the name is centred (on phones)
  const dys: string[] = []
  const turns: string[] = []
  let prev = 0
  for (const l of letters) {
    const lx = l.x + tow.first // where it is now, if it's still being towed in
    const left = nameRide(lx - l.w / 3, clock, amp, cw)
    const right = nameRide(lx + l.w / 3, clock, amp, cw)
    const lean = (Math.atan((right - left) / ((l.w * 2) / 3)) * 180) / Math.PI
    const y = Math.round((nameRide(lx, clock, amp, cw) / unit) * 100) / 100
    dys.push((y - prev).toFixed(2))
    prev = y
    turns.push(Math.max(-NAME_TILT, Math.min(NAME_TILT, lean)).toFixed(2))
  }
  for (const t of [a, wet.value]) {
    t?.setAttribute('dy', dys.join(' '))
    t?.setAttribute('rotate', turns.join(' '))
  }
  drawWave(clock, amp, cw)
}

// The wave line across the name, in the SVG's units: the same surface the
// sea draws (see surfaceY in utils/water.ts), dropped to where its line of
// characters sits
function drawWave(clock: number, amp: number, cw: number) {
  const p = wave.value
  if (!p || !vbW) return
  const drop = (amp / 0.75) * 0.15 // a little below the middle of the wave's row
  const step = Math.max(4, cw)
  // The clip moves with the name's group, so take back any tow offset
  const shift = tow.first
  let d = ''
  for (let x = Math.min(left, left + shift) - step; x <= left + vbW * unit + step; x += step) {
    const y = WATER + (amp * waveAt(x / cw, clock) + drop) / unit
    d += `${d ? 'L' : 'M'}${(vbX + (x - left - shift) / unit).toFixed(1)} ${y.toFixed(1)}`
  }
  p.setAttribute('d', `${d}V9999H-9999Z`)
}

let seen: IntersectionObserver | null = null

onMounted(() => {
  layout()
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    seen = new IntersectionObserver(([e]) => (inView = !!e?.isIntersecting))
    if (svg.value) seen.observe(svg.value)
    rideId = requestAnimationFrame(ride)
  }
  document.fonts?.ready.then(layout)
  window.addEventListener('resize', layout)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rideId)
  seen?.disconnect()
  window.removeEventListener('resize', layout)
})
</script>

<template>
  <section id="top" class="hero" data-glow data-zone="0">
    <h1 class="hero-name">
      <span class="sr-only">Akshun Kalra</span>
      <svg ref="svg" :viewBox="viewBox" :data-water-y="WATER" aria-hidden="true" focusable="false">
        <g>
          <clipPath :id="CLIP">
            <path ref="wave" :d="FLAT" />
          </clipPath>
          <g class="tow tow-first">
            <text ref="first" :x="firstX" y="0" :text-anchor="anchor">Akshun</text>
            <text ref="wet" class="hero-wet" :x="firstX" y="0" :text-anchor="anchor" :clip-path="`url(#${CLIP})`">Akshun</text>
          </g>
          <g class="tow tow-last">
            <text ref="last" class="hero-under" :x="lastX" :y="lastY" :text-anchor="anchor">Kalra</text>
          </g>
        </g>
      </svg>
    </h1>
    <TowIn />
  </section>
</template>
