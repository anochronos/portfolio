<script setup lang="ts">
// A depth gauge down the right edge, in place of the scrollbar (which is
// hidden, see main.css). It reads 0 m at the surface and DEEPEST at the
// bottom of the page, and the deeper you go the faster the metres pile up,
// so the marks crowd together toward the seabed. Drag the marker, or click
// anywhere along it, to go to that depth. The reading beside the marker
// shows while you're scrolling, pointing at the gauge or dragging it.
// The page still scrolls every usual way; this is an extra, so it's hidden
// from screen readers.
const DEEPEST = 4000 // metres, at the bottom of the page
const CURVE = 1.5 // how much faster the depth grows further down
const STEP = 250 // metres between marks

const depth = ref(0)
const at = ref(0) // how far down the page, 0 to 1
const dragging = ref(false)
const scrolling = ref(false)
let quiet = 0
const gauge = ref<HTMLElement>()

// Marks at every STEP metres, placed where that depth falls on the gauge
const marks = Array.from({ length: DEEPEST / STEP + 1 }, (_, i) => {
  const m = i * STEP
  return { m, at: Math.pow(m / DEEPEST, 1 / CURVE), major: m % 1000 === 0 }
})

const reading = computed(() => `${Math.round(depth.value).toLocaleString('en-US')} m`)

// How far the page can scroll, measured when its size changes rather than on
// every scroll, which would make the browser lay the page out again
let room = 0
const measure = () => {
  room = document.documentElement.scrollHeight - window.innerHeight
  read()
}

let frame = 0
function read() {
  frame = 0
  at.value = room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 0
  depth.value = DEEPEST * Math.pow(at.value, CURVE)
}
const onScroll = () => {
  if (!frame) frame = requestAnimationFrame(read)
  scrolling.value = true
  clearTimeout(quiet)
  quiet = window.setTimeout(() => (scrolling.value = false), 1200)
}

// Pointing along the gauge: go to that point of the page
function goTo(e: PointerEvent, smooth: boolean) {
  const g = gauge.value
  if (!g) return
  const r = g.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: f * room, behavior: smooth && !reduce ? 'smooth' : 'auto' })
}

// A click glides to that depth; a drag follows the pointer exactly
let downY = 0
let moved = false
function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  dragging.value = true
  downY = e.clientY
  moved = false
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!dragging.value) return
  if (!moved && Math.abs(e.clientY - downY) < 4) return
  moved = true
  goTo(e, false)
}
function onUp(e: PointerEvent) {
  if (dragging.value && !moved && e.type === 'pointerup') goTo(e, true)
  dragging.value = false
}

let sized: ResizeObserver | null = null

onMounted(() => {
  measure()
  sized = new ResizeObserver(measure)
  sized.observe(document.body)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  clearTimeout(quiet)
  sized?.disconnect()
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <div
    class="depth-meter"
    :class="{ 'is-dragging': dragging, 'is-reading': scrolling }"
    aria-hidden="true"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <div ref="gauge" class="depth-gauge">
      <i v-for="k in marks" :key="k.m" :class="{ 'is-major': k.major }" :style="{ top: `${k.at * 100}%` }" />
      <span class="depth-end depth-top" :class="{ 'is-near': at < 0.05 }">0</span>
      <span class="depth-end depth-bottom" :class="{ 'is-near': at > 0.95 }">{{ DEEPEST.toLocaleString('en-US') }}</span>
      <!-- The track is as tall as the gauge, so moving it by a share of its
           own height moves the marker that far down the gauge, without the
           browser laying anything out again -->
      <span class="depth-track" :style="{ transform: `translateY(${(at * 100).toFixed(2)}%)` }"
        ><span class="depth-mark"
          ><span class="depth-reading">{{ reading }}</span><span class="depth-pointer">&lt;</span></span
        ></span
      >
    </div>
  </div>
</template>
