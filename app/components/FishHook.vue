<script setup lang="ts">
// A fishing line that lowers a hook into the reef once you've stayed at the
// bottom of the page for a moment. Click it, or tab to it and press
// Enter, and it reels you back up to the top. Scroll away first and it's
// pulled back out of the water.
// On phones the contact links span the whole width, so the hook hangs just
// above them rather than over them.
import { reel as reelSound } from '~/utils/sound'

const HOOK = [' o', ' |', ' |  ^', ' |  |', ' \\__/'].join('\n')
const WAIT = 1500

const route = useRoute()
const shown = ref(false)
const button = ref<HTMLButtonElement>()
const reeling = ref(false)
let timer = 0

function atBottom(): boolean {
  return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 60
}

// On phones, sit the hook's bottom just above the first contact link
function place() {
  const el = button.value
  if (!el) return
  const first = document.querySelector('.contact-links a')
  if (window.innerWidth > 768 || !first) {
    el.style.removeProperty('bottom')
    return
  }
  // Where the link's letters start, once the page is at the bottom
  const room = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
  const top = first.getBoundingClientRect().top - room
  el.style.bottom = `${Math.round(Math.max(0, window.innerHeight - top + 6))}px`
}

function check() {
  if (reeling.value) return
  if (atBottom()) {
    if (!shown.value && !timer) {
      timer = window.setTimeout(() => {
        timer = 0
        if (atBottom()) {
          place()
          shown.value = true
        }
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

const onResize = () => {
  place()
  check()
}

onMounted(() => {
  window.addEventListener('scroll', check, { passive: true })
  window.addEventListener('resize', onResize)
  check()
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  stopRoute()
  window.removeEventListener('scroll', check)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <button
    ref="button"
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
