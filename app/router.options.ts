// Where the page is scrolled to after moving between pages. A fresh load or a
// reload always starts at the top (the surface, where the opening plays),
// rather than wherever the page was left. Back and forward go back to where
// you were, and a link to a #section goes to it.
import type { RouterConfig } from '@nuxt/schema'

export default <RouterConfig>{
  scrollBehavior(to, from, saved) {
    if (!from.matched.length) return { top: 0, left: 0 }
    if (saved) return saved
    if (to.hash) return { el: to.hash, top: 0 }
    return { top: 0, left: 0 }
  },
}
