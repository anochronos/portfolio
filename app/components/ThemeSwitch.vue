<script setup lang="ts">
// The keyboard way to switch day and night (with a mouse you hold down the
// moon). It stays out of sight until it's tabbed to.
import { isDay, toggleDay } from '~/utils/theme'

const day = ref(false)
const sync = () => (day.value = isDay())

onMounted(() => {
  sync()
  window.addEventListener('sea:theme', sync)
})
onBeforeUnmount(() => window.removeEventListener('sea:theme', sync))
</script>

<template>
  <button class="theme-switch" type="button" @click="toggleDay">
    {{ day ? 'Switch to night' : 'Switch to daytime' }}
  </button>
</template>
