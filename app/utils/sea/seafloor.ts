// The sea floor at the very bottom of the page: a shaded sand bank, and on
// it a reef of glowing corals (branching staghorn, brain coral, sea fans,
// anemones, tube sponges and kelp) with a crab scuttling across. At the
// sides it rises into tall towers that frame the contact links. It is
// anchored to the bottom of the page, so it rises into view as you reach the
// end, and drawn on the back layer, behind the text.
//
// Everything is placed from fixed random numbers, so the reef is the same on
// every visit. It is drawn once (whenever the screen size changes): whatever
// doesn't move (the sand, the back row, brain coral, sponges and the glow)
// into one picture, and each swaying coral into a small picture of its own.
// Every frame each coral's picture is copied into place in horizontal
// slices, each slice shifted a little more than the one below it, so the
// coral bends in the current from its foot to its tip. That is a few hundred
// copies a frame instead of thousands of characters, so the reef sways
// smoothly at the full frame rate.
import { RAMP, HUE, colorIndex, rampIndex, hash2, type GlyphAtlas } from '../ascii'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

export interface FloorScene {
  ctx: Ctx2D
  atlas: GlyphAtlas
  // The back layer's pixel scale
  bd: number
  W: number
  H: number
  cw: number
  ch: number
  t: number
  // The crab's own clock: it stands still while it's talking (CrabSecret.vue)
  crabT: number
  // The bottom of the page, on screen
  floorY: number
  // Draws a soft round glow (shared with the rest of the sea)
  glow: (c: Ctx2D, x: number, y: number, r: number, rgb: string, a: number) => void
  // The top of the big contact links on screen: the reef at the sides grows
  // nearly that high (NaN when there are none)
  reefTop: number
}

// How tall the reef is in the middle (the footer leaves this much room, see .contact in main.css)
export function floorHeight(H: number): number {
  return Math.max(260, Math.min(440, H * 0.5))
}

// One character of the reef, relative to the bottom of the page (y is
// negative, going up)
interface Item {
  x: number
  y: number
  g: string
  ci: number
}

// A coral that sways: its characters, and how far (at its tip) and how fast
interface Sway {
  items: Item[]
  amp: number
  sp: number
  ph: number
}

// A swaying coral drawn into its own picture, and where that picture goes
interface Sprite {
  canvas: AnyCanvas
  x: number
  top: number
  base: number
  w: number
  h: number
  amp: number
  sp: number
  ph: number
}

interface Light {
  x: number
  y: number
  r: number
  rgb: string
  a: number
}

const CORAL_HUES = [HUE.pink, HUE.violet, HUE.warm, HUE.green, HUE.cyan]

