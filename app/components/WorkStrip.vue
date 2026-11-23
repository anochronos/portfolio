<script setup lang="ts">
import { projects, pad } from '~/data/projects'

// A row of tiles that travels right to left as the page scrolls down.
// The section is made taller than the screen and its contents are pinned,
// so vertical scrolling has somewhere to go while the row slides sideways.
// Without JavaScript, or with reduced motion on, it is a plain row you swipe.
// Every other tile (is-front) stays in front of the sea life, which swims
// across the rest (see frontRects in SeaScene.vue).
const section = ref<HTMLElement>()
const pin = ref<HTMLElement>()
const track = ref<HTMLElement>()

const driven = ref(false)
const active = ref(0)

let step = 0 // distance from one tile to the next
let travel = 0 // how far the row slides in total
let rafId = 0

function tiles(): HTMLElement[] {
  return track.value ? (Array.from(track.value.children) as HTMLElement[]) : []
}

function measure() {
  const list = tiles()
  if (!section.value || list.length < 2) return
  step = list[1]!.offsetLeft - list[0]!.offsetLeft
  travel = step * (list.length - 1)
  section.value.style.height = driven.value ? window.innerHeight + travel + 'px' : ''
  update()
}

function update() {
  rafId = 0
  const list = tiles()
  if (!section.value || !track.value || !step) return

  if (driven.value) {
    const scrolled = -section.value.getBoundingClientRect().top
    const x = Math.min(travel, Math.max(0, scrolled))
    track.value.style.transform = `translate3d(${-x}px, 0, 0)`
  }

  // Which tile is nearest the middle of the screen, for the counter
  const middle = window.innerWidth / 2
  let nearest = 0
  let nearestDistance = Infinity
  list.forEach((tile, i) => {
    const rect = tile.getBoundingClientRect()
    const distance = Math.abs(rect.left + rect.width / 2 - middle) / step
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = i
    }
  })
  active.value = nearest
}

function schedule() {
  if (!rafId) rafId = requestAnimationFrame(update)
}

// Tabbing to a tile that is off screen scrolls the page to bring it to the middle.
function onFocus(index: number) {
  if (!driven.value || !section.value) return
  if (pin.value) pin.value.scrollLeft = 0
  const top = section.value.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top: top + index * step })
}

onMounted(() => {
  driven.value = !prefersReducedMotion()
  nextTick(measure)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', measure)
  track.value?.addEventListener('scroll', schedule, { passive: true })
  document.fonts?.ready.then(measure)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <section id="work" ref="section" class="work" :class="{ 'is-driven': driven }" data-glow data-zone="1">
    <div ref="pin" class="work-pin">
      <div class="grid section-head">
        <h2 class="section-label" data-flicker>
          <span class="sq" />Work
          <span class="num">{{ '{' + pad(active + 1) + '/' + pad(projects.length) + '}' }}</span>
        </h2>
      </div>

      <ul ref="track" class="work-track">
        <li v-for="(project, i) in projects" :key="project.slug" :class="{ 'is-front': i % 2 === 0 }">
          <NuxtLink class="tile" :to="`/work/${project.slug}`" @focus="onFocus(i)">
            <AsciiImage
              class="tile-media"
              :src="project.image"
              :seed="project.slug"
              :fit="project.fit"
              :pixel-art="project.pixelArt"
            />
            <span class="tile-title">{{ project.title }}</span>
            <AsciiFrame :seed="i + 1" />
          </NuxtLink>
        </li>
      </ul>
    </div>
  </section>
</template>
