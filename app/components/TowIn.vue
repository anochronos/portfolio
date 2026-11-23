<script setup lang="ts">
// The opening: the boat sails in from the left towing the first name behind
// it on a rope, and the big jellyfish swims up from the deep carrying the
// surname on top of its bell. Once the names are in place the rope goes slack
// and fades, and the jellyfish lets go, sinks away and drifts aside.
//
// The names are moved by their groups in HeroSection.vue (.tow-first and
// .tow-last), which CSS starts off screen so they never flash in place first
// (see "Tow" in main.css). The boat and the jellyfish are the sea's, so it's
// told where they should be: how far the first name still has to go
// ('sea:tow') and where the bottom of the surname is ('sea:lift'). The rope is
// drawn here, in a layer over the page.
// With reduced motion, or if the page opens scrolled down, there's no
// opening: the names are simply where they belong.
import { seaSurface, tow } from '~/utils/water'

const FIRST = { delay: 150, dur: 2600 }
const LAST = { delay: 450, dur: 3400 }
const HOLD = 450 // the jellyfish holds the surname in place a moment before letting go
const LET_GO = 1500 // how long the rope takes to go slack and fade

const on = ref(false)
const rope = ref('')
const ropeFade = ref(1)
const clamp = (t: number) => Math.max(0, Math.min(1, t))
const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3)
// The jellyfish rises more evenly, beat by beat, and settles at the end
const swim = (t: number) => 1 - Math.pow(1 - clamp(t), 2)

let frame = 0
let groups: SVGGElement[] = []

function place(dxFirst: number, dxLast: number, unit: number) {
  tow.first = dxFirst
  tow.last = dxLast
  // A group's translate is in the SVG's units
  groups[0]!.style.transform = `translateX(${dxFirst / unit}px)`
  groups[1]!.style.transform = `translateY(${dxLast / unit}px)`
  window.dispatchEvent(new CustomEvent('sea:tow', { detail: dxFirst }))
}

function settle() {
  tow.first = 0
  tow.last = 0
  for (const g of groups) g.style.transform = 'none'
  window.dispatchEvent(new CustomEvent('sea:tow', { detail: 0 }))
  letGo()
}

let holding = false
function letGo() {
  if (!holding) return
  holding = false
  window.dispatchEvent(new CustomEvent('sea:lift', { detail: null }))
}

onMounted(async () => {
  const svg = document.querySelector<SVGSVGElement>('svg[data-water-y]')
  groups = [...document.querySelectorAll<SVGGElement>('.tow-first, .tow-last')]
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!svg || groups.length < 2 || reduce || window.scrollY > 10) {
    if (groups.length === 2) settle()
    return
  }

  // Wait for the font and the hero's own layout, so the names are measured
  // at their real size and place
  await document.fonts?.ready
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  for (const g of groups) g.style.transform = 'none'
  const firstText = groups[0]!.querySelector('text')!
  const lastText = groups[1]!.querySelector('text')!
  const a = firstText.getBoundingClientRect()
  const b = lastText.getBoundingClientRect()
  const box = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  const unit = box.width / vb.width
  const baseline = box.top + (0 - vb.y) * unit
  const far1 = a.right + 120 // far enough left that the first name is off screen
  const far2 = window.innerHeight - b.top + 60 // and the surname below the bottom of the screen
  place(-far1, far2, unit)
  on.value = true

  const start = performance.now()
  let doneAt = 0

  const step = (now: number) => {
    frame = requestAnimationFrame(step)
    // Scrolling away skips to the end: the names in place, nothing left hanging
    if (window.scrollY > 10) {
      cancelAnimationFrame(frame)
      settle()
      on.value = false
      return
    }
    const t = now - start
    const p1 = ease((t - FIRST.delay) / FIRST.dur)
    const p2 = ease((t - LAST.delay) / LAST.dur)
    const dx1 = -far1 * (1 - p1)
    const p2s = swim((t - LAST.delay) / LAST.dur)
    const dx2 = far2 * (1 - p2s)
    place(Math.abs(dx1) < 0.3 ? 0 : dx1, Math.abs(dx2) < 0.3 ? 0 : dx2, unit)
    // The jellyfish under the surname, until it lets go
    if (t < LAST.delay + LAST.dur + HOLD) {
      holding = true
      window.dispatchEvent(new CustomEvent('sea:lift', { detail: { x: b.left + b.width / 2, bottom: b.bottom + dx2 } }))
    } else letGo()
    const arrived = p1 >= 1 && p2 >= 1 && !holding
    if (arrived && !doneAt) doneAt = now
    const gone = doneAt ? (now - doneAt) / LET_GO : 0

    // The rope: from the stern of the boat back to the end of the first
    // name, sagging toward the water, going slack and fading once it's in
    const boat = seaSurface.boat
    const cw = seaSurface.cw
    const ch = seaSurface.amp / 0.75
    ropeFade.value = 1 - Math.min(1, gone * 1.6)
    if (boat && ch) {
      // Where the stern is, worked out the way the sea places the boat (see
      // `bc` in utils/sea/engine.ts) with this frame's offset, since the
      // boat's reported position arrives a frame or two late while it moves
      const W = window.innerWidth
      const centre = W * (W < 768 ? 0.6 : 0.74) + Math.sin(seaSurface.clock * 0.04) * W * 0.05 + dx1
      const sx = (Math.round(centre / cw) - 25 + 0.5) * cw
      const sy = boat.y + 6.6 * ch
      const ex = a.right + dx1 - 4 * unit
      const ey = baseline - 34 * unit
      if (sx > ex + 6) {
        const sag = 16 + Math.min(1, gone * 2) * 26
        rope.value = `M${ex.toFixed(1)} ${ey.toFixed(1)} Q${((sx + ex) / 2).toFixed(1)} ${(Math.max(sy, ey) + sag).toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)}`
      } else rope.value = ''
    }

    if (gone >= 1) {
      cancelAnimationFrame(frame)
      settle()
      on.value = false
    }
  }
  frame = requestAnimationFrame(step)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  if (groups.length === 2) settle()
})
</script>

<template>
  <svg v-if="on" class="tow-in" aria-hidden="true" focusable="false">
    <path v-if="rope" class="tow-rope" :d="rope" :style="{ opacity: ropeFade }" />
  </svg>
</template>
