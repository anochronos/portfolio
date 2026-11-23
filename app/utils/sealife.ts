// The creatures that join the jellyfish as you scroll deeper.
//
// Each one is a function that "puts" light into character cells: a position
// on screen, how bright, which hue, and optionally which character to use.
// SeaScene turns those cells into glyphs: a brighter cell gets a denser
// character, the same way the jellyfish are drawn. So the bodies here are
// filled in cell by cell and shaded (lit edges, darker middles, light falling
// on them from their own glow) rather than outlined.
//
// `presence` (0 to 1) brings a creature in and takes it away: it swims in
// from below or above and back out the same way, depending on whether you
// are heading deeper or back up (see Swim). `glow` (0 to 1) is the flash it
// gives off when it first arrives.
import { HUE, hash2 } from './ascii'

export type Put = (x: number, y: number, w: number, hue: number, glyph?: number) => void

export interface Light {
  x: number
  y: number
  r: number
  a: number
  rgb: string
}

export interface World {
  W: number
  H: number
  t: number
  cw: number
  ch: number
  put: Put
  lights: Light[]
}

// Which way a creature is coming or going. Heading deeper, the next
// creatures rise into view from below and the ones you are leaving swim up
// and away; heading back up, it is the other way round.
export interface Swim {
  // Where it is off screen: 1 below, -1 above
  side: number
  // Which way it is moving: -1 up, 1 down
  vy: number
}

export interface Species {
  name: string
  // The depth zones (one per section, 0 at the surface) where it lives
  zones: number[]
  // Weaves through the big headings: behind every other letter, in front of the rest
  weave?: boolean
  draw: (w: World, presence: number, glow: number, swim: Swim) => void
}

const RAINBOW = [HUE.cyan, HUE.green, HUE.pink, HUE.violet, HUE.warm]
const code = (s: string) => s.charCodeAt(0)

function easeIn(p: number): number {
  return 1 - (1 - p) ** 3
}

// How far off screen a creature is while it swims in or out: easing off as
// it settles in, picking up speed as it leaves
function offset(H: number, p: number, swim: Swim): number {
  const settled = p * p * (3 - 2 * p)
  return swim.side * (1 - settled) * H * 0.95
}

// It stays at full brightness for most of the swim, only fading at the end
function shownOf(p: number): number {
  return Math.min(1, p * 2.5)
}

function scaleOf(W: number, H: number): number {
  return Math.max(0.55, Math.min(1.25, Math.min(W, H) / 820))
}

// What a shape's shader can change about the cell it is shading
interface Cell {
  hue: number
  glyph: number
}
const cell: Cell = { hue: 0, glyph: 0 }

// Fill a shape one character cell at a time. `fn` gets each cell's position
// in the shape's own frame (lx along its length, ly across it, both -1 to 1
// at the edge of the hx by hy box, and further out for fins and tails) and
// returns how bright the cell is, or 0 to leave it empty. `reach` is how far
// past the box the shape can go, in box units.
function fill(
  { W, H, cw, ch, put }: World,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  ang: number,
  reach: number,
  hue: number,
  fn: (lx: number, ly: number, c: Cell) => number,
) {
  const R = Math.hypot(hx, hy) * reach
  const cs = Math.cos(ang)
  const sn = Math.sin(ang)
  // Only the part of the shape that is on screen
  const c0 = Math.max(0, Math.floor((cx - R) / cw))
  const c1 = Math.min(Math.ceil(W / cw), Math.ceil((cx + R) / cw))
  const r0 = Math.max(0, Math.floor((cy - R) / ch))
  const r1 = Math.min(Math.ceil(H / ch), Math.ceil((cy + R) / ch))
  if (c0 > c1 || r0 > r1) return
  for (let r = r0; r <= r1; r++) {
    const y = (r + 0.5) * ch
    for (let c = c0; c <= c1; c++) {
      const x = (c + 0.5) * cw
      const dx = x - cx
      const dy = y - cy
      const lx = (dx * cs + dy * sn) / hx
      const ly = (-dx * sn + dy * cs) / hy
      cell.hue = hue
      cell.glyph = 0
      const w = fn(lx, ly, cell)
      if (w > 0.01) put(x, y, w, cell.hue, cell.glyph || undefined)
    }
  }
}

