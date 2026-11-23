<script setup lang="ts">
// A fishing line that lowers a hook into the reef once you've stayed at the
// bottom of the page for a moment. Click it, or tab to it and press
// Enter, and it reels you back up to the top. Scroll away first and it's
// pulled back out of the water.
import { reel as reelSound } from '~/utils/sound'

const HOOK = [' o', ' |', ' |  ^', ' |  |', ' \\__/'].join('\n')
const WAIT = 1500

const route = useRoute()
const shown = ref(false)
const reeling = ref(false)
let timer = 0

function atBottom(): boolean {
  return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 60
}

function check() {
  if (reeling.value) return
  if (atBottom()) {
    if (!shown.value && !timer) {
      timer = window.setTimeout(() => {
        timer = 0
        if (atBottom()) shown.value = true
      }, WAIT)
    }
  } else {
    clearTimeout(timer)
    timer = 0
    shown.value = false
  }
}

function reel() {
  reelSound()
  reeling.value = true
  shown.value = false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  // Keyboard users land back at the start of the page
  const main = document.getElementById('main')
  if (main) {
    main.tabIndex = -1
    main.focus({ preventScroll: true })
  }
  window.setTimeout(() => (reeling.value = false), 1600)
}

const stopRoute = watch(
  () => route.path,
  () => {
    clearTimeout(timer)
    timer = 0
    shown.value = false
    nextTick(check)
  },
)

onMounted(() => {
  window.addEventListener('scroll', check, { passive: true })
  window.addEventListener('resize', check)
  check()
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  stopRoute()
  window.removeEventListener('scroll', check)
  window.removeEventListener('resize', check)
})
</script>

<template>
  <button
    class="hook"
    :class="{ 'is-shown': shown, 'is-reeling': reeling }"
    type="button"
    :tabindex="shown ? 0 : -1"
    :aria-hidden="!shown"
    @click="reel"
  >
    <span class="hook-swing" aria-hidden="true">
      <span class="hook-line" />
      <span class="hook-art">{{ HOOK }}</span>
    </span>
    <span class="hook-label">Back to the surface</span>
  </button>
</template>
