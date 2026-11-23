// Shared by the sea and the cursor.

// Where the waterline is on screen: just under the first name on the home
// page (the hero's SVG marks it with data-water-y), and above the top of the
// screen everywhere else, so the whole page is under water.
export function waterlineY(): number {
  const svg = document.querySelector<SVGSVGElement>('svg[data-water-y]')
  if (!svg) return -Infinity
  const r = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  if (!vb || !vb.height) return -Infinity
  const level = Number(svg.dataset.waterY)
  return r.top + ((level - vb.y) / vb.height) * r.height
}

// A mouse or trackpad, as opposed to a touch screen
export function hasFinePointer(): boolean {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

// The surface's wave height at a column, shared so the boat rides the same waves
// It's short choppy waves on top of a long, slow swell.
const chopAt = (c: number, t: number) => Math.sin(c * 0.35 + t * 1.6)
const swellAt = (c: number, t: number) => 0.5 * Math.sin(c * 0.11 - t * 0.9)
export function waveAt(c: number, t: number): number {
  return chopAt(c, t) + swellAt(c, t)
}

// The first name floats on the surface. Its letters are about as wide as the
// short waves, so like anything that big afloat they ride the long swell and
// only shiver with the chop. Each one rises and falls with the water under it
// and leans with the slope there. Shared so the name's reflection in the
// water moves with it.
export const NAME_TILT = 1.2 // the most a letter leans, in degrees; more and the tightly set letters bump

// How far down (in screen pixels) the water carries a letter centred at x
export function nameRide(x: number, clock: number, amp: number, cw: number): number {
  const c = x / cw
  return amp * (swellAt(c, clock) + 0.08 * chopAt(c, clock))
}

// While the names are brought in on load (TowIn.vue): how far each is from
// its place, in screen pixels (the first name is left of it, the surname below)
export const tow = { first: 0, last: 0 }

// The moon's size (radius, in pixels). On a computer the moon is the cursor
// while it's in the sky; on a touch screen it hangs in the sky at a size
// that suits the height of the sky above the water. The sun by day is the
// same size.
export const MOON_R = 54
export function skyMoonR(level: number): number {
  return Math.max(28, Math.min(96, level * 0.3))
}

// What the cursor is right now and where, so the sea can reflect the moon
// and light the water around the submarine's porthole. SeaCursor updates it.
export const cursorState = {
  mode: 'none' as 'none' | 'moon' | 'sub',
  x: 0,
  y: 0,
  // Where the moon and the submarine are (they wander off from the cursor
  // when it isn't them), or null when they're out of sight
  moon: null as { x: number; y: number } | null,
  sub: null as { x: number; y: number } | null,
}

// The moving surface, so bubbles pop and splashes land exactly on the waves
// SeaScene draws. SeaScene updates it every frame.
export const seaSurface = {
  clock: 0,
  amp: 0,
  cw: 6,
  boat: null as { x: number; y: number } | null,
  crab: null as { x: number; y: number } | null,
}

export function surfaceY(x: number, level = waterlineY()): number {
  if (!Number.isFinite(level)) return level
  return level + seaSurface.amp * waveAt(x / seaSurface.cw, seaSurface.clock)
}