export function createSeafloor(makeCanvas: (w: number, h: number) => AnyCanvas) {
  let key = ''
  let sprites: Sprite[] = []
  let still: AnyCanvas | null = null
  let tall = 0
  let sandAt: (x: number) => number = () => 0

  // Draws the reef and returns where the crab is (the middle of its top
  // edge, on screen), or null when the floor is out of view
  return function draw(s: FloorScene): { x: number; y: number } | null {
    const { ctx, atlas, bd, W, H, cw, ch, t, floorY } = s
    const FH = floorHeight(H)
    // At the sides it rises almost to the contact links, framing them
    const want = Number.isFinite(s.reefTop) ? Math.max(FH, Math.min(H * 1.2, (floorY - s.reefTop) * 0.9)) : FH
    if (floorY - want > H || floorY < 0) return null

    // Work the reef out again only when the screen or its height changes
    const k = `${W}|${H}|${cw}|${ch}|${bd}|${Math.round(want / 8)}`
    if (k !== key) {
      key = k
      tall = want
      const reef = build(W, cw, ch, FH, tall)
      sandAt = reef.sand
      sprites = reef.sways.map((sw) => sprite(sw, atlas, bd, cw, ch, makeCanvas))
      // The still part, drawn once with the floor a row above its bottom edge
      const local = tall + ch * 2
      still = makeCanvas(Math.ceil(W * bd), Math.ceil(local * bd))
      still.width = Math.ceil(W * bd)
      still.height = Math.ceil(local * bd)
      const c = still.getContext('2d') as Ctx2D
      c.globalCompositeOperation = 'lighter'
      for (const L of reef.lights) s.glow(c, L.x, L.y + tall + ch, L.r, L.rgb, L.a * 2.5)
      c.globalCompositeOperation = 'source-over'
      for (const it of reef.still) {
        atlas.draw(c, it.g, it.ci, Math.round(it.x * bd) - 1, Math.round((it.y + tall + ch) * bd) - 1)
      }
    }

    ctx.drawImage(still!, 0, Math.round((floorY - tall - ch) * bd))

    // The swaying corals: each copied in slices two rows tall, every slice
    // shifted by the current, more the higher it is, with a ripple that runs
    // up the coral
    const slice = ch * 2
    for (const sp of sprites) {
      const top = floorY + sp.top
      if (top > H || floorY + sp.base < 0) continue
      const span = sp.base - sp.top
      for (let y0 = 0; y0 < sp.h; y0 += slice) {
        const y = top + y0
        if (y > H || y + slice < 0) continue
        const up = 1 - (y0 + slice / 2) / span // 1 at the tip, 0 at the foot
        const lift = Math.max(0, up) ** 1.4
        const dx = Math.sin(t * sp.sp + sp.ph - up * 1.4) * sp.amp * lift
        const sh = Math.min(slice, sp.h - y0)
        ctx.drawImage(
          sp.canvas,
          0,
          Math.round(y0 * bd),
          Math.round(sp.w * bd),
          Math.round(sh * bd),
          Math.round((sp.x + dx) * bd),
          Math.round(y * bd),
          Math.round(sp.w * bd),
          Math.round(sh * bd),
        )
      }
    }

    // A crab scuttling back and forth along the sand, claws snapping
    const cx = W * (0.5 + 0.42 * Math.sin(s.crabT * 0.05))
    const cy = floorY + sandAt(cx) - ch * 0.8
    const shape = Math.floor(t * 6) % 2 ? '(\\/)(o,,o)(\\/)' : "(/\\)(o''o)(/\\)"
    const x0 = cx - (shape.length / 2) * cw
    for (let i = 0; i < shape.length; i++) {
      const g = shape[i]!
      const claw = i < 4 || i > 9
      atlas.draw(ctx, g, colorIndex(claw ? HUE.pink : HUE.warm, g === 'o' ? 9 : claw ? 7 : 6), Math.round((x0 + i * cw) * bd) - 1, Math.round(cy * bd) - 1)
    }
    return { x: cx, y: cy }
  }
}