// ---- fish -----------------------------------------------------------------

// A school of amber fish, each a shaded body with a forked tail, a gill
// line, a dorsal fin and an eye, all facing the way the school is swimming.
function fishSchool(world: World, p: number, glow: number, swim: Swim) {
  const { W, H, t, cw, ch, lights } = world
  const e = easeIn(p)
  const drift = 0.07
  const dir = Math.cos(drift * t) >= 0 ? 1 : -1
  const cx = W * (0.5 + 0.34 * Math.sin(drift * t))
  const cy = H * (0.58 + 0.15 * Math.sin(0.11 * t + 1)) + offset(H, p, swim)
  // Noses up while swimming up, down while diving
  const pitch = swim.vy * dir * 0.55 * (1 - e)
  const n = W < 768 ? 5 : 8
  const R = Math.min(W, H) * 0.21
  const bright = shownOf(p) * (1 + 1.6 * glow)

  for (let k = 0; k < n; k++) {
    const a = k * 2.399 + 0.22 * t
    const rk = R * (0.25 + 0.75 * Math.sqrt((k + 0.5) / n))
    const fx = cx + Math.cos(a) * rk + 6 * Math.sin(2 * t + k)
    const fy = cy + Math.sin(a) * rk * 0.55 + 3 * Math.sin(3 * t + k * 1.7)
    const len = cw * (5.2 + 1.6 * hash2(k, 5))
    const hy = ch * (1.5 + 0.35 * hash2(k, 9))
    const wag = Math.sin(9 * t + k * 1.3)
    const glint = 0.85 + 0.15 * Math.sin(3 * t + k)

    fill(world, fx, fy, len, hy, wag * 0.05 * dir + pitch, 1.6, HUE.warm, (lx, ly, c) => {
      const x = lx * dir // 1 at the nose, -1 where the tail starts
      if (x > -1 && x <= 1) {
        // A teardrop: round head, body narrowing to the tail
        const half = Math.sqrt(Math.max(0, 1 - x * x)) * (x < 0 ? 0.55 + 0.45 * (1 + x) : 1)
        // Dorsal fin on top, a smaller one underneath
        const fin = x > -0.4 && x < 0.25 && ly < -half && ly > -half - 0.6 * (1 - Math.abs((x + 0.08) / 0.33))
        const belly = x > -0.55 && x < -0.2 && ly > half && ly < half + 0.35 * (1 - Math.abs((x + 0.38) / 0.18))
        if (fin || belly) return (0.3 + (Math.sin(x * 40) > 0 ? 0.15 : 0)) * bright
        if (Math.abs(ly) > half) return 0
        const edge = Math.abs(ly) / Math.max(half, 0.01)
        // The outline in line characters that follow its slope, so the
        // silhouette reads as clearly as the jellyfish's tentacles
        if (edge > 0.68 || x > 0.9) {
          let g: string
          if (x > 0.9) g = dir > 0 ? ')' : '('
          else if (Math.abs(x + 0.05) < 0.3) g = '-'
          else g = (x < 0) === (ly < 0) ? '/' : '\\'
          if (dir < 0 && (g === '/' || g === '\\')) g = g === '/' ? '\\' : '/'
          c.glyph = code(g)
          return 0.95 * glint * bright
        }
        if (x > 0.48 && x < 0.72 && ly > -0.55 && ly < -0.05) {
          c.glyph = code('o')
          c.hue = HUE.ice
          return 1.6 * bright
        }
        // A bright outline, a darker back, scales, and the curve of the gill
        const gill = 0.5 * Math.exp(-(((x - 0.33) / 0.06) ** 2)) * (1 - edge * 0.5)
        const scales = Math.sin(x * 22 + ly * 6 + wag) * Math.sin(ly * 9 - x * 8) > 0.35 ? 0.2 : 0
        const shade = ly < 0 ? 0.18 : 0.08
        return (shade + 0.95 * edge ** 4 + gill + scales) * glint * bright
      }
      if (x <= -1 && x > -1.55) {
        // A forked tail, flicking
        const s = -1 - x
        const half = 0.15 + s * 1.9
        const yy = ly - wag * 0.25 * s
        if (Math.abs(yy) > half || Math.abs(yy) < s * 1.1 - 0.3) return 0
        if (Math.abs(yy) > half - 0.32) {
          // The tail's edges flare out away from the body
          let g = yy < 0 ? '\\' : '/'
          if (dir < 0) g = g === '/' ? '\\' : '/'
          c.glyph = code(g)
          return 0.8 * bright
        }
        return (0.25 + (Math.sin(yy * 12) > 0.2 ? 0.15 : 0)) * bright
      }
      return 0
    })
  }
  lights.push({ x: cx, y: cy, r: R * 2.6, a: 0.06 * p * (1 + 3 * glow), rgb: '255, 186, 96' })
}

