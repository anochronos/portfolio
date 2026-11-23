<script setup lang="ts">
import { projects, pad } from '~/data/projects'

const route = useRoute()
const index = projects.findIndex((p) => p.slug === route.params.slug)
if (index === -1) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}
const project = projects[index]!
const next = projects[(index + 1) % projects.length]!

useHead({ title: `${project.title} | Akshun Kalra` })
useSeoMeta({ description: project.summary[0] })
useReveal()

// The picture starts as big characters and resolves in a few steps.
const cell = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  if (prefersReducedMotion()) return
  const steps = [32, 21, 14, 9, 6, 0]
  let i = 0
  cell.value = steps[0]!
  timer = setInterval(() => {
    i += 1
    cell.value = steps[i]!
    if (i === steps.length - 1) clearInterval(timer)
  }, 130)
})

onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div>
    <main id="main" class="project">
      <div class="grid project-top">
        <NuxtLink class="project-back" :to="{ path: '/', hash: '#work' }">All work</NuxtLink>
        <p class="num">{{ '{' + pad(index + 1) + '/' + pad(projects.length) + '}' }}</p>
      </div>

      <div class="grid project-head" data-glow data-zone="2">
        <h1 class="project-title">{{ project.title }}</h1>
        <p class="project-kind">{{ project.kind }}</p>
      </div>

      <div class="grid">
        <span class="frame project-frame">
          <AsciiImage
            class="project-media"
            :src="project.image"
            :alt="project.imageAlt"
            :seed="project.slug"
            :fit="project.fit"
            :pixel-art="project.pixelArt"
            :cell="cell"
          />
          <AsciiFrame :seed="index + 1" />
        </span>
      </div>

      <div class="grid project-body" data-glow data-zone="3">
        <div class="project-text">
          <p v-for="paragraph in project.summary" :key="paragraph">{{ paragraph }}</p>
          <p class="project-tech">Built with {{ project.tech }}.</p>
          <p v-if="project.source">
            <a :href="project.source" target="_blank" rel="noopener">View the code on GitHub</a>
          </p>
        </div>
      </div>

      <div class="grid project-next">
        <p class="section-label"><span class="sq" />Next</p>
        <NuxtLink :to="`/work/${next.slug}`">{{ next.title }}</NuxtLink>
      </div>
    </main>
    <ContactFooter />
  </div>
</template>
