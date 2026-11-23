<script setup lang="ts">
// Experience as a log, newest first: when, what, where, and what the work
// was, all on the page. A line of characters runs down the left with a knot
// at each entry, like the knotted line sailors lowered to sound the depth.
interface Entry {
  when: string
  title: string
  place: string
  points: string[]
}

const entries: Entry[] = [
  {
    when: '2021 to 2026',
    title: 'Bachelor of Engineering, Software Engineering',
    place: 'Carleton University, Ottawa',
    points: [
      'Coursework in data structures and algorithms, distributed systems, machine learning, software architecture, human-computer interaction and cryptography.',
      'Capstone: led perception for CUVision, a self-driving car stack.',
    ],
  },
  {
    when: 'Jan to Dec 2024',
    title: 'Application Developer (co-op)',
    place: 'National Research Council Canada',
    points: [
      'Built a Python system that runs experimental tasks as separate modules, using Tkinter and subprocess.',
      'Wrote a survey engine that builds its interface from .ini files, for human factors research.',
      'Made cognitive tasks in Pygame with millisecond timing.',
      'Built pipelines that process experiment data and calculate performance metrics as it comes in.',
      'Wrote the documentation and user manuals. More than 200 people used the finished tools.',
    ],
  },
]
</script>

<template>
  <section id="experience" class="section" data-glow data-zone="3">
    <div class="grid section-head">
      <h2 class="section-label" data-flicker><span class="sq" />Experience</h2>
    </div>

    <div class="grid">
      <ol class="log">
        <li v-for="e in entries" :key="e.title" class="log-entry">
          <p class="log-when"><span class="log-knot" aria-hidden="true">o</span>{{ e.when }}</p>
          <div class="log-body">
            <h3 class="log-title">{{ e.title }}</h3>
            <p class="log-place">{{ e.place }}</p>
            <ul class="log-points">
              <li v-for="pt in e.points" :key="pt">{{ pt }}</li>
            </ul>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>