// ---- comb jellies ---------------------------------------------------------

// Comb jellies: clear oval bodies with eight rows of beating cilia that
// scatter light into a running rainbow, a glowing gut down the middle, a
// sense organ at the top, and two long tentacles fringed with side threads.
function combJellies(world: World, p: number, glow: number, swim: Swim) {
  const { W, H, t, cw, ch, put, lights } = world
  const s = scaleOf(W, H)
  const bodies: [number, number, number][] = W < 768 ? [[0.28, 0.4, 0]] : [[0.22, 0.36, 0], [0.84, 0.64, 2.1]]
  const bright = shownOf(p) * (1 + 2 * glow)
  const off = offset(H, p, swim)

  for (const [fx, fy, ph] of bodies) {
    const rx = 42 * s
    const ry = rx * 1.5
    const cx = W * fx + 22 * Math.sin(0.17 * t + ph)
    const cy = H * fy + 28 * Math.sin(0.13 * t + ph * 2) + off
    const turn = 0.6 * t + ph

    fill(world, cx, cy, rx, ry, 0, 1, HUE.ice, (lx, ly, c) => {
      const d = lx * lx + ly * ly
      if (d > 1) return 0
      // Comb rows: where each meridian of the egg-shaped body crosses this row
      const across = Math.sqrt(Math.max(0, 1 - ly * ly))
      for (let k = 0; k < 8; k++) {
        const th = (k / 8) * Math.PI * 2 + turn
        const mx = Math.sin(th) * across * 0.96
        if (Math.abs(lx - mx) * rx < cw * 0.6) {
          const front = Math.cos(th) > 0
          const shimmer = 0.5 + 0.5 * Math.sin(ly * 6 - 5 * t + k)
          c.hue = RAINBOW[(((Math.floor(ly * 3 + 2 * t + k * 0.7) % 5) + 5) % 5)]!
          if (front && shimmer > 0.85) c.glyph = code('*')
          return (front ? 1 : 0.35) * (0.4 + 0.8 * shimmer) * bright
        }
      }
      // The apical organ at the top, and the gut down the middle
      if (ly < -0.78 && Math.abs(lx) < 0.2) {
        c.hue = HUE.cyan
        return 0.9 * bright
      }
      const gut = Math.abs(lx) < 0.16 && ly > -0.6 && ly < 0.55 ? 0.28 : 0
      if (gut) c.hue = HUE.pink
      // Clear jelly: barely there in the middle, bright at the rim
      return (0.05 + 0.6 * d ** 3 + gut) * bright
    })

    // Two long tentacles trailing down, each with short side threads
    for (const side of [-1, 1]) {
      let px = 0
      let py = 0
      const n = 60
      for (let j = 0; j <= n; j++) {
        const f = j / n
        const x = cx + side * rx * (0.4 + 1.3 * f) + 10 * Math.sin(6 * f - 1.4 * t + ph)
        const y = cy + ry * 0.55 + f * ry * 2.8
        const w = 0.42 * (1 - 0.7 * f) * bright
        put(x, y, w, HUE.pink)
        if (j > 0 && j % 5 === 0) {
          // A tentillum: a short thread hanging off, curling with the current
          const nx = -(y - py)
          const ny = x - px
          const nl = Math.hypot(nx, ny) || 1
          for (let q = 1; q <= 4; q++) {
            const curl = Math.sin(q * 0.8 + 2 * t + j)
            put(x + (nx / nl) * q * cw * 0.7 * side + curl * 2, y + (ny / nl) * q * cw * 0.7 + q * ch * 0.25, w * 0.5 * (1 - q / 5), HUE.violet, code(q < 3 ? "'" : '.'))
          }
        }
        px = x
        py = y
      }
    }
    lights.push({ x: cx, y: cy, r: ry * 3, a: 0.06 * p * (1 + 3 * glow), rgb: '150, 255, 210' })
  }
}

