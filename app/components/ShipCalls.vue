<script setup lang="ts">
// Now and then the boat's crew calls out, in a speech bubble above the
// flag, with a blip on the radio: a nudge to click the water (which is
// also what lets the sound start), to head down to the work, and to try
// holding the moon. One at a time, only while you're up at the surface, and
// each one stops once you've done what it suggests. The first two stay up
// until they're done, one after the other: click the water, then scroll down
// (this is the page's only scroll cue). Nothing else is said before then.
// It's decoration: everything it points to works without it, so it's hidden
// from screen readers.
import { seaSurface } from '~/utils/water'
import { soundOn, soundPlaying, chirp } from '~/utils/sound'
import { isDay } from '~/utils/theme'

interface Call {
  id: string
  text: () => string
  wanted: () => boolean
  // Stays up, and comes back whenever you're at the surface, until it's done
  sticky?: boolean
}

const FIRST = 3400 // after the name has drawn itself
const GAP = 6000 // between calls
const HOLD = 4200 // how long a call stays up once it's typed
const TYPE = 32 // characters a second

const done = new Set<string>()
const CALLS: Call[] = [
  {
    id: 'water',
    text: () => (soundOn() && !soundPlaying() ? 'click the water to hear the sea' : "click the water. we'll ping back"),
    wanted: () => !done.has('water'),
    sticky: true,
  },
  { id: 'dive', text: () => "the work's below deck. scroll down ↓", wanted: () => !done.has('dive'), sticky: true },
  {
    id: 'moon',
    text: () => (isDay() ? 'psst. hold down the sun' : 'psst. hold down the moon'),
    wanted: () => !done.has('moon'),
  },
]

const text = ref('') // what's been typed so far
const full = ref('') // the whole line, which sets the bubble's size
const shown = ref(false)
const call = ref<Call | null>(null)
const bubble = ref<HTMLElement>()
const tail = ref<SVGSVGElement>()

let index = 0
let timer = 0
let frame = 0
let typedAt = 0

const reduce = import.meta.client ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
const atSurface = () => window.scrollY < window.innerHeight * 0.2 && !document.hidden

function schedule(ms: number) {
  clearTimeout(timer)
  timer = window.setTimeout(say, ms)
}

function say() {
  if (!atSurface() || !seaSurface.boat) {
    schedule(1500)
    return
  }
  // A sticky call that's still wanted comes first; otherwise the next call
  // that's still worth making
  let c = CALLS.find((k) => k.sticky && k.wanted())
  if (!c) {
    while (index < CALLS.length && (CALLS[index]!.sticky || !CALLS[index]!.wanted())) index++
    c = CALLS[index++]
  }
  if (!c) return
  call.value = c
  full.value = c.text()
  text.value = reduce?.matches ? full.value : ''
  typedAt = performance.now()
  shown.value = true
  chirp(seaSurface.boat.x)
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(follow)
  clearTimeout(timer)
  if (!c.sticky) timer = window.setTimeout(() => hush(), full.value.length * (1000 / TYPE) + HOLD)
}

// Hide the current call; `reply` swaps in a short answer first
function hush(reply?: string) {
  if (!shown.value) return
  clearTimeout(timer)
  if (reply) {
    full.value = reply
    text.value = reply
    timer = window.setTimeout(() => hush(), 1600)
    return
  }
  // If a sticky call is still to be done (this one, put away because you
  // scrolled off, or the next), it comes up soon
  const back = CALLS.some((k) => k.sticky && k.wanted())
  shown.value = false
  call.value = null
  schedule(back ? 1200 : GAP)
}

// Each frame: type the next characters and keep the call by the flag
function follow(now: number) {
  frame = requestAnimationFrame(follow)
  const boat = seaSurface.boat
  if (!boat || !atSurface()) {
    hush()
    return
  }
  if (text.value.length < full.value.length) {
    text.value = full.value.slice(0, Math.floor(((now - typedAt) / 1000) * TYPE) + 1)
  }
  const b = bubble.value
  const t = tail.value
  if (!b || !t) return
  // Sit the bubble above the flag with its tail pointing down at it, kept
  // on screen; if it has to shift, the tail slides along to stay on the flag
  const w = b.offsetWidth
  const h = b.offsetHeight
  const m = 12
  const x = Math.max(m, Math.min(window.innerWidth - m - w, boat.x - w * 0.8))
  b.style.transform = `translate3d(${x}px, ${boat.y - h - 14}px, 0)`
  t.style.left = `${Math.max(10, Math.min(w - 24, boat.x - x - 7))}px`
}

function onDown(e: PointerEvent) {
  if ((e.target as Element | null)?.closest?.('a, button, input, textarea, select, label, .depth-meter')) return
  // Clicking the water: the crew is satisfied
  if (!done.has('water')) {
    done.add('water')
    if (call.value?.id === 'water') hush('there she is')
  }
}

function onTheme() {
  done.add('moon')
  if (call.value?.id === 'moon') hush('nice')
}

function onScroll() {
  if (window.scrollY > window.innerHeight * 0.5) done.add('dive')
}

function onHide() {
  if (document.hidden) hush()
}

watch(shown, (v) => {
  if (!v) window.setTimeout(() => !shown.value && cancelAnimationFrame(frame), 700)
})

onMounted(() => {
  schedule(FIRST)
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('sea:theme', onTheme)
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('visibilitychange', onHide)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  cancelAnimationFrame(frame)
  window.removeEventListener('pointerdown', onDown, true)
  window.removeEventListener('sea:theme', onTheme)
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('visibilitychange', onHide)
})
</script>

<template>
  <div class="ship-call" :class="{ 'is-shown': shown }" aria-hidden="true">
    <!-- No spaces inside: the bubble keeps its text's spacing as written -->
    <p ref="bubble" class="ship-call-bubble" :style="{ '--chars': full.length + 1 }"
      >{{ text }}<span class="ship-call-caret">{{ text.length < full.length ? '_' : '' }}</span
      ><svg ref="tail" class="ship-call-tail" viewBox="0 0 14 10" width="14" height="10"><path d="M0 0.5 L7 9.5 L14 0.5" /></svg
    ></p>
  </div>
</template>
