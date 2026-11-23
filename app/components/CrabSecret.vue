<script setup lang="ts">
// The crab on the sea floor knows about the hidden game (ArcadeMode.vue).
// Once you've been at the bottom of the page a moment it stops scuttling and
// whispers in a speech bubble; each click (or Enter) on the bubble gets the
// next line out of it, and the last one lets you straight into the game. If
// you've heard it all before, it just offers you another go.
// The sea says where the crab is ('surface' messages, via seaSurface) and
// stands it still while it talks ('sea:crab').
import { seaSurface } from '~/utils/water'
import { clack } from '~/utils/sound'

const SEEN_KEY = 'sea-crab'
const TYPE = 30 // characters a second

const fine = import.meta.client && window.matchMedia('(hover: hover) and (pointer: fine)').matches
const LINES = [
  'psst. psst.',
  'wanna hear a secret?',
  "there's a game down here.",
  fine ? 'type dive anywhere, or tap the moon three times.' : 'tap the moon three times, up top.',
  'or i could just let you in. go on.',
]
const AGAIN = ['back for another dive?']

const shown = ref(false)
const text = ref('')
const full = ref('')
const bubble = ref<HTMLElement>()
const tail = ref<SVGSVGElement>()

let lines = LINES
let line = 0
let frame = 0
let typedAt = 0
let nearSince = 0
let gone = false // finished for this visit
let playing = false
const reduce = import.meta.client ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

const waiting = computed(() => text.value.length >= full.value.length)

function say(i: number) {
  line = i
  full.value = lines[i]!
  text.value = reduce?.matches ? full.value : ''
  typedAt = performance.now()
}

function show() {
  let seen = false
  try {
    seen = localStorage.getItem(SEEN_KEY) === 'yes'
  } catch {}
  lines = seen ? AGAIN : LINES
  say(0)
  shown.value = true
  window.dispatchEvent(new CustomEvent('sea:crab', { detail: true }))
  if (seaSurface.crab) clack(seaSurface.crab.x)
}

function hide() {
  if (!shown.value) return
  shown.value = false
  window.dispatchEvent(new CustomEvent('sea:crab', { detail: false }))
}

// A click: finish typing the line, or go on to the next
function next() {
  if (!waiting.value) {
    text.value = full.value
    return
  }
  if (seaSurface.crab) clack(seaSurface.crab.x)
  if (line + 1 < lines.length) {
    say(line + 1)
    return
  }
  try {
    localStorage.setItem(SEEN_KEY, 'yes')
  } catch {}
  gone = true
  hide()
  window.dispatchEvent(new Event('sea:play'))
}

// Each frame: is the crab on screen, and if it's talking, type and follow it
function tick(now: number) {
  frame = requestAnimationFrame(tick)
  const crab = seaSurface.crab
  const onScreen = !!crab && crab.y > 40 && crab.y < window.innerHeight - 10 && !playing && !gone
  if (!onScreen) {
    nearSince = 0
    hide()
    return
  }
  if (!shown.value) {
    if (!nearSince) nearSince = now
    if (now - nearSince > 1400) show()
    return
  }
  if (text.value.length < full.value.length) {
    text.value = full.value.slice(0, Math.floor(((now - typedAt) / 1000) * TYPE) + 1)
  }
  const b = bubble.value
  const t = tail.value
  if (!b || !t || !crab) return
  const w = b.offsetWidth
  const h = b.offsetHeight
  const m = 12
  const x = Math.max(m, Math.min(window.innerWidth - m - w, crab.x - w / 2))
  b.style.transform = `translate3d(${x}px, ${crab.y - h - 16}px, 0)`
  t.style.left = `${Math.max(10, Math.min(w - 24, crab.x - x - 7))}px`
}

function onArcade(e: Event) {
  playing = !!(e as CustomEvent<boolean>).detail
  if (playing) hide()
}

onMounted(() => {
  frame = requestAnimationFrame(tick)
  window.addEventListener('sea:arcade', onArcade)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  hide()
  window.removeEventListener('sea:arcade', onArcade)
})
</script>

<template>
  <div class="crab-say" :class="{ 'is-shown': shown }">
    <button
      v-if="shown"
      ref="bubble"
      type="button"
      class="ship-call-bubble crab-bubble"
      :style="{ '--chars': full.length + 2 }"
      :aria-label="`The crab says: ${full}`"
      @click="next"
    >
      <span aria-hidden="true">{{ text }}</span
      ><span class="ship-call-caret" aria-hidden="true">{{ waiting ? ' >' : '_' }}</span
      ><svg ref="tail" class="ship-call-tail" viewBox="0 0 14 10" width="14" height="10" aria-hidden="true"><path d="M0 0.5 L7 9.5 L14 0.5" /></svg
    ></button>
  </div>
</template>
