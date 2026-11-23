<script setup lang="ts">
useSectionGlow()
</script>

<template>
  <div>
    <ThemeSwitch />
    <SoundSwitch />
    <NuxtPage />
    <!-- After the page on purpose: in the hero it paints over the name,
         everywhere else the sections sit above it (see "Layers" in main.css). -->
    <SeaScene />
    <SeaCursor />
    <FishHook />
    <ShipCalls />
    <CrabSecret />
    <DepthMeter />
    <ArcadeMode />
    <!-- A light CRT finish over everything (see "CRT" in main.css) -->
    <div class="crt" aria-hidden="true" />
  </div>
</template>
