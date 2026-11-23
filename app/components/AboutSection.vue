<template>
  <section id="about" class="section" data-glow data-zone="2">
    <div class="grid section-head">
      <h2 class="section-label" data-flicker><span class="sq" />About</h2>
      <p class="statement">
        I'm a software engineer. Mostly backend work in Java and Python, and lately machine
        learning.
      </p>
    </div>
    <div class="grid about">
      <figure class="portrait">
        <span class="frame">
          <img
            src="/profile.jpg"
            alt="Akshun Kalra smiling, photographed at night with string lights behind him"
            width="960"
            height="1200"
            loading="lazy"
          />
          <AsciiFrame :seed="9" />
        </span>
      </figure>
      <div class="about-text">
        <p>
          I graduated from Carleton University in 2026 with a Bachelor of Engineering in Software
          Engineering. Before that I spent twelve months at the National Research Council Canada
          as an application developer, building the tools researchers ran their experiments on.
        </p>
        <p>
          Most of what I've built is backend work in Java and Python: REST APIs with Spring Boot,
          a UDP-based drone simulation, and the Python systems at NRC. My capstone pulled me
          toward machine learning, where I led perception for a self-driving stack.
        </p>
      </div>
    </div>
  </section>
</template>
