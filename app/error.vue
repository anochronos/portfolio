<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)

useHead({ title: (notFound.value ? 'Page not found' : 'Something went wrong') + ' | Akshun Kalra' })
</script>

<template>
  <main class="error-page">
    <p class="section-label"><span class="sq" />{{ error.statusCode }}</p>
    <h1>{{ notFound ? 'This page does not exist.' : 'Something went wrong.' }}</h1>
    <p>
      <a href="/">Go to the home page</a>
    </p>
  </main>
</template>
