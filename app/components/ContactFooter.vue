<script setup lang="ts">
const year = new Date().getFullYear()
</script>

<template>
  <footer id="contact" class="contact" data-glow data-zone="5">
    <h2 class="sr-only">Contact</h2>
    <ul class="contact-links">
      <li>
        <a href="https://linkedin.com/in/akshun-kalra" target="_blank" rel="noopener">LinkedIn</a>
      </li>
      <li><a href="https://github.com/anochronos" target="_blank" rel="noopener">GitHub</a></li>
      <li>
        <a href="/resume.pdf" target="_blank" rel="noopener">Resume</a>
      </li>
      <!-- To add email, put a line here: <li><a href="mailto:you@example.com">Email</a></li> -->
    </ul>
    <div class="contact-foot">
      <p>Akshun Kalra</p>
      <p>
        Music: Bread by Lukrembo, from
        <a href="https://freetouse.com/music" target="_blank" rel="noopener">Free To Use</a>
      </p>
      <p>&copy;{{ year }}</p>
    </div>
  </footer>
</template>
