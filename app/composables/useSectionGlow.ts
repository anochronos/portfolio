// Tells the sea how deep you are. When a section crosses the middle of the
// screen, its `data-zone` number (0 at the surface, one more per section
// going down) is sent as a 'sea:zone' event; SeaScene changes the water and
// the creatures to match. Mark a section with `data-glow` to include it.
export function useSectionGlow() {
  const route = useRoute()
  let observer: IntersectionObserver | undefined
  let current: Element | null = null

  function light(el: Element) {
    if (el === current) return
    current = el
    const zone = Number((el as HTMLElement).dataset.zone ?? 0)
    window.dispatchEvent(new CustomEvent('sea:zone', { detail: zone }))
  }

  function observe() {
    observer?.disconnect()
    current = null
    if (!('IntersectionObserver' in window)) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) light(entry.target)
        }
      },
      { rootMargin: '-48% 0px -48% 0px' },
    )
    document.querySelectorAll('[data-glow]').forEach((el) => observer!.observe(el))
  }

  onMounted(observe)
  watch(
    () => route.path,
    () => nextTick(observe),
    { flush: 'post' },
  )
  onBeforeUnmount(() => observer?.disconnect())
}