// Lay out the whole reef, relative to the bottom of the page
function build(W: number, cw: number, ch: number, FH: number, tall: number) {
  const still: Item[] = []
  const sways: Sway[] = []
  const lights: Light[] = []

  // The row being laid out: the back row is dimmer and doesn't sway
  let dim = 0
  let back = false
  // The swaying coral being laid out, if any
  let cur: Sway | null = null
  const swaying = (amp: number, sp: number, ph: number) => {
    cur = back ? null : { items: [], amp, sp, ph }
    if (cur) sways.push(cur)
  }
  const add = (g: string, hue: number, level: number, x: number, y: number) => {
    const ci = colorIndex(hue, Math.max(0, Math.min(9, Math.round(level - dim))))
    ;(cur ? cur.items : still).push({ x, y, g, ci })
  }

  // The top of the sand at x: low rolling dunes
  const sand = (x: number) => -(52 + 14 * Math.sin(x * 0.011) + 8 * Math.sin(x * 0.037 + 1.3))

  // How much taller than the middle the reef grows at x: rising steeply in
  // the outer fifth of the screen on each side
  const rise = (x: number) => {
    const edge = Math.max(0, Math.min(1, 1 - Math.min(x, W - x) / (W * 0.2)))
    const e = edge * edge * (3 - 2 * edge)
    return 1 + (tall / FH - 1) * e
  }

  // ---- the reef, placed left to right, in two rows ------------------------
  // The back row is smaller, dimmer and a little higher up the slope, so
  // the reef has depth; the front row stands on the sand in full colour.
  type Piece = { x: number; kind: number; seed: number; size: number }
  const TALL_KINDS = [5, 5, 0, 5] // kelp, with some staghorn, makes the tall towers
  const row = (salt: number, gap: number, small: number) => {
    const out: Piece[] = []
    for (let x = 10 + 30 * hash2(salt, 1), i = 0; x < W - 10; i++) {
      const towering = rise(x) > 1.6
      out.push({
        x,
        kind: towering ? TALL_KINDS[Math.floor(hash2(i + salt, 31) * 4)]! : Math.floor(hash2(i + salt, 31) * 6),
        seed: hash2(i + salt, 77),
        size: (0.65 + 0.5 * hash2(i + salt, 53)) * small,
      })
      // Packed closer together in the towers at the sides
      x += gap * (0.7 + 0.9 * hash2(i + salt, 19)) * (towering ? 0.55 : 1)
    }
    return out
  }

  const grow = (p: Piece, lift: number) => {
    const base = sand(p.x) + 4 - lift
    const hue = CORAL_HUES[Math.floor(p.seed * CORAL_HUES.length)]!
    const h = FH * 0.72 * p.size * rise(p.x)
    cur = null
    switch (p.kind) {
      case 0:
        staghorn(p.x, base, h, hue, p.seed)
        break
      case 1:
        brain(p.x, base, p.size * 1.3, p.seed)
        break
      case 2:
        fan(p.x, base, h * 0.85, p.seed)
        break
      case 3:
        anemone(p.x, base, h * 0.55, p.seed)
        break
      case 4:
        sponges(p.x, base, h * 0.6, p.seed)
        break
      default:
        kelp(p.x, base, Math.min(tall * 0.98, h * 1.3), p.seed)
    }
    cur = null
  }

  dim = 3
  back = true
  for (const p of row(500, 70, 0.7)) grow(p, 26)
  for (const L of lights) L.a *= 0.4
  dim = 0
  back = false
  for (const p of row(0, 64, 1)) grow(p, 0)

  // ---- sand: lit from above, darker as it goes down, with grains and shells
  for (let x = 0; x < W; x += cw) {
    const top = sand(x)
    for (let y = top, k = 0; y < ch; y += ch, k++) {
      const n = hash2(Math.floor(x / cw), k + 3)
      let v = 0.36 - k * 0.06 + 0.12 * n + (k < 2 ? 0.05 * hash2(x, 9) : 0)
      if (k === 0) v += 0.14
      if (v < 0.05) continue
      let g = RAMP[Math.max(1, Math.min(5, rampIndex(v)))]!
      if (k === 0 && n > 0.93) g = n > 0.97 ? 'o' : ','
      add(g, HUE.warm, 1 + v * 6, x, y - ch * 0.5)
    }
  }

  return { still, sways, lights, sand }

  // ---- the pieces ----------------------------------------------------------

  // Staghorn: a trunk that forks and forks again, tips glowing, the whole
  // thing leaning a little more the higher up it is
  function staghorn(x: number, y: number, h: number, hue: number, seed: number) {
    swaying(Math.min(14, h * 0.05), 0.8, seed * 9)
    const branch = (bx: number, by: number, a: number, len: number, depth: number) => {
      const dx = Math.sin(a)
      const dy = -Math.cos(a)
      const steps = Math.max(2, Math.round(len / (ch * 0.6)))
      const g = Math.abs(a) < 0.3 ? '|' : a > 0 ? '/' : '\\'
      for (let k = 1; k <= steps; k++) {
        const f = k / steps
        add(g, hue, 4 + depth * 0.8 + f, bx + dx * len * f, by + dy * len * f)
      }
      const ex = bx + dx * len
      const ey = by + dy * len
      if (depth === 0) {
        add(hash2(seed, ex) > 0.5 ? '*' : 'o', hue, 9, ex, ey - ch * 0.3)
        if (hash2(ex, seed) > 0.6) lights.push({ x: ex, y: ey, r: 26, rgb: rgbOf(hue), a: 0.18 })
        return
      }
      const spread = 0.42 + 0.15 * hash2(seed, depth)
      branch(ex, ey, a - spread, len * 0.72, depth - 1)
      branch(ex, ey, a + spread, len * 0.72, depth - 1)
    }
    branch(x, y, (seed - 0.5) * 0.3, h * 0.38, 3)
  }

  // Brain coral: a low dome, shaded and grooved like a maze
  function brain(x: number, y: number, size: number, seed: number) {
    const rx = 34 * size
    const ry = 26 * size
    const hue = seed > 0.5 ? HUE.green : HUE.warm
    for (let yy = y - ry; yy <= y; yy += ch) {
      for (let xx = x - rx; xx <= x + rx; xx += cw) {
        const u = (xx - x) / rx
        const v = (yy - y) / ry
        const d = u * u + v * v
        if (d > 1) continue
        const maze = Math.sin((xx - x) * 0.32 + Math.sin((yy - y) * 0.3 + seed * 6) * 2) * Math.sin((yy - y) * 0.42 + Math.sin((xx - x) * 0.2) * 2)
        const lit = 0.25 + 0.45 * Math.max(0, -v) * (1 - 0.4 * Math.abs(u))
        const w = lit + (maze > 0.25 ? 0.3 : 0) + 0.25 * d ** 3
        add(RAMP[Math.max(1, rampIndex(w * 0.8))]!, hue, 2 + w * 6, xx, yy)
      }
    }
    lights.push({ x, y: y - ry * 0.5, r: rx * 1.6, rgb: rgbOf(hue), a: 0.08 })
  }

  // Sea fan: a flat fan of fine lattice, swaying gently from its foot
  function fan(x: number, y: number, h: number, seed: number) {
    const hue = seed > 0.5 ? HUE.violet : HUE.pink
    swaying(Math.min(12, h * 0.06), 0.6, seed * 7)
    for (let yy = y - h; yy <= y; yy += ch) {
      for (let xx = x - h; xx <= x + h; xx += cw) {
        const dx = xx - x
        const dy = y - yy
        const r = Math.hypot(dx, dy)
        if (r > h || dy < 0) continue
        const a = Math.atan2(dx, dy)
        if (Math.abs(a) > 0.95) continue
        const rib = Math.sin(a * 13) > 0.55
        const ring = Math.sin(r * 0.22 + seed * 5) > 0.6
        const edge = r > h * 0.9
        if (!rib && !ring && !edge && r > ch) continue
        const g = rib && ring ? '+' : rib ? (a > 0 ? '/' : '\\') : edge ? '.' : '-'
        add(g, hue, 3 + 4 * (1 - r / h) + (rib && ring ? 2 : 0), xx, yy)
      }
    }
    lights.push({ x, y: y - h * 0.5, r: h * 0.8, rgb: rgbOf(hue), a: 0.07 })
  }

  // Anemone: a short column with a crown of waving tentacles
  function anemone(x: number, y: number, h: number, seed: number) {
    const hue = seed > 0.5 ? HUE.cyan : HUE.green
    const stalk = h * 0.45
    for (let yy = y; yy > y - stalk; yy -= ch) {
      for (let k = -1; k <= 1; k++) add(k === 0 ? ':' : k < 0 ? '(' : ')', hue, 4, x + k * cw, yy)
    }
    const top = y - stalk
    swaying(6, 1.6, seed * 5)
    const n = 9
    for (let i = 0; i < n; i++) {
      const out = (i / (n - 1) - 0.5) * 2 // -1 to 1 across the crown
      const len = h * (0.55 + 0.3 * (1 - Math.abs(out)))
      const steps = Math.max(3, Math.round(len / (ch * 0.7)))
      for (let k = 1; k <= steps; k++) {
        const f = k / steps
        const tx = x + out * len * 0.7 * f
        const ty = top - len * f * (1 - 0.35 * Math.abs(out)) + Math.abs(out) * len * 0.25 * f * f
        const g = k === steps ? 'o' : out * (1 - f) > 0.15 ? ')' : out < -0.15 ? '(' : '|'
        add(g, hue, k === steps ? 9 : 5 + 2 * f, tx, ty)
      }
    }
    lights.push({ x, y: top - h * 0.3, r: h * 0.9, rgb: rgbOf(hue), a: 0.12 })
  }

  // Tube sponges: a cluster of upright tubes, open at the top
  function sponges(x: number, y: number, h: number, seed: number) {
    const hue = seed > 0.5 ? HUE.warm : HUE.violet
    for (let k = 0; k < 3; k++) {
      const tx = x + (k - 1) * cw * 3
      const th = h * (0.6 + 0.5 * hash2(seed, k))
      for (let yy = y; yy > y - th; yy -= ch) {
        const f = (y - yy) / th
        add('|', hue, 4 + f * 2, tx - cw, yy)
        add(f > 0.5 ? ':' : '.', hue, 3 + f * 2, tx, yy)
        add('|', hue, 4 + f * 2, tx + cw, yy)
      }
      add('(', hue, 7, tx - cw, y - th)
      add('O', hue, 8, tx, y - th - ch * 0.2)
      add(')', hue, 7, tx + cw, y - th)
    }
  }

  // Kelp: tall green strands rippling in the current, with the odd leaf
  function kelp(x: number, y: number, h: number, seed: number) {
    for (let s = 0; s < 3; s++) {
      const sx = x + (s - 1) * cw * 2.5
      const sh = h * (0.7 + 0.3 * hash2(seed, s + 2))
      const steps = Math.round(sh / (ch * 0.75))
      swaying(14, 1.1, seed * 8 + s * 1.7)
      for (let k = 1; k <= steps; k++) {
        const f = k / steps
        const ny = y - sh * f
        // A gentle S along the strand, drawn into it
        const bend = Math.sin(f * 5 + seed * 8 + s) * 5 * f
        const lean = Math.cos(f * 5 + seed * 8 + s)
        const g = lean > 0.35 ? ')' : lean < -0.35 ? '(' : '|'
        add(g, HUE.green, 3 + 3 * (1 - f) + 1, sx + bend, ny)
        if (k % 4 === 2) add('~', HUE.green, 4, sx + bend + (k % 8 === 2 ? cw : -cw), ny)
      }
    }
  }
}