// ---- siphonophore -----------------------------------------------------------

// A siphonophore: a long colony strung on one stem. At the front a gas float,
// then a cluster of swimming bells, then feeding polyps each trailing a
// fishing line, every part following the path the float took a moment ago.
function siphonophore(world: World, p: number, glow: number, swim: Swim) {
  const { W, H, t, cw, ch, put, lights } = world
  const lift = offset(H, p, swim)
  const bright = shownOf(p) * (1 + 2 * glow)
  const path = (tt: number) => ({
    x: W * (0.5 + 0.42 * Math.sin(0.05 * tt + 0.6)),
    y: H * (0.32 + 0.24 * Math.sin(0.083 * tt + 2)) + 30 * Math.sin(0.4 * tt) + lift,
  })
  const head = path(t)
  const len = W < 768 ? 11 : 17 // seconds of path the colony covers

  // The stem: a fine continuous line
  for (let k = 1, n = Math.round(len / 0.07); k <= n; k++) {
    const q = path(t - k * 0.07)
    put(q.x, q.y, 0.3 * (1 - (k / n) * 0.5) * bright, HUE.violet)
  }

  // Which way the colony is heading here, for orienting its parts
  const heading = (tt: number) => {
    const a = path(tt)
    const b = path(tt - 0.2)
    return Math.atan2(a.y - b.y, a.x - b.x)
  }

  // The float: a small bright oval at the very front
  fill(world, head.x, head.y, cw * 1.8, ch * 0.75, heading(t), 1, HUE.pink, (lx, ly) => {
    const d = lx * lx + ly * ly
    return d > 1 ? 0 : (0.7 + 0.8 * (1 - d)) * bright
  })

  // Swimming bells: shaded cups in pairs, beating one after another
  for (let k = 1; k <= 6; k++) {
    const tt = t - 0.35 - k * 0.42
    const q = path(tt)
    const a = heading(tt)
    const beat = 0.85 + 0.15 * Math.sin(5 * t - k * 0.9)
    for (const side of [-1, 1]) {
      const ox = Math.cos(a + (side * Math.PI) / 2) * ch * 0.7
      const oy = Math.sin(a + (side * Math.PI) / 2) * ch * 0.7
      fill(world, q.x + ox, q.y + oy, cw * 1.6 * beat, ch * 0.85, a, 1, HUE.pink, (lx, ly, c) => {
        const d = lx * lx + ly * ly
        if (d > 1) return 0
        // An open cup: bright rim, hollow toward the front opening
        if (lx > 0.35 && d < 0.5) return 0
        if (d > 0.6) c.hue = HUE.pink
        else c.hue = HUE.violet
        return (0.15 + 0.85 * d ** 2) * beat * bright
      })
    }
  }

  // Feeding polyps along the rest, each with a fishing line of stinging threads
  for (let k = 0; k < 9; k++) {
    const tt = t - 3.4 - k * ((len - 3.6) / 9)
    const q = path(tt)
    const fade = 1 - (k / 9) * 0.5
    put(q.x, q.y + ch * 0.6, 0.85 * fade * bright, HUE.pink, code(k % 2 ? 'O' : 'o'))
    put(q.x, q.y + ch * 1.4, 0.5 * fade * bright, HUE.violet, code('v'))
    for (let j = 1; j <= 12; j++) {
      const f = j / 12
      const sway = 6 * Math.sin(2 * t + k + f * 4) * f
      const y = q.y + ch * 1.6 + j * ch * 0.75
      put(q.x + sway, y, 0.4 * (1 - f * 0.8) * fade * bright, HUE.violet, code(j % 3 === 0 ? ':' : "'"))
      if (j % 3 === 0) put(q.x + sway + cw, y + ch * 0.3, 0.22 * fade * bright, HUE.pink, code('.'))
    }
  }

  lights.push({ x: head.x, y: head.y, r: 170, a: 0.1 * p * (1 + 3 * glow), rgb: '255, 110, 200' })
}

