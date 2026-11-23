<script setup lang="ts">
// Turns the sea's sound (utils/sound.ts) on and off, and sets its volume. It
// sits in the top corner: a small speaker in characters, with waves coming
// off it when the sound is on, and beside it a meter of bars that slides out
// when you point at it or tab to it. Click or drag along the bars to set the
// volume; the lit ones flicker with what's playing. The bars are drawn over
// an ordinary range input, which does the dragging, the arrow keys and the
// screen reader's part. On to begin with.
import { initSound, soundOn, toggleSound, soundVolume, setVolume, soundLevel } from '~/utils/sound'

const BARS = 8

const on = ref(false)
const volume = ref(0.5)
const level = ref(0)
const config = useRuntimeConfig()
let stop = () => {}
let frame = 0
let looking = false

const lit = computed(() => Math.round(volume.value * BARS))

function sync(e?: Event) {
  on.value = e ? !!(e as CustomEvent<boolean>).detail : soundOn()
}

function onVolume(e: Event) {
  volume.value = Number((e.target as HTMLInputElement).value) / 100
  setVolume(volume.value)
}

// Only follow the sound's level while the meter is out
function flicker() {
  frame = requestAnimationFrame(flicker)
  level.value += (soundLevel() - level.value) * 0.35
}
function look(v: boolean) {
  if (v === looking) return
  looking = v
  cancelAnimationFrame(frame)
  if (v && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) frame = requestAnimationFrame(flicker)
  else level.value = 0
}

onMounted(() => {
  const cleanup = initSound(`${config.app.baseURL}audio/bread.mp3`)
  sync()
  volume.value = soundVolume()
  window.addEventListener('sea:sound', sync)
  stop = () => {
    cleanup()
    cancelAnimationFrame(frame)
    window.removeEventListener('sea:sound', sync)
  }
})

onBeforeUnmount(() => stop())
</script>

<template>
  <div
    class="sound-control"
    :class="{ 'is-on': on }"
    :style="{ '--level': level.toFixed(3) }"
    @mouseenter="look(true)"
    @mouseleave="look(false)"
    @focusin="look(true)"
    @focusout="look(false)"
  >
    <label class="sound-meter">
      <span class="sound-bars" aria-hidden="true"
        ><i v-for="k in BARS" :key="k" :class="{ 'is-lit': k <= lit }" :style="{ '--k': k }"
      /></span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        :value="Math.round(volume * 100)"
        aria-label="Volume"
        @input="onVolume"
      />
    </label>
    <button
      type="button"
      class="sound-switch"
      :class="{ 'is-on': on }"
      :aria-pressed="on"
      aria-label="Sound"
      :title="on ? 'Sound on' : 'Sound off'"
      @click="toggleSound"
    >
      <span class="sound-icon" aria-hidden="true"
        ><span>&lt;|</span><span class="sound-waves">{{ on ? ')))' : ' ' }}</span></span
      >
      <span class="sound-word" aria-hidden="true">{{ on ? 'sound on' : 'sound off' }}</span>
    </button>
  </div>
</template>
