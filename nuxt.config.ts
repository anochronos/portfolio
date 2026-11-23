const description =
  'Akshun Kalra is a software engineer and Carleton University graduate working in Java, Python and machine learning, looking for entry-level software and data engineering roles.'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Akshun Kalra | Software Engineer',
      meta: [
        { name: 'description', content: description },
        { name: 'theme-color', content: '#040a15' },
        { name: 'color-scheme', content: 'dark' },
        { property: 'og:title', content: 'Akshun Kalra | Software Engineer' },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'website' },
      ],
      link: [
        {
          rel: 'preload',
          href: '/fonts/inter-tight-latin.woff2',
          as: 'font',
          type: 'font/woff2',
          crossorigin: 'anonymous',
        },
        {
          rel: 'preload',
          href: '/fonts/jetbrains-mono-latin.woff2',
          as: 'font',
          type: 'font/woff2',
          crossorigin: 'anonymous',
        },
      ],
      // Set before first paint so scroll-reveal styles never flash.
      // Also puts back day mode if it was chosen last time (see utils/theme.ts),
      // and stops the browser putting a reloaded page back where it was
      // scrolled to, or jumping to an old #section in the address: every
      // visit starts at the surface (see app/router.options.ts)
      script: [
        {
          innerHTML:
            "document.documentElement.classList.add('js');try{if('scrollRestoration' in history)history.scrollRestoration='manual';if(location.hash)history.replaceState(history.state,'',location.pathname+location.search)}catch(e){}try{if(localStorage.getItem('sea-theme')==='day')document.documentElement.dataset.theme='day'}catch(e){}",
        },
      ],
    },
  },
})
