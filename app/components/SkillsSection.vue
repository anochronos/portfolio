<script setup lang="ts">
const groups = [
  { name: 'Languages', items: ['Java', 'Python', 'C++', 'SQL', 'JavaScript', 'HTML and CSS', 'Go (coursework)'] },
  { name: 'Frameworks', items: ['Spring Boot', 'Flask', 'React', 'PyTorch', 'TensorFlow', 'OpenCV', 'JUnit'] },
  { name: 'Tools', items: ['Git', 'GitHub Actions', 'CMake', 'ROS 2', 'Maven', 'Azure'] },
  { name: 'Libraries', items: ['Pandas', 'NumPy', 'Matplotlib', 'SciPy'] },
]
</script>

<template>
  <section id="skills" class="section" data-glow data-zone="4">
    <div class="grid section-head">
      <h2 class="section-label" data-flicker><span class="sq" />Skills</h2>
    </div>
    <div class="grid">
      <dl class="kit">
        <div v-for="group in groups" :key="group.name" class="kit-group">
          <dt>{{ group.name }}</dt>
          <dd>{{ group.items.join(', ') }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