// ---- anglerfish ---------------------------------------------------------------

// An anglerfish: a dark, lumpy body you only see where its own lure lights
// it, a gaping mouth full of needle teeth, a small pale eye, spiny fins, and
// the bright green lure dangling ahead of its face on a long stalk.
function anglerfish(world: World, p: number, glow: number, swimDir: Swim) {
  const { W, H, t, cw, ch, put, lights } = world
  const e = easeIn(p)
  const s = scaleOf(W, H)
  const rx = 88 * s
  const ry = 58 * s
  const speed = 0.045
  const facing = Math.cos(speed * t) >= 0 ? 1 : -1
  const x = W * (0.5 + 0.3 * Math.sin(speed * t))
  const y = H * (0.62 + 0.07 * Math.sin(0.2 * t)) + offset(H, p, swimDir)
  const bright = shownOf(p) * (1 + 2 * glow)
  // Tilted nose up or down while it swims in or out; everything drawn
  // separately from the body is turned the same way around its middle
  const pitch = swimDir.vy * facing * 0.45 * (1 - e)
  const pc = Math.cos(pitch)
  const ps = Math.sin(pitch)
  const turn = (px: number, py: number): [number, number] => [x + (px - x) * pc - (py - y) * ps, y + (px - x) * ps + (py - y) * pc]
  const pulse = 0.85 + 0.15 * Math.sin(3.1 * t)
  const wag = Math.sin(1.6 * t)

  // The lure, in the fish's own frame (+x toward its face)
  const lureLX = 1.35
  const lureLY = -1.25 + 0.12 * Math.sin(1.7 * t)

  fill(world, x, y, rx, ry, pitch, 1.6, HUE.blue, (lx, ly, c) => {
    const fx = lx * facing
    if (fx > -1 && fx <= 1.02) {
      // Big round head, body tapering hard to the tail
      const half = Math.sqrt(Math.max(0, 1 - fx * fx)) ** 0.8 * (fx < 0 ? 0.5 + 0.5 * (1 + fx) : 1)
      // Spines along the back
      if (ly < -half && fx > -0.55 && fx < 0.2 && ly > -half - 0.28 && Math.sin(fx * 30) > 0.6) {
        c.glyph = code("'")
        return 0.3 * bright
      }
      if (Math.abs(ly) > half) return 0
      // The mouth: a wedge cut into the front, lined with teeth
      const mouth = fx > 0.35 ? (fx - 0.35) * 0.62 : -1
      const my = ly - 0.18
      if (mouth > 0 && Math.abs(my) < mouth) {
        const toEdge = mouth - Math.abs(my)
        if (toEdge * ry < ch * 0.9 && Math.sin(fx * 40) > -0.2) {
          c.hue = HUE.ice
          c.glyph = code(my < 0 ? 'v' : '^')
          return 0.75 * bright
        }
        return 0 // the dark inside of the mouth
      }
      // The eye, small and pale, with a glint
      const ex = (fx - 0.5) / 0.09
      const ey = (ly + 0.45) / 0.13
      if (ex * ex + ey * ey < 1) {
        c.hue = HUE.ice
        c.glyph = code('o')
        return 1.1 * bright
      }
      // Light from the lure, falling off with distance: the head shows, the tail fades into the dark
      const dl = Math.hypot(fx - lureLX, (ly - lureLY) * 0.8)
      const lit = Math.exp(-(dl * dl) / 1.1) * pulse
      if (lit > 0.45) c.hue = HUE.green
      const edge = Math.abs(ly) / Math.max(half, 0.01)
      const skin = hash2(Math.floor(lx * 9), Math.floor(ly * 6)) > 0.72 ? 0.12 : 0
      const gill = 0.25 * Math.exp(-(((fx - 0.15) / 0.05) ** 2)) * (ly > -0.2 ? 1 : 0)
      return (0.12 + 0.45 * edge ** 4 + 0.9 * lit + skin + gill) * bright
    }
    if (fx <= -1 && fx > -1.6) {
      // A fan tail with rays
      const sTail = -1 - fx
      const half = 0.12 + sTail * 1.35
      const yy = ly - wag * 0.2 * sTail
      if (Math.abs(yy) > half) return 0
      return (0.12 + (Math.sin(yy * 14) > 0.3 ? 0.18 : 0)) * bright
    }
    return 0
  })

  // A pectoral fin, fanning
  for (let k = 0; k < 5; k++) {
    const a = 0.6 + k * 0.28 + 0.15 * Math.sin(2.4 * t)
    for (let j = 1; j <= 4; j++) {
      const [fx, fy] = turn(x - facing * rx * 0.12 - facing * Math.cos(a) * j * cw, y + ry * 0.35 + Math.sin(a) * j * ch * 0.45)
      put(fx, fy, 0.22 * bright, HUE.blue, code(j === 4 ? ',' : '.'))
    }
  }

  // The stalk arcs forward from the forehead to the lure
  const [sx, sy] = turn(x + facing * rx * 0.25, y - ry * 0.92)
  const [lx, ly] = turn(x + facing * rx * lureLX, y + ry * lureLY)
  const [kx, ky] = turn(x + facing * rx * 0.95, y - ry * 2.15)
  for (let i = 1; i < 30; i++) {
    const f = i / 30
    const bx = (1 - f) * (1 - f) * sx + 2 * (1 - f) * f * kx + f * f * lx
    const by = (1 - f) * (1 - f) * sy + 2 * (1 - f) * f * ky + f * f * ly
    put(bx, by, (0.28 + 0.3 * f * f) * bright, f > 0.8 ? HUE.green : HUE.blue)
  }

  // The lure: a bright bulb with a halo of light around it
  fill(world, lx, ly, cw * 2.6, ch * 1.5, 0, 1, HUE.green, (ux, uy, c) => {
    const d = ux * ux + uy * uy
    if (d > 1) return 0
    if (d < 0.12) c.glyph = code('@')
    return (0.35 + 2 * (1 - d) ** 2) * pulse * bright
  })
  lights.push({ x: lx, y: ly, r: 140 * s * (1 + glow), a: 0.18 * pulse * p * (1 + 2.5 * glow), rgb: '112, 255, 176' })
}

// Zones: 0 is the surface (the hero), then one per section going down.
export const SPECIES: Species[] = [
  { name: 'fish', zones: [1, 2], draw: fishSchool },
  { name: 'comb jellies', zones: [2, 3, 4], draw: combJellies },
  { name: 'siphonophore', zones: [3, 4, 5], weave: true, draw: siphonophore },
  { name: 'anglerfish', zones: [4, 5], weave: true, draw: anglerfish },
]

export const DEEPEST_ZONE = 5
