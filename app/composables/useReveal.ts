// Section labels flicker in the first time they are seen.
// The matching styles live in main.css under "Motion".
export function useReveal() {
  let observer: IntersectionObserver | undefined

  onMounted(() => {
    const targets = document.querySelectorAll<HTMLElement>('[data-flicker]')

    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-in'))
      return
    }

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          el.style.setProperty('--d', (Math.random() * 0.25).toFixed(2) + 's')
          el.classList.add('is-in')
          observer?.unobserve(el)
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    targets.forEach((el) => observer!.observe(el))
  })

  onBeforeUnmount(() => observer?.disconnect())
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