function rgbOf(hue: number): string {
  switch (hue) {
    case HUE.pink:
      return '255, 122, 206'
    case HUE.violet:
      return '150, 132, 255'
    case HUE.warm:
      return '255, 206, 128'
    case HUE.green:
      return '112, 255, 176'
    default:
      return '92, 207, 255'
  }
}

// Draw a swaying coral into a picture of its own, with room either side for
// it to sway into
function sprite(sw: Sway, atlas: GlyphAtlas, bd: number, cw: number, ch: number, makeCanvas: (w: number, h: number) => AnyCanvas): Sprite {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const it of sw.items) {
    x0 = Math.min(x0, it.x)
    x1 = Math.max(x1, it.x)
    y0 = Math.min(y0, it.y)
    y1 = Math.max(y1, it.y)
  }
  const pad = cw * 2
  const left = x0 - pad
  const top = y0 - ch
  const w = Math.max(1, x1 - x0 + cw + pad * 2)
  const h = Math.max(1, y1 - y0 + ch * 2)
  const canvas = makeCanvas(Math.ceil(w * bd), Math.ceil(h * bd))
  canvas.width = Math.ceil(w * bd)
  canvas.height = Math.ceil(h * bd)
  const c = canvas.getContext('2d') as Ctx2D
  for (const it of sw.items) {
    atlas.draw(c, it.g, it.ci, Math.round((it.x - left) * bd) - 1, Math.round((it.y - top) * bd) - 1)
  }
  return { canvas, x: left, top, base: y1 + ch, w, h, amp: sw.amp, sp: sw.sp, ph: sw.ph }
}

