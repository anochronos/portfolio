// The deep-sea scene, drawn entirely in characters, on three canvases fixed
// to the screen: the sky, the water, marine snow and light behind the page,
// the sea creatures in front of everything (so they swim over any text or
// tile), and their glow. On the home page a night sky sits above the
// waterline, which runs just under the first name. Every section is one step
// deeper: the water darkens and new creatures (sealife.ts) swim in, glowing
// as they arrive. On first load the jellyfish draw themselves in: the bell
// from the top down, then the tentacles growing out of it.
//
// Everything is drawn into one grid of character cells. Each frame:
//   1. the jellyfish are sampled as clouds of points (bell, tentacles, oral
//      arms) and each point adds light to the cell it lands in;
//   2. marine snow and sonar pings fill in their cells, on the back layer;
//   3. every lit cell becomes a character: denser characters for brighter
//      cells, and slanted ones along tentacles so strands read as lines.
// The light comes from the jellyfish themselves: each beat sends a ring of
// light from the crown of the bell to the rim and then down the tentacles,
// each one lights the water around it, and a blurred copy of the characters
// (a tight bloom and a wide haze) makes them glow. Reaching a new section
// makes them flash.
//
// This file never touches the page. SeaScene.vue measures what it needs from
// the page (where the waterline is, the cursor, the zone) and sends it here as
// messages, so all of this can run in a background thread (sea.worker.ts)
// where the browser allows, and on the page where it doesn't.
//
// The idea of an ASCII jellyfish comes from dang0321's code-art series
// (https://github.com/dang0321/code-art). This code is written from scratch.
import { RAMP, HUE, colorIndex, COLOR_RGB, rampIndex, GlyphAtlas, smoothstep, hash2, type GlyphSheet } from '../ascii'
import { SPECIES, DEEPEST_ZONE, type Light, type Swim, type World } from '../sealife'
import { waveAt, nameRide, MOON_R, skyMoonR } from '../water'
import { createSeafloor } from './seafloor'

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// ---- messages ---------------------------------------------------------------

export interface CursorState {
  mode: 'none' | 'moon' | 'sub'
  x: number
  y: number
  moon: { x: number; y: number } | null
  sub: { x: number; y: number } | null
}

// Where the first name sits on screen, for its reflection: its left and
// right edges, screen pixels per unit of its SVG, and how far below its
// baseline (in those units) the waterline sits
export interface NameGeometry {
  x0: number
  x1: number
  k: number
  gap: number
}

// A rectangle on screen
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Geometry {
  // The waterline on screen (-Infinity when the whole page is under water)
  waterY: number
  // The project tile in focus: creatures pass behind it
  focus: Rect | null
  // The top of the big contact links, which the reef at the sides grows up towards
  reefTop: number
  // The bottom of the page on screen, where the sea floor is
  floorY: number
  name: NameGeometry | null
}

// The first name drawn small, for the reflection to look up: its pixels'
// opacity, size, baseline, and hidden-canvas pixels per SVG unit
export interface ReflectionSource {
  data: Uint8ClampedArray
  w: number
  h: number
  base: number
  scale: number
}

export interface LayoutMsg {
  W: number
  H: number
  dpr: number
  backDpr: number
  cw: number
  ch: number
  fine: boolean
  waterY: number
  atlas: GlyphSheet
  backAtlas: GlyphSheet
}

export type ToEngine =
  | ({ type: 'layout' } & LayoutMsg)
  | ({ type: 'state'; pointer: { x: number; y: number; on: boolean }; cursor: CursorState } & Geometry)
  | { type: 'weave'; mask: Uint8Array }
  | { type: 'reflection'; src: ReflectionSource | null }
  | { type: 'zone'; zone: number }
  // While the boat tows the first name in on load: how far left of its place it is (px)
  | { type: 'tow'; dx: number }
  // No graphics acceleration: blend the glow in here, and draw a bit less often (utils/lite.ts)
  | { type: 'lite' }
  // The crab stops to talk while its speech bubble is up (CrabSecret.vue)
  | { type: 'crab'; talking: boolean }
  // While the big jellyfish carries the surname up on load: where the surname's
  // middle and bottom are on screen; null when it lets go
  | { type: 'lift'; x: number; bottom: number } | { type: 'lift'; x: null; bottom: null }
  // Day or night (holding down the moon or the sun switches it)
  | { type: 'theme'; day: boolean; instant?: boolean }
  | { type: 'ping'; x: number; y: number }
  | { type: 'run'; visible: boolean; focused: boolean; reduce: boolean }
  | { type: 'stop' }

export type FromEngine =
  // The surface's moving shape, for the cursor's bubbles and splashes
  // and where the tip of the boat's flag is (null when the boat is out of view)
  | { type: 'surface'; clock: number; amp: number; cw: number; boat: { x: number; y: number } | null; crab: { x: number; y: number } | null }
  // Canvas filters aren't available here: blur the glow layer in CSS instead
  | { type: 'cssBlur' }

export interface SeaCanvases {
  back: AnyCanvas
  main: AnyCanvas
  glow: AnyCanvas
}

interface Strand {
  th: number
  cth: number
  sth: number
  len: number
  phase: number
  amp: number
}

interface Jelly {
  x: number
  y0: number
  R: number
  period: number
  step: number
  phase: number
  dim: number
  seed: number
  nPhi: number
  nTh: number
  samples: number
  tentacles: Strand[]
  arms: Strand[]
  reach: number
  // Where it is now (the middle of the bell, in screen pixels), whether it
  // has stopped swimming to sink away from the surface, and how relaxed its
  // beat is because of that (0 to 1)
  y: number
  sinking: boolean
  sinkFor: number
  relax: number
  // Where it has been over the last few seconds, so the tentacles can trail
  hist: { t: number; y: number }[]
  // Sines, cosines and patterns for the bell's sample grid, worked out once
  table: BellTable
}

interface BellTable {
  phi: Float32Array
  sinPhi: Float32Array
  cosPhi: Float32Array
  rim: Float32Array
  gonad: Float32Array
  // Two rows of angles around the bell (every other ring is offset by half a step)
  cosTh: Float32Array
  sinTh: Float32Array
  canal: Float32Array
  gonadTh: Float32Array
}

function bellTable(nPhi: number, nTh: number): BellTable {
  const T: BellTable = {
    phi: new Float32Array(nPhi),
    sinPhi: new Float32Array(nPhi),
    cosPhi: new Float32Array(nPhi),
    rim: new Float32Array(nPhi),
    gonad: new Float32Array(nPhi),
    cosTh: new Float32Array(nTh * 2),
    sinTh: new Float32Array(nTh * 2),
    canal: new Float32Array(nTh * 2),
    gonadTh: new Float32Array(nTh * 2),
  }
  for (let a = 0; a < nPhi; a++) {
    const phi = ((a + 0.5) / nPhi) * PHI_MAX
    T.phi[a] = phi
    T.sinPhi[a] = Math.sin(phi)
    T.cosPhi[a] = Math.cos(phi)
    T.rim[a] = 1.1 * Math.exp(-(((PHI_MAX - phi) / 0.09) ** 2))
    T.gonad[a] = 0.55 * Math.exp(-(((phi - 0.62) / 0.13) ** 2))
  }
  for (let odd = 0; odd < 2; odd++) {
    for (let q = 0; q < nTh; q++) {
      const th = ((q + 0.5 + 0.5 * odd) / nTh) * Math.PI * 2
      const i = odd * nTh + q
      T.cosTh[i] = Math.cos(th)
      T.sinTh[i] = Math.sin(th)
      T.canal[i] = 0.35 * Math.exp(-((Math.sin(4 * th) / 0.1) ** 2))
      T.gonadTh[i] = Math.max(0, Math.cos(4 * th)) ** 3
    }
  }
  return T
}

const TILT = -0.22 // we look slightly up at the bell, so the rim reads as an ellipse
const PHI_MAX = 1.78 // a little past the equator, so the rim tucks under
const LAG = 2.6 // seconds it takes a ripple to travel down a tentacle

export function createSeaEngine(
  canvases: SeaCanvases,
  emit: (m: FromEngine) => void,
  makeCanvas: (w: number, h: number) => AnyCanvas,
) {
  const bv = canvases.back
  const cv = canvases.main
  const gv = canvases.glow
  const bctx = bv.getContext('2d') as Ctx2D
  const ctx = cv.getContext('2d') as Ctx2D
  const gctx = gv.getContext('2d') as Ctx2D
  let surfaceAmp = 0
  let boatFlag: { x: number; y: number } | null = null
  let towDx = 0
  let crabAt: { x: number; y: number } | null = null
  let crabT = 0
  let crabTalking = false
  let lite = false
  let lift: { x: number; bottom: number } | null = null
  let homeX = NaN // where the big jellyfish drifts to after letting go
  let towing = false
  let towEnd = -Infinity

  // Soft round glows, drawn once per colour and then stretched into place,
  // instead of building a new gradient for every light every frame
  const sprites = new Map<string, AnyCanvas>()
  function halo(c: Ctx2D, scale: number, x: number, y: number, r: number, rgb: string, a: number) {
    if (a <= 0.003 || r <= 0) return
    let sprite = sprites.get(rgb)
    if (!sprite) {
      sprite = makeCanvas(128, 128)
      const g = sprite.getContext('2d') as Ctx2D
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
      grad.addColorStop(0, `rgba(${rgb}, 1)`)
      grad.addColorStop(0.4, `rgba(${rgb}, 0.35)`)
      grad.addColorStop(1, `rgba(${rgb}, 0)`)
      g.fillStyle = grad
      g.fillRect(0, 0, 128, 128)
      sprites.set(rgb, sprite)
    }
    c.globalAlpha = Math.min(1, a)
    c.drawImage(sprite, (x - r) * scale, (y - r) * scale, r * 2 * scale, r * 2 * scale)
    c.globalAlpha = 1
  }

  const drawSeafloor = createSeafloor(makeCanvas)

  // Level of detail: 1 draws every point of the jellyfish, 2 every other one.
  // It steps down by itself on a machine that can't keep up, and back up
  // when there's room.
  let lod = 1
  let frameCost = 0
  let costFrames = 0

  // ---- grid and buffers -------------------------------------------------
  let W = 0
  let H = 0
  let dpr = 1
  // The back layer is drawn at a lower resolution on very sharp screens:
  // it is soft light, waves and snow, and the saving in pixels is large
  let bd = 1
  let fine = false
  let cw = 6
  let ch = 11
  let cols = 0
  let rows = 0
  let atlas: GlyphAtlas
  let batlas: GlyphAtlas
  let bellBuf = new Float32Array(0)
  let tentBuf = new Float32Array(0)
  let armBuf = new Float32Array(0)
  let dirX = new Float32Array(0)
  let dirY = new Float32Array(0)
  let snowBuf = new Uint8Array(0)
  let pingBuf = new Uint8Array(0)
  let jellies: Jelly[] = []
  let snow: { x: number; y: number; z: number; s: number }[] = []
  let stars: { x: number; h: number; s: number; ph: number }[] = []
  // Light from the other sea creatures, and which hue and character won each cell
  let lifeLum = new Float32Array(0)
  let lifeMax = new Float32Array(0)
  let lifeHue = new Uint8Array(0)
  let lifeGlyph = new Uint16Array(0)
  // Which creature won each cell (index into SPECIES, plus one), and the cells
  // where a letter of the big text sits in front of the weaving creatures
  let lifeKind = new Uint8Array(0)
  let weave = new Uint8Array(0)
  // The glow: one pixel per character cell, holding the colour of whatever
  // creature character is there, blurred and stretched to make the bloom
  const glowSrc = makeCanvas(1, 1)
  const glowCtx = glowSrc.getContext('2d') as Ctx2D
  let glowPx = new ImageData(1, 1)
  // The wide haze, worked out at a tenth of the screen's size and folded into the glow layer
  const hv = makeCanvas(1, 1)
  const hctx = hv.getContext('2d') as Ctx2D
  // Canvas filters are missing in some browsers; there the glow is blurred in CSS instead
  const canvasFilter = 'filter' in gctx
  if (!canvasFilter) emit({ type: 'cssBlur' })
  // The height of the surface at each column, worked out once per frame
  let surfRow = new Float32Array(0)
  // The front layer's characters for this frame, queued to draw after their dark cells
  let qGlyph: string[] = []
  let qColor = new Uint16Array(0)
  let qX = new Float32Array(0)
  let qY = new Float32Array(0)

  function layout(m: LayoutMsg) {
    W = m.W
    H = m.H
    if (!W || !H) return
    dpr = m.dpr
    bd = m.backDpr
    cw = m.cw
    ch = m.ch
    fine = m.fine
    geo.waterY = m.waterY
    cols = Math.ceil(W / cw)
    rows = Math.ceil(H / ch)
    atlas = new GlyphAtlas(m.atlas)
    batlas = new GlyphAtlas(m.backAtlas)

    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
    bv.width = Math.round(W * bd)
    bv.height = Math.round(H * bd)
    gv.width = Math.ceil(W / 4)
    gv.height = Math.ceil(H / 4)
    hv.width = Math.ceil(W / 10)
    hv.height = Math.ceil(H / 10)
    glowSrc.width = cols
    glowSrc.height = rows
    glowPx = new ImageData(cols, rows)
    surfRow = new Float32Array(cols + 3)
    qGlyph = new Array<string>(cols * rows)
    qColor = new Uint16Array(cols * rows)
    qX = new Float32Array(cols * rows)
    qY = new Float32Array(cols * rows)

    const n = cols * rows
    bellBuf = new Float32Array(n)
    tentBuf = new Float32Array(n)
    armBuf = new Float32Array(n)
    dirX = new Float32Array(n)
    dirY = new Float32Array(n)
    snowBuf = new Uint8Array(n)
    pingBuf = new Uint8Array(n)
    lifeLum = new Float32Array(n)
    lifeMax = new Float32Array(n)
    lifeHue = new Uint8Array(n)
    lifeGlyph = new Uint16Array(n)
    lifeKind = new Uint8Array(n)
    weave = new Uint8Array(n)

    placeJellies()
    scatterSnow()
    scatterStars()
  }

  function makeJelly(seed: number, x: number, y0: number, R: number, period: number, dim: number, detail: number): Jelly {
    const nTent = Math.round(20 * detail)
    const tentacles: Strand[] = []
    for (let k = 0; k < nTent; k++) {
      const th = ((k + 0.5) / nTent) * Math.PI * 2 + (hash2(seed, k) - 0.5) * 0.18
      tentacles.push({
        th,
        cth: Math.cos(th),
        sth: Math.sin(th),
        len: R * (2.6 + 1.8 * hash2(k, seed + 3)),
        phase: hash2(seed + 7, k) * Math.PI * 2,
        amp: 0.08 + 0.1 * hash2(k + 11, seed),
      })
    }
    const arms: Strand[] = []
    for (let k = 0; k < 4; k++) {
      const th = (k / 4) * Math.PI * 2 + Math.PI / 4
      arms.push({
        th,
        cth: Math.cos(th),
        sth: Math.sin(th),
        len: R * (1.45 + 0.4 * hash2(seed + 5, k)),
        phase: hash2(k, seed + 13) * Math.PI * 2,
        amp: 0,
      })
    }
    const reach = Math.max(...tentacles.map((t) => t.len)) + R * 1.2
    return {
      x,
      y0,
      R,
      period,
      step: R * 0.45,
      phase: hash2(seed, 99) * period,
      dim,
      seed,
      nPhi: Math.round(34 * detail),
      nTh: Math.round(100 * detail),
      table: bellTable(Math.round(34 * detail), Math.round(100 * detail)),
      samples: Math.round(64 * detail),
      tentacles,
      arms,
      reach,
      y: y0,
      sinking: false,
      sinkFor: 0,
      relax: 0,
      hist: [],
    }
  }

  function placeJellies() {
    const small = W < 768
    const R = small ? Math.max(48, W * 0.2) : Math.max(80, Math.min(170, W * 0.095))
    // Start every jellyfish under water, clear of the surface
    const level = geo.waterY
    const below = (y: number, r: number) => (Number.isFinite(level) ? Math.max(y, level + r * 1.05 + ch * 4) : y)
    jellies = [
      makeJelly(3, W * (small ? 0.62 : 0.72), below(H * (small ? 0.9 : 0.92), R), R, 3.4, 1, 1),
      makeJelly(9, W * (small ? 0.14 : 0.16), below(H * 0.82, R * 0.42), R * 0.42, 4.3, 0.42, 0.6),
    ]
    // The third, smallest one stays clear of the surname when the surface is on screen
    if (!small) jellies.push(makeJelly(21, W * (Number.isFinite(level) ? 0.42 : 0.88), below(H * 0.28, R * 0.3), R * 0.3, 3.9, 0.3, 0.5))
  }

  function scatterSnow() {
    const count = Math.round((W * H) / 9000)
    snow = Array.from({ length: count }, (_, i) => ({
      x: hash2(i, 1) * W,
      y: hash2(i, 2) * H,
      z: 0.2 + 0.8 * hash2(i, 3),
      s: hash2(i, 4) * 6.283,
    }))
  }

  // Stars hang at a height above the waterline, so they leave with the sky
  // as you scroll down.
  function scatterStars() {
    const count = Math.round((W * H) / 6500)
    stars = Array.from({ length: count }, (_, i) => ({
      x: hash2(i, 31) * W,
      h: 8 + hash2(i, 32) * H,
      s: hash2(i, 33),
      ph: hash2(i, 34) * 6.283,
    }))
  }

  // ---- jellyfish motion -------------------------------------------------
  function contraction(j: Jelly, t: number): number {
    const ph = (((t + j.phase) % j.period) + j.period) % j.period / j.period
    const easy = 1 - 0.85 * j.relax // a sinking jellyfish barely pulses
    if (ph < 0.16) return smoothstep(ph / 0.16) * easy // a quick squeeze
    return (1 - smoothstep((ph - 0.16) / 0.55)) * easy // then a slow refill
  }

  function rise(j: Jelly, t: number): number {
    const u = (t + j.phase) / j.period
    const k = Math.floor(u)
    const ph = u - k
    return j.step * (k + 0.75 * smoothstep(ph / 0.4) + 0.25 * ph)
  }

  // Move a jellyfish on by one frame. It swims up a little with every beat.
  // If it gets near the surface it stops swimming and sinks, the way real
  // ones do, so it never pokes out of the water and vanishes; after a while
  // deeper down it starts swimming again. With no surface on screen it
  // carries on up and off the top, and comes back in from below.
  function moveJelly(j: Jelly, t: number, dt: number, waterY: number) {
    const surface = Number.isFinite(waterY) && waterY > -j.R ? waterY + ch * 2.5 : -Infinity
    const top = j.y - j.R * 1.05
    if (!j.sinking) {
      j.y -= Math.max(0, rise(j, t) - rise(j, t - dt)) * (1 - j.relax)
      if (top < surface) {
        j.sinking = true
        j.sinkFor = 0
      }
    } else {
      j.sinkFor += dt
      // Sink gently, or faster if scrolling has brought the surface down onto it
      const over = Math.max(0, surface - top)
      j.y += (j.R * 0.2 + over * 2.5) * dt
      const deep = !Number.isFinite(surface) || top > surface + Math.max(H * 0.2, j.R)
      if (j.sinkFor > 5 && deep) j.sinking = false
    }
    j.relax += ((j.sinking ? 1 : 0) - j.relax) * Math.min(1, dt * 1.2)

    // Wrapping round moves its whole recent path too, so nothing streaks across
    let jump = 0
    if (j.y < -j.reach) jump = H + j.R * 1.3 + j.reach
    else if (j.y > H + j.reach) j.sinking = false
    if (jump) {
      j.y += jump
      for (const h of j.hist) h.y += jump
    }

    j.hist.push({ t, y: j.y })
    while (j.hist.length > 2 && j.hist[1]!.t < t - LAG - 0.5) j.hist.shift()
  }

  // On load the big jellyfish carries the surname up from the deep on top of
  // its bell, beating as it swims (see TowIn.vue)
  function carry(j: Jelly, t: number, dt: number) {
    if (!lift) return
    j.x = lift.x
    j.y = lift.bottom + j.R * 0.95
    j.sinking = false
    j.relax += (0 - j.relax) * Math.min(1, dt * 1.2)
    j.hist.push({ t, y: j.y })
    while (j.hist.length > 2 && j.hist[1]!.t < t - LAG - 0.5) j.hist.shift()
  }

  // Where the middle of the bell was at time t (now, or a moment ago)
  function depthAt(j: Jelly, t: number): number {
    const h = j.hist
    const n = h.length
    if (!n || t >= h[n - 1]!.t) return j.y
    if (t <= h[0]!.t) return h[0]!.y
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (h[mid]!.t <= t) lo = mid
      else hi = mid
    }
    const a = h[lo]!
    const b = h[hi]!
    return a.y + ((b.y - a.y) * (t - a.t)) / Math.max(1e-6, b.t - a.t)
  }

  function sway(j: Jelly, t: number): number {
    return j.R * (0.35 * Math.sin(0.13 * t + j.seed) + 0.18 * Math.sin(0.31 * t + j.seed * 2))
  }

  function roll(j: Jelly, t: number): number {
    return 0.1 * Math.sin(0.19 * t + j.seed) + 0.05 * Math.sin(0.47 * t + j.seed * 3)
  }

  // A jellyfish's whole-body state at one moment: how squeezed the bell is,
  // its size, where its middle is and how far it has rolled. Worked out once
  // per moment and shared by every point drawn for that moment, which is
  // most of what keeps drawing them cheap.
  interface Pose {
    c: number
    R: number
    Hh: number
    bx: number
    by: number
    cr: number
    sr: number
  }
  const newPose = (): Pose => ({ c: 0, R: 0, Hh: 0, bx: 0, by: 0, cr: 1, sr: 0 })
  function poseAt(j: Jelly, t: number, P: Pose): Pose {
    P.c = contraction(j, t)
    P.R = j.R * (1 - 0.16 * P.c)
    P.Hh = j.R * 0.92 * (1 + 0.1 * P.c)
    P.bx = j.x + sway(j, t)
    P.by = depthAt(j, t)
    const r = roll(j, t)
    P.cr = Math.cos(r)
    P.sr = Math.sin(r)
    return P
  }

  const CT = Math.cos(TILT)
  const ST = Math.sin(TILT)

  // A point on the bell, given the sine and cosine of its two angles (phi
  // down from the crown, th around), in screen pixels, plus its depth
  // (positive faces us) and how edge-on the surface is there.
  const out = { x: 0, y: 0, z: 0, edge: 0 }
  function bellPoint(P: Pose, u: number, sp: number, cp: number, cth: number, sth: number, edge: boolean) {
    const flare = 1 + 0.08 * Math.max(0, u - 0.75) * (1 - 2.2 * P.c)
    const x = P.R * sp * cth * flare
    const y = -P.Hh * cp
    const z = P.R * sp * sth * flare
    const y1 = y * CT + z * ST
    out.x = P.bx + x * P.cr - y1 * P.sr
    out.y = P.by + x * P.sr + y1 * P.cr
    out.z = -y * ST + z * CT
    if (edge) {
      // Surface normal of the dome, tilted the same way, for the edge glow
      const nx = (sp * cth) / P.R
      const ny = -cp / P.Hh
      const nz = (sp * sth) / P.R
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      out.edge = 1 - Math.abs((-ny * ST + nz * CT) / nl)
    }
  }

  // How much of each jellyfish has been drawn in so far (0 to 1)
  let bellGrow = 1
  let tentGrow = 1

  function deposit(buf: Float32Array, x: number, y: number, w: number): number {
    const c = Math.floor(x / cw)
    const r = Math.floor(y / ch)
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1
    const i = r * cols + c
    buf[i]! += w
    return i
  }

  // Every light source this frame (jellyfish and the other creatures)
  const halos: Light[] = []
  // A flash of light when a new section comes into view (1 = just now)
  let burst = 0

  // 0 at the start of a beat, rising to 1 by the next one
  function beat(j: Jelly, t: number): number {
    return ((((t + j.phase) % j.period) + j.period) % j.period) / j.period
  }

  // Poses reused from frame to frame: one for now, and one per sample down
  // the tentacles and arms (each sample shows the bell a moment earlier)
  const now = newPose()
  let tentPoses: Pose[] = []
  let armPoses: Pose[] = []

  function drawJelly(j: Jelly, t: number) {
    const P = poseAt(j, t, now)
    // Nothing of it on screen: nothing to draw
    if (P.by - j.R * 1.4 > H || P.by + j.reach < -j.R) return
    const flash = (1 + 0.35 * P.c) * (1 + 1.4 * burst)

    // Each beat, a ring of light runs from the crown of the bell to its rim,
    // then carries on down the tentacles.
    const b = beat(j, t)
    const ringAt = b / 0.4
    const ringFade = 1 - b

    bellPoint(P, 0.9 / PHI_MAX, Math.sin(0.9), Math.cos(0.9), 0, 1, false)
    halos.push({
      x: P.bx,
      y: out.y,
      r: j.R * (3 + 0.6 * P.c + 1.5 * burst),
      a: (0.1 + 0.08 * P.c) * (1 + 1.6 * burst) * j.dim,
      rgb: '92, 207, 255',
    })

    // Bell
    const gain = (2.2 * Math.PI * j.R * j.R) / (j.nPhi * j.nTh * cw * ch)
    const T = j.table
    for (let a = 0; a < j.nPhi; a++) {
      const phi = T.phi[a]!
      if (phi > PHI_MAX * bellGrow) break
      const u = phi / PHI_MAX
      const sp = T.sinPhi[a]!
      const cp = T.cosPhi[a]!
      const rim = T.rim[a]!
      const gonadPhi = T.gonad[a]!
      const ring = ringAt < 1.2 ? 1.2 * Math.exp(-(((u - ringAt) / 0.09) ** 2)) * ringFade : 0
      const base = 0.07 + rim + ring
      const off = (a % 2) * j.nTh
      for (let q = a % lod; q < j.nTh; q += lod) {
        const i = off + q
        bellPoint(P, u, sp, cp, T.cosTh[i]!, T.sinTh[i]!, true)
        let w = base + 1.05 * out.edge ** 2.6 + T.canal[i]! * u + gonadPhi * T.gonadTh[i]!
        if (out.z < 0) w *= 0.5
        deposit(bellBuf, out.x, out.y, w * gain * 0.5 * flash * j.dim * lod)
      }
    }

    // Tentacles: each point copies where its root was a moment ago, so a
    // squeeze of the bell travels down the strand as a wave.
    const n = j.samples
    while (tentPoses.length <= n) tentPoses.push(newPose())
    for (let k = 0; k <= n; k += lod) poseAt(j, t - (k / n) * LAG, tentPoses[k]!)
    const tentAt = (b - 0.3) / 0.65
    const sRim = Math.sin(PHI_MAX * 0.98)
    const cRim = Math.cos(PHI_MAX * 0.98)
    for (const s of j.tentacles) {
      const spacing = (s.len * 0.9) / n
      const g = Math.min(1, spacing / ch) * j.dim
      let px = 0
      let py = 0
      for (let k = 0; k <= n; k += lod) {
        const f = k / n
        if (f > tentGrow) break
        const Q = tentPoses[k]!
        bellPoint(Q, 0.98, sRim, cRim, s.cth, s.sth, false)
        const front = out.z >= 0 ? 1 : 0.55
        const fan = (out.x - Q.bx) * 0.3 * f
        const x =
          out.x +
          fan +
          s.amp * s.len * f ** 1.35 * Math.sin(6.6 * f - 1.15 * t + s.phase) +
          0.035 * s.len * f * Math.sin(17 * f - 1.9 * t + 2 * s.phase)
        const y = out.y + f * s.len * 0.62 + 0.04 * s.len * f * Math.sin(5 * f - 0.9 * t + s.phase)
        if (k > 0) {
          const pulse = 1 + 1.8 * Math.exp(-(((f - tentAt) / 0.07) ** 2))
          const w = 0.5 * (1 - 0.8 * f ** 1.3) * front * g * pulse * (1 + 0.8 * burst) * lod
          const i = deposit(tentBuf, x, y, w)
          if (i >= 0) {
            dirX[i]! += (x - px) * w
            dirY[i]! += (y - py) * w
          }
        }
        px = x
        py = y
      }
    }

    // Oral arms: four ruffled curtains hanging from the middle of the bell
    const armSamples = Math.round(n * 0.75)
    while (armPoses.length <= armSamples) armPoses.push(newPose())
    for (let k = lod; k <= armSamples; k += lod) poseAt(j, t - (k / armSamples) * LAG * 0.7, armPoses[k]!)
    const sArm = Math.sin(0.35)
    const cArm = Math.cos(0.35)
    for (const s of j.arms) {
      const g = Math.min(1, (s.len * 0.9) / armSamples / ch) * j.dim
      for (let k = lod; k <= armSamples; k += lod) {
        const f = k / armSamples
        if (f > tentGrow) break
        bellPoint(armPoses[k]!, 0.35 / PHI_MAX, sArm, cArm, s.cth, s.sth, false)
        const cx = out.x + 0.12 * j.R * f * Math.sin(4.4 * f - 0.8 * t + s.phase)
        const cy = out.y + j.R * 0.55 + f * s.len * 0.85
        const width = j.R * 0.16 * (1 - 0.5 * f) * (0.55 + 0.45 * Math.sin(31 * f - 2.1 * t + s.phase))
        const w = 0.38 * (1 - 0.6 * f) * g * lod
        deposit(armBuf, cx - width, cy, w)
        deposit(armBuf, cx, cy, w)
        deposit(armBuf, cx + width, cy, w)
      }
    }
  }

  // ---- what the page tells us ---------------------------------------------
  const pointer = { x: 0, y: 0, on: false }
  const cursor: CursorState = { mode: 'none', x: 0, y: 0, moon: null, sub: null }
  const geo: Geometry = { waterY: -Infinity, focus: null, reefTop: NaN, floorY: Infinity, name: null }
  const pings: { x: number; y: number; t: number }[] = []
  let pulseAt = -10
  let reduce = false
  // Day or night, and how far the sky has turned (0 night, 1 day)
  let day = false
  let dayMix = 0

  function ping(x: number, y: number) {
    if (reduce) return
    pings.push({ x, y, t: clock })
    if (pings.length > 4) pings.shift()
  }
  // Depth: which section is on screen (0 is the surface), eased into `deep`
  let zone = 0
  let deep = 0
  const presence = SPECIES.map(() => 0)
  const arrivedAt = SPECIES.map(() => -10)
  // Which way each creature swims in or out (see Swim in sealife.ts). On the
  // first load they all rise in from below.
  const swims: Swim[] = SPECIES.map(() => ({ side: 1, vy: -1 }))

  // A new section came into view: go a zone deeper (or shallower), and the
  // jellyfish flash.
  function onZone(next: number) {
    if (next === zone) return
    const deeper = next > zone
    SPECIES.forEach((sp, k) => {
      const was = sp.zones.includes(zone)
      const now = sp.zones.includes(next)
      if (was === now) return
      // Arriving: from below when heading deeper, from above when heading up.
      // Leaving: up and away when heading deeper, down when heading up.
      const side = deeper === now ? 1 : -1
      swims[k] = { side, vy: now ? -side : side }
    })
    zone = next
    if (reduce) {
      deep = zone / DEEPEST_ZONE
      SPECIES.forEach((sp, k) => (presence[k] = sp.zones.includes(zone) ? 1 : 0))
      frame()
      return
    }
    pulseAt = clock
  }

  function mixRGB(a: number[], b: number[], t: number): number[] {
    return a.map((v, k) => v + (b[k]! - v) * t)
  }

  function mixColor(a: number[], b: number[], t: number): string {
    return `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * t)).join(',')})`
  }

  // ---- frame ------------------------------------------------------------
  let clock = 0
  let lastClock = 0
  const glyphOf = new Map<number, string>()

  let drawing = 0 // the creature being drawn, so put() can tag its cells

  function put(x: number, y: number, w: number, hue: number, glyph = 0) {
    const c = Math.floor(x / cw)
    const r = Math.floor(y / ch)
    if (c < 0 || r < 0 || c >= cols || r >= rows) return
    const i = r * cols + c
    lifeLum[i]! += w
    if (w > lifeMax[i]!) {
      lifeMax[i] = w
      lifeHue[i] = hue
      lifeGlyph[i] = glyph
      lifeKind[i] = drawing
    }
  }

  // ---- the first name's reflection ---------------------------------------
  // "Akshun" is drawn once, small, into a hidden canvas. Each frame the
  // water under it looks up that drawing upside down, with ripples pulling
  // it side to side, and turns what it finds into wave characters.
  let refl: ReflectionSource | null = null

  function drawReflection(waterY: number, surfaceAt: (c: number) => number, shown: number) {
    if (!refl || shown <= 0) return
    const name = geo.name
    if (!name) return
    // Where the name sits on screen, and its scale (see NameGeometry)
    const { x0, x1, k, gap } = name
    const depth = (gap + refl.base / refl.scale) * k // how far down the reflection reaches
    const sx = (refl.w - 4) / (((x1 - x0) / k) * refl.scale) // the hidden text's width against the SVG's
    const c0 = Math.max(0, Math.floor(x0 / cw) - 2)
    const c1 = Math.min(cols - 1, Math.ceil(x1 / cw) + 2)
    const r0 = Math.max(0, Math.floor(waterY / ch))
    const r1 = Math.min(rows - 1, Math.ceil((waterY + depth + ch * 2) / ch))
    for (let row = r0; row <= r1; row++) {
      const y = (row + 0.5) * ch
      // Each row of water breaks the image up a little differently
      const band = 0.78 + 0.22 * Math.sin(row * 2.1 + clock * 2.3)
      const sway1 = Math.sin(y * 0.09 + clock * 2.2)
      const sway2 = Math.sin(y * 0.23 - clock * 3.1)
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * cw
        const below = y - surfaceAt(c) - ch * 0.4
        if (below <= 0) continue
        const f = below / depth
        if (f > 1) continue
        const wobble = sway1 * (1.5 + below * 0.05) + sway2 * (0.5 + below * 0.02)
        // Height above the baseline that this bit of water is mirroring. The
        // letters ride the swell (see nameRide), so when one is carried down
        // toward the water its reflection comes up to meet it.
        const ride = reduce ? 0 : nameRide(x, clock, surfaceAmp, cw)
        const hUnits = (below + ride) / k - gap
        if (hUnits < 0) continue
        const px = Math.round(2 + ((x + wobble - x0) / k) * refl.scale * sx)
        const py = Math.round(refl.base - hUnits * refl.scale)
        if (px < 0 || px >= refl.w || py < 0 || py >= refl.h) continue
        const a = refl.data[(py * refl.w + px) * 4 + 3]! / 255
        if (a < 0.3) continue
        if (hash2(c * 0.7, row + Math.floor(clock * 6)) < 0.03 + f * f * 0.3) continue
        const v = a * band * (1 - 0.6 * f) * shown
        if (v < 0.08) continue
        // Close to the surface the letters read clearly; deeper down they
        // break into ripples
        const glyph = f < 0.55 ? RAMP[Math.max(2, rampIndex(v * 0.8))]! : v > 0.62 ? '=' : v > 0.4 ? '~' : v > 0.22 ? '-' : '.'
        batlas.draw(bctx, glyph, colorIndex(f < 0.55 ? HUE.ice : HUE.cyan, Math.round(2 + v * 6)), Math.round(c * cw * bd) - 1, Math.round(row * ch * bd) - 1)
      }
    }
  }

  // Clouds for the daytime sky: soft puffs of characters drifting slowly
  // across, lit from above. Each is a few overlapping round puffs.
  function drawClouds(waterY: number, shown: number) {
    const n = W < 768 ? 3 : 5
    for (let k = 0; k < n; k++) {
      const span = W + 400
      const cx = ((hash2(k, 61) * span + clock * (6 + 5 * hash2(k, 62))) % span) - 200
      const cy = waterY * (0.12 + 0.42 * hash2(k, 63))
      const size = (W < 768 ? 40 : 60) * (0.7 + 0.6 * hash2(k, 64))
      if (cy + size < 0 || cy - size > waterY - ch * 3) continue
      const puffs = [
        [-1.1, 0.25, 0.6],
        [-0.45, -0.1, 0.85],
        [0.35, -0.2, 1],
        [1.05, 0.2, 0.65],
      ]
      const c0 = Math.floor((cx - size * 2) / cw)
      const c1 = Math.ceil((cx + size * 2) / cw)
      const r0 = Math.max(0, Math.floor((cy - size) / ch))
      const r1 = Math.ceil((cy + size * 0.6) / ch)
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = (c + 0.5) * cw
          const y = (r + 0.5) * ch
          if (y > waterY - ch * 2) continue
          let d = 0
          for (const [px, py, pr] of puffs) {
            const dx = (x - (cx + px! * size)) / (size * pr!)
            const dy = (y - (cy + py! * size)) / (size * pr! * 0.62)
            d = Math.max(d, 1 - (dx * dx + dy * dy))
          }
          // Flat underneath, as clouds are
          if (d <= 0 || y > cy + size * 0.38) continue
          const top = Math.max(0, (cy - y) / size + 0.4)
          const v = Math.min(1, d * 1.6) * (0.55 + 0.45 * top)
          // Soft, rounded characters, densest in the middle of the puff
          const g = v < 0.3 ? '.' : v < 0.5 ? '-' : v < 0.72 ? '~' : '='
          batlas.draw(bctx, g, colorIndex(HUE.ice, Math.round((5 + v * 4) * shown)), Math.round(c * cw * bd) - 1, Math.round(r * ch * bd) - 1)
        }
      }
    }
  }

  function frame() {
    if (!cols) return
    const dt = Math.max(0, Math.min(0.1, clock - lastClock))
    lastClock = clock
    // The sky turns over a second or two
    if (reduce) dayMix = day ? 1 : 0
    else dayMix += ((day ? 1 : 0) - dayMix) * Math.min(1, dt * 1.6)

    bellBuf.fill(0)
    tentBuf.fill(0)
    armBuf.fill(0)
    dirX.fill(0)
    dirY.fill(0)
    snowBuf.fill(0)
    pingBuf.fill(0)
    lifeLum.fill(0)
    lifeMax.fill(0)
    lifeKind.fill(0)

    bellGrow = smoothstep((clock - 0.2) / 1.5)
    tentGrow = smoothstep((clock - 1.1) / 2.2)
    const since = clock - pulseAt
    burst = since >= 0 && since < 4 ? Math.exp(-since / 0.8) : 0
    halos.length = 0
    const waterY = geo.waterY
    for (const j of jellies) {
      if (lift && j === jellies[0]) carry(j, clock, dt)
      else {
        moveJelly(j, clock, dt, waterY)
        // Having let go of the surname, the big one drifts off to one side
        if (j === jellies[0] && Number.isFinite(homeX)) {
          j.x += (homeX - j.x) * Math.min(1, dt * 0.35)
          if (Math.abs(homeX - j.x) < 1) homeX = NaN
        }
      }
      drawJelly(j, clock)
    }

    // The other creatures fade and swim in or out as the zone changes
    if (!reduce) deep += (zone / DEEPEST_ZONE - deep) * Math.min(1, dt * 0.7)
    const world: World = { W, H, t: clock, cw, ch, put, lights: halos }
    SPECIES.forEach((sp, k) => {
      const want = sp.zones.includes(zone) ? 1 : 0
      if (!reduce) {
        if (want && presence[k]! < 0.05 && clock - arrivedAt[k]! > 3) arrivedAt[k] = clock
        // A steady swim in or out, about two and a half seconds either way
        const gap = want - presence[k]!
        presence[k]! += Math.sign(gap) * Math.min(Math.abs(gap), dt * 0.4)
      }
      if (presence[k]! < 0.01) return
      const since = clock - arrivedAt[k]!
      drawing = k + 1
      sp.draw(world, presence[k]!, since >= 0 && since < 6 ? Math.exp(-since / 1.2) : 0, swims[k]!)
    })

    const snowShown = smoothstep(clock / 2)
    for (let n = 0; n < snow.length; n++) {
      const p = snow[n]!
      if (hash2(n, 7) > snowShown) continue
      const y = (((p.y + clock * (5 + 9 * p.z)) % H) + H) % H
      if (y < waterY + ch) continue
      const x = p.x + 6 * Math.sin(clock * 0.3 + p.s)
      const c = Math.floor(x / cw)
      const r = Math.floor(y / ch)
      if (c >= 0 && c < cols && r >= 0 && r < rows) snowBuf[r * cols + c] = 1 + Math.round(p.z * 4)
    }

    for (let k = pings.length - 1; k >= 0; k--) {
      const p = pings[k]!
      const age = clock - p.t
      if (age > 1.6) {
        pings.splice(k, 1)
        continue
      }
      const radius = age * 240
      const level = Math.round(9 * (1 - age / 1.6))
      const steps = Math.max(12, Math.round((Math.PI * 2 * radius) / cw))
      for (let a = 0; a < steps; a++) {
        const ang = (a / steps) * Math.PI * 2
        const c = Math.floor((p.x + Math.cos(ang) * radius) / cw)
        const r = Math.floor((p.y + Math.sin(ang) * radius * 0.92) / ch)
        if (c >= 0 && c < cols && r >= 0 && r < rows) {
          const i = r * cols + c
          pingBuf[i] = Math.max(pingBuf[i]!, level)
        }
      }
    }

    const lightR = Math.max(120, W * 0.12)
    const lightR2 = lightR * lightR
    // What lights up the creatures near it: the submarine's porthole on a
    // computer (wherever it's cruising), the finger on a touch screen
    const lamp = fine ? cursor.sub : pointer.on ? pointer : null

    bctx.clearRect(0, 0, bv.width, bv.height)
    ctx.clearRect(0, 0, cv.width, cv.height)

    // The surface rises and falls: each column's height comes from the same
    // wave function the boat rides on.
    const amp = ch * 0.75
    for (let c = -1; c <= cols + 1; c++) surfRow[c + 1] = waterY + amp * waveAt(c, clock)
    const surfaceAt = (c: number) =>
      Number.isInteger(c) && c >= -1 && c <= cols + 1 ? surfRow[c + 1]! : waterY + amp * waveAt(c, clock)
    surfaceAmp = amp

    // Water: lighter just under the surface, darker the deeper you are
    const top = Math.max(0, waterY - amp * 2)
    const water = bctx.createLinearGradient(0, top * bd, 0, H * bd)
    // By day the shallows are a clear blue, still darkening to the same deep
    water.addColorStop(0, mixColor(mixRGB([12, 37, 70], [5, 16, 36], deep), mixRGB([30, 112, 166], [9, 38, 76], deep), dayMix))
    water.addColorStop(1, mixColor(mixRGB([4, 10, 21], [1, 2, 6], deep), mixRGB([10, 52, 94], [3, 10, 24], deep), dayMix))
    bctx.fillStyle = water
    bctx.fillRect(0, top * bd, bv.width, (H - top) * bd)

    // Sky, down to the top of the waves
    if (waterY + amp * 2 > 0) {
      const sky = bctx.createLinearGradient(0, 0, 0, waterY * bd)
      sky.addColorStop(0, mixColor([2, 4, 11], [74, 160, 222], dayMix))
      sky.addColorStop(1, mixColor([11, 22, 51], [196, 230, 250], dayMix))
      bctx.fillStyle = sky
      bctx.beginPath()
      bctx.moveTo(0, 0)
      for (let c = -1; c <= cols + 1; c++) bctx.lineTo(c * cw * bd, (surfaceAt(c) + ch * 0.2) * bd)
      bctx.lineTo(bv.width, 0)
      bctx.closePath()
      bctx.fill()
    }

    // The moon: on a computer SeaCursor.vue draws it (it's the cursor while
    // the cursor is in the sky, and glides home otherwise) and says where it
    // is; on a touch screen it hangs in a fixed spot, drawn here.
    let moonX = W * 0.8
    let moonY = waterY * 0.36
    let moonR = skyMoonR(waterY)
    if (fine && cursor.moon) {
      moonX = cursor.moon.x
      moonY = cursor.moon.y
      moonR = MOON_R
    }
    const moonUp = waterY > 110 && (fine ? !!cursor.moon && moonY < waterY : moonY + moonR > 0)
    if (moonUp && !fine) halos.push({ x: moonX, y: moonY, r: moonR * 4.5, a: 0.12 + 0.12 * dayMix, rgb: dayMix > 0.5 ? '255, 214, 110' : '200, 222, 255' })

    // The submarine's porthole lights the water around it, whether it's the
    // cursor or out cruising on its own
    const sub = fine && !!cursor.sub
    if (cursor.sub && fine) halos.push({ x: cursor.sub.x, y: cursor.sub.y, r: 170, a: 0.15, rgb: '255, 206, 96' })

    // The dive boat: a wheelhouse with a radar dome behind it and a flag on
    // the mast, a long cabin with lit windows and a door at each end, a
    // railing along the deck, portholes and a lifebuoy on the hull, and a
    // white stripe above the bottom paint.
    // BOAT_FILL marks the insides of the cabin and hull, which get shaded.
    const BOAT = [
      '                    |>                            ',
      '                    |      _                      ',
      '                  __|__   (_)                     ',
      '      ___________|[] []|___|_______________       ',
      '     |  [=]  [=]  [=]  [=]  [=]  [=]  [=]  |___   ',
      '     |  ___                           ___  |   |  ',
      '_|_|_|_|   |_|_|_|_|_|_|_|_|_|_|_|_|_|   |_|___|_ ',
      '\\  o    o    o    o    o    o    o    o  (O)    / ',
      ' \\                                             /  ',
      '  \\===========================================/   ',
      '   \\_________________________________________/    ',
    ]
    const BOAT_FILL = [
      '                                                  ',
      '                                                  ',
      '                                                  ',
      '                    #                             ',
      '      ##   ##   ##   ##   ##   ##   ##   ##       ',
      '      ##   ###########################   ## ###   ',
      '                                                  ',
      ' ## #### #### #### #### #### #### #### ##   ####  ',
      '  #############################################   ',
      '                                                  ',
      '                                                  ',
    ]
    const boatW = BOAT[0]!.length
    // Shading for the boat by day, without the letters in the main ramp
    const DAY_HULL = '=#%@'
    const DAY_CABIN = '.:-'
    const bc = Math.round((W * (W < 768 ? 0.6 : 0.74) + Math.sin(clock * 0.04) * W * 0.05 + towDx) / cw) - Math.round(boatW / 2)
    const keel = surfaceAt(bc + boatW / 2) + ch * 0.8
    const boatTop = keel - BOAT.length * ch
    const tilt = (surfaceAt(bc + boatW - 4) - surfaceAt(bc + 4)) / (boatW * cw)
    const mastCol = BOAT[0]!.indexOf('|')

    // The light each creature casts into the water around it, behind the page
    for (const h of halos) halo(bctx, bd, h.x, h.y, h.r, h.rgb, h.a)

    // Sky and surface glyphs, on the back layer
    if (waterY > -amp * 2 - ch * 10) {
      // Stars fade out by day, and clouds drift in
      if (dayMix > 0.02) drawClouds(waterY, dayMix)
      for (const st of stars) {
        if (dayMix > 0.97) break
        const y = waterY - st.h
        if (y < 0 || y > waterY - ch * 2) continue
        const twinkle = 0.55 + 0.45 * Math.sin(clock * (0.8 + st.s * 2.2) + st.ph)
        const level = Math.round((1 + st.s * 6) * twinkle * (1 - dayMix))
        if (level < 1) continue
        const glyph = st.s > 0.93 ? '*' : st.s > 0.78 ? '+' : st.s > 0.45 ? '·' : '.'
        const hue = st.s > 0.97 ? HUE.warm : st.s > 0.9 ? HUE.cyan : HUE.ice
        batlas.draw(bctx, glyph, colorIndex(hue, level), Math.round(st.x * bd) - 1, Math.round(y * bd) - 1)
      }
      if (moonUp && !fine) {
        const c0 = Math.floor((moonX - moonR) / cw)
        const c1 = Math.ceil((moonX + moonR) / cw)
        const r0 = Math.floor((moonY - moonR) / ch)
        const r1 = Math.ceil((moonY + moonR) / ch)
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const dx = (c + 0.5) * cw - moonX
            const dy = (r + 0.5) * ch - moonY
            const d = Math.hypot(dx, dy) / moonR
            if (d > 1 || r < 0) continue
            const crater = dayMix < 0.5 && hash2(c * 0.37, r * 0.53) < 0.18 ? 0.3 : 0
            const v = Math.min(1, 0.45 + 0.6 * (1 - d * d) - crater)
            batlas.draw(bctx, RAMP[rampIndex(v)]!, colorIndex(dayMix > 0.5 ? HUE.warm : HUE.ice, Math.round(3 + v * 6)), Math.round(c * cw * bd) - 1, Math.round(r * ch * bd) - 1)
          }
        }
      }
      const px = (x: number, y: number) => [Math.round(x * bd) - 1, Math.round(y * bd) - 1] as const

      // The surface: the wave line itself, slanting up and down with the
      // swell, foam flicking off the crests, then swells below it that thin
      // out with depth. Brightest under the moon.
      for (let c = 0; c < cols; c++) {
        const x = c * cw
        if (x > W) break
        const y = surfaceAt(c)
        if (y < -ch * 12 || y > H + ch) continue
        const slope = surfaceAt(c + 1) - surfaceAt(c - 1)
        const near = moonUp ? Math.max(0, 1 - Math.abs(x - moonX) / (moonR * 3)) : 0
        const underHull = c >= bc + 1 && c < bc + boatW - 1
        if (!underHull) {
          const crest = waveAt(c, clock) < -0.7
          const glyph = slope < -amp * 0.5 ? '/' : slope > amp * 0.5 ? '\\' : crest ? '~' : '_'
          const level = Math.round(6 + (crest ? 2 : 0) + 2 * near)
          batlas.draw(bctx, glyph, colorIndex(near > 0.3 || crest ? HUE.ice : HUE.cyan, level), ...px(x, y - ch * 0.5))
          if (crest && hash2(c, Math.floor(clock * 4)) < 0.55) {
            batlas.draw(bctx, hash2(c, 3) < 0.5 ? "'" : '.', colorIndex(HUE.ice, 7), ...px(x, y - ch * 1.4))
          }
        }
        for (let k = 1; k <= 6; k++) {
          const yy = y + k * ch * 0.95
          if (yy < 0 || yy > H) continue
          const swell =
            Math.sin(c * (0.2 - k * 0.012) + k * 1.3 - clock * (1.2 + 0.16 * k)) +
            0.6 * Math.sin(c * 0.07 + clock * 0.55 + k * 0.8)
          if (swell < 0.35 + k * 0.11) continue
          const glyph = swell > 1.25 ? '~' : k > 4 ? '-' : swell > 0.9 ? '~' : '-'
          batlas.draw(bctx, glyph, colorIndex(k < 3 ? HUE.cyan : HUE.blue, Math.max(1, Math.round(7.5 - k * 0.8 + 2 * near))), ...px(x + Math.sin(clock + k) * 2, yy - ch * 0.5))
        }
      }

      // The moon's reflection, breaking up as it goes down
      if (moonUp) {
        for (let k = 1; k <= 14; k++) {
          const spread = moonR * (1 + k * 0.1)
          for (let c = Math.floor((moonX - spread) / cw); c <= Math.ceil((moonX + spread) / cw); c++) {
            if (hash2(c * 1.3 + k, Math.floor(clock * 5)) > 0.5 * (1 - k / 15)) continue
            const y = surfaceAt(c) + k * ch
            if (y < 0 || y > H) continue
            batlas.draw(bctx, k % 3 === 0 ? '~' : '-', colorIndex(dayMix > 0.5 ? HUE.warm : HUE.ice, Math.max(1, Math.round(8 - k * 0.5))), ...px(c * cw, y - ch * 0.5))
          }
        }
      }

      // "Akshun", mirrored in the water under it
      // The reflection waits until the name has been towed into place
      const towed = towing ? 0 : Number.isFinite(towEnd) ? smoothstep((clock - towEnd) / 1.2) : 1
      drawReflection(waterY, surfaceAt, reduce ? 1 : smoothstep((clock - 2.2) / 1.6) * towed)

      // The boat itself, leaning with the waves under it. Every part of it is
      // shaded by the light falling on it: the deck lamp on the mast, the
      // moon when it is up, and light bouncing off the water onto the lower
      // hull. The hull is rounder (brighter) amidships and darker toward the
      // bow and stern, and whatever sits below the waterline is seen dimly
      // through the water.
      if (boatTop + BOAT.length * ch > -ch && boatTop < H) {
        boatFlag = { x: (bc + mastCol + 1.5) * cw, y: boatTop + tilt * (mastCol - boatW / 2) * cw }
        const lampX = (bc + mastCol) * cw
        const lampY = boatTop + ch * 0.5
        const reach = cw * 11
        const dayBoat = dayMix > 0.5
        BOAT.forEach((line, k) => {
          for (let j = 0; j < line.length; j++) {
            let g = line[j]!
            const filled = g === ' ' && BOAT_FILL[k]![j] === '#'
            if (g === ' ' && !filled) continue
            const x = (bc + j) * cw
            const y = boatTop + k * ch + tilt * (j - boatW / 2) * cw
            const ex = x - lampX
            const ey = y - lampY
            const lamp = Math.exp(-(ex * ex + ey * ey) / (reach * reach))
            const moon = moonUp ? 0.35 * Math.max(0, 1 - Math.abs(x - moonX) / (W * 0.45)) : 0
            const sunk = y + ch * 0.5 > surfaceAt(bc + j)
            const hull = k >= 7

            if (filled && dayBoat && !sunk) {
              // By day the boat is a dark shape against the bright sky, so
              // the shading runs the other way: the hull is dense and dark,
              // the cabin lighter and sparser, both catching the sun on top
              // and on the rounded middle of the hull
              const round = Math.sin((Math.PI * (j + 0.5)) / boatW) ** 0.6
              const grain = 0.08 * (hash2(j, k) - 0.5)
              const dark = hull
                ? Math.max(0, Math.min(1, 0.55 + 0.45 * (k - 7) - 0.35 * round + grain))
                : Math.max(0, Math.min(1, 0.25 + 0.5 * (k - 4) + grain))
              const ramp = hull ? DAY_HULL : DAY_CABIN
              batlas.draw(bctx, ramp[Math.round(dark * (ramp.length - 1))]!, colorIndex(HUE.blue, hull ? Math.round((1 - dark) * 3) : 3 - Math.round(dark)), ...px(x, y))
              continue
            }
            if (filled) {
              let v: number
              let hue: number
              if (hull) {
                const round = Math.sin((Math.PI * (j + 0.5)) / boatW) ** 0.6
                const upper = k === 7 ? 0.55 : 0.3
                const bounce = k === 8 ? 0.14 * (0.5 + 0.5 * Math.sin(j * 0.7 - clock * 2.4)) : 0
                v = 0.06 + 0.32 * upper * round + 0.22 * lamp + 0.6 * moon * upper + bounce
                hue = lamp > 0.6 ? HUE.warm : v > 0.32 ? HUE.ice : HUE.blue
              } else {
                // Cabin walls, with a little warm light spilling from the windows
                const spill = line[j - 1] === ']' || line[j + 1] === '[' ? 0.08 : 0
                v = 0.08 + 0.2 * lamp + 0.4 * moon + spill
                hue = spill || lamp > 0.6 ? HUE.warm : HUE.ice
              }
              if (sunk) {
                v *= 0.45
                hue = HUE.blue
              } else if (dayMix > 0.5 && hue !== HUE.warm) {
                hue = HUE.ice
                v *= 0.25
              }
              // Kept to the light end of the ramp, so it reads as shading, not texture
              const kk = Math.max(1, Math.min(hull ? 6 : 5, rampIndex(v)))
              batlas.draw(bctx, RAMP[kk]!, colorIndex(hue, Math.round(2 + v * 6)), ...px(x, y))
              continue
            }

            let hue: number = HUE.ice
            let level = Math.round((hull ? 5 : 6) + 2 * Math.min(1, lamp * 0.6 + moon))
            if (k === 7 && (g === '(' || g === ')' || g === 'O')) {
              hue = HUE.pink
              level = 7
            } else if (g === 'o' || g === '[' || g === ']') {
              hue = HUE.warm
              level = 8
            } else if (g === '>') {
              hue = HUE.pink
              level = 8
            } else if (g === '=') {
              hue = k === 4 ? HUE.warm : HUE.cyan
              level = k === 4 ? 7 : 5
            } else if (k <= 2 && j === mastCol) {
              level -= 1
            } else if (k === 6 && g === '|' && j !== 5 && j !== 43 && j !== 47) {
              // The railing posts are thinner than the walls
              level -= 2
            }
            if (sunk) {
              hue = HUE.blue
              level = Math.max(2, level - 4)
            } else if (dayBoat) {
              // By day the lines are inked dark over the paint, except the
              // things that catch the sun: portholes, the white stripe along
              // the hull and the glass of the cabin windows
              if (g === 'o' && k >= 7) {
                // Portholes glint in the sun
                hue = HUE.warm
                level = 9
              } else if (k === 7 && (g === '(' || g === ')' || g === 'O')) {
                hue = HUE.pink
                level = 8
              } else if (g === '=' && k === 9) {
                hue = HUE.ice
                level = 9
              } else if (g === '=') {
                hue = HUE.cyan
                level = 4
              } else if (g !== '>') {
                hue = HUE.blue
                level = 0
              }
            }
            if (g === '_' && sunk) g = '-'
            batlas.draw(bctx, g, colorIndex(hue, Math.min(9, level)), ...px(x, y))
          }
        })
        // The waterline across the hull, in front of it
        for (let c = bc + 1; c < bc + boatW - 1; c++) {
          const wy = surfaceAt(c)
          const crest = waveAt(c, clock) < -0.7
          batlas.draw(bctx, crest ? '~' : '-', colorIndex(crest ? HUE.ice : HUE.cyan, crest ? 7 : 5), ...px(c * cw, wy - ch * 0.5))
        }
        // A deck light on the mast, glowing on the water
        const lx = (bc + mastCol) * cw
        const ly = boatTop + ch * 0.5 + tilt * (mastCol - boatW / 2) * cw
        halo(bctx, bd, lx, ly, 90, '255, 206, 128', 0.4 * (1 - dayMix))
      }
    }

    // The reef on the sea floor, when the bottom of the page is in view
    if (!crabTalking) crabT += dt
    crabAt = drawSeafloor({ ctx: bctx, atlas: batlas, bd, W, H, cw, ch, t: clock, crabT, floorY: geo.floorY, reefTop: geo.reefTop, glow: (c, x, y, r, rgb, a) => halo(c, bd, x, y, r, rgb, a) })

    // Each creature character gets a dark cell behind it, so whatever it
    // crosses (your name, a tile, a photo) is covered rather than mixed in.
    // Brighter characters cover more.
    // The dark cell is the colour of the water around it, so by day it's a
    // deep blue rather than night-black
    const coverRGB = mixRGB([4, 10, 21], mixRGB([27, 102, 154], [7, 30, 60], deep), dayMix).map(Math.round).join(', ')
    const COVER = [`rgba(${coverRGB}, 0.4)`, `rgba(${coverRGB}, 0.62)`, `rgba(${coverRGB}, 0.82)`]
    const gp = glowPx.data
    gp.fill(0)
    // A cell's glow: its character's colour, scaled by how much ink a
    // character that dense puts on the screen
    const glowAt = (i: number, ci: number, k: number) => {
      const ink = 0.1 + 0.32 * (k / (RAMP.length - 1))
      const o = i * 4
      gp[o] = COLOR_RGB[ci * 3]! * ink
      gp[o + 1] = COLOR_RGB[ci * 3 + 1]! * ink
      gp[o + 2] = COLOR_RGB[ci * 3 + 2]! * ink
      gp[o + 3] = 255
    }
    const cellW = Math.ceil(cw * dpr) + 1
    const cellH = Math.ceil(ch * dpr) + 1
    // The dark cells are gathered into three shapes (one per darkness) and
    // filled in three calls, and the characters queued and drawn after them,
    // rather than thousands of separate fills
    const covers = [new Path2D(), new Path2D(), new Path2D()]
    let queued = 0
    const queue = (glyph: string, ci: number, x: number, y: number) => {
      qGlyph[queued] = glyph
      qColor[queued] = ci
      qX[queued] = x
      qY[queued] = y
      queued++
    }
    // The project tile in focus, which creatures pass behind
    const focus = geo.focus

    for (let r = 0; r < rows; r++) {
      const y = r * ch
      const dy = Math.round(y * dpr) - 1
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const bl = bellBuf[i]!
        const tl = tentBuf[i]!
        const al = armBuf[i]!
        const sum = bl + tl + al
        const life = lifeLum[i]!
        // Most cells are empty water: skip them before doing any more work
        if (sum <= 0.02 && life <= 0.02 && !pingBuf[i] && !snowBuf[i]) continue
        const x = c * cw
        const dx = Math.round(x * dpr) - 1

        let light = 0
        if (lamp) {
          const ex = x + cw / 2 - lamp.x
          const ey = y + ch / 2 - lamp.y
          const d2 = ex * ex + ey * ey
          if (d2 < lightR2) light = 1 - d2 / lightR2
        }

        // Front layer: creatures live below the waterline only
        const under = y + ch * 0.5 > waterY + ch
        const hidden = !!focus && x + cw > focus.x0 && x < focus.x1 && y + ch > focus.y0 && y < focus.y1
        const behind = hidden || (weave[i] === 1 && SPECIES[lifeKind[i]! - 1]?.weave === true)
        if (under && life > 0.02 && life > sum && !behind) {
          const v = Math.min(1, (1 - Math.exp(-life * 1.6)) * (1 + light * 0.8))
          const k = rampIndex(v)
          if (k > 0) {
            const gc = lifeGlyph[i]!
            let glyph = RAMP[k]!
            if (gc) {
              glyph = glyphOf.get(gc) ?? String.fromCharCode(gc)
              glyphOf.set(gc, glyph)
            }
            covers[v < 0.3 ? 0 : v < 0.6 ? 1 : 2]!.rect(dx + 1, dy + 1, cellW, cellH)
            const ci = colorIndex(lifeHue[i]!, Math.min(9, Math.floor(1 + v * 9)))
            queue(glyph, ci, dx, dy)
            glowAt(i, ci, k)
          }
        } else if (under && sum > 0.02 && !hidden && !(behind && life > sum)) {
          const v = Math.min(1, (1 - Math.exp(-sum * 1.8)) * (1 + light * 0.8))
          const k = rampIndex(v)
          if (k > 0) {
            const level = Math.min(9, Math.floor(v * 10))
            let glyph = RAMP[k]!
            let hue: number = v > 0.82 ? HUE.ice : HUE.cyan
            if (tl > bl && tl > al) {
              hue = v > 0.7 ? HUE.cyan : HUE.blue
              if (k >= 3) {
                const ax = dirX[i]!
                const ay = dirY[i]!
                const ang = Math.abs(Math.atan2(ay, ax))
                if (ang > 1.18 && ang < 1.96) glyph = '|'
                else if (ang < 0.39 || ang > 2.75) glyph = '-'
                else glyph = ax * ay > 0 ? '\\' : '/'
              }
            } else if (al > bl) {
              hue = HUE.violet
            }
            covers[v < 0.3 ? 0 : v < 0.6 ? 1 : 2]!.rect(dx + 1, dy + 1, cellW, cellH)
            const ci = colorIndex(hue, level)
            queue(glyph, ci, dx, dy)
            glowAt(i, ci, k)
          }
        }

        // Back layer: sonar pings, marine snow, plankton
        const bdx = Math.round(x * bd) - 1
        const bdy = Math.round(y * bd) - 1
        const pingLevel = pingBuf[i]!
        if (pingLevel > 0) {
          batlas.draw(bctx, pingLevel > 5 ? 'o' : '·', colorIndex(HUE.cyan, pingLevel), bdx, bdy)
          continue
        }
        const sn = snowBuf[i]!
        if (sn > 0) {
          const hue = sub && light > 0.25 ? HUE.warm : HUE.ice
          batlas.draw(bctx, sn > 3 ? '·' : '.', colorIndex(hue, Math.min(9, sn + Math.round(light * 4))), bdx, bdy)
        }
      }
    }

    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = COVER[k]!
      ctx.fill(covers[k]!)
    }
    for (let q = 0; q < queued; q++) atlas.draw(ctx, qGlyph[q]!, qColor[q]!, qX[q]!, qY[q]!)

    // The bloom: the glow pixels, stretched to a quarter of the screen's
    // size and blurred there, which is far cheaper than shrinking the whole
    // character layer every frame. It is soft enough that refreshing it every
    // other frame can't be seen (except in a still frame, which always gets it).
    if (reduce || ++glowTurn % 2 === 0) refreshGlow()
    // Without graphics acceleration the browser can't afford to blend a
    // separate glow layer over the page, so it's added in here instead
    if (lite) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(gv, 0, 0, cv.width, cv.height)
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  let glowTurn = 0
  function refreshGlow() {
    glowCtx.putImageData(glowPx, 0, 0)
    gctx.clearRect(0, 0, gv.width, gv.height)
    gctx.globalAlpha = 0.9
    if (canvasFilter) gctx.filter = 'blur(1.25px) saturate(1.3)'
    gctx.drawImage(glowSrc, 0, 0, cols * (cw / 4), rows * (ch / 4))
    if (canvasFilter) gctx.filter = 'none'
    // The haze: the bloom shrunk to a tenth of the screen and blurred there,
    // which costs almost nothing, then added back on top, wide and soft. One
    // layer on the page instead of two.
    hctx.clearRect(0, 0, hv.width, hv.height)
    if (canvasFilter) hctx.filter = 'blur(1.4px)'
    hctx.drawImage(gv, 0, 0, hv.width, hv.height)
    if (canvasFilter) hctx.filter = 'none'
    gctx.globalCompositeOperation = 'lighter'
    gctx.globalAlpha = 0.94
    gctx.drawImage(hv, 0, 0, gv.width, gv.height)
    gctx.globalCompositeOperation = 'source-over'
    gctx.globalAlpha = 1
  }

  // ---- loop -------------------------------------------------------------
  // requestAnimationFrame exists in workers in most browsers; a timer stands in where it doesn't
  const raf = (globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame
  const caf = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame
  let timer = 0
  let last = 0
  let visible = true
  let focused = true

  function schedule() {
    if (timer) return
    timer = raf ? raf.call(globalThis, tick) : (setTimeout(() => tick(performance.now()), 16) as unknown as number)
  }

  function unschedule() {
    if (!timer) return
    if (raf && caf) caf.call(globalThis, timer)
    else clearTimeout(timer)
    timer = 0
  }

  function tick(now: number) {
    timer = 0
    if (!visible || reduce) return
    // About 30 frames a second, and fewer while the window isn't in focus
    if (now - last >= (focused ? (lite ? 42 : 33) : 90)) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      clock += dt
      draw()
    }
    schedule()
  }

  function draw() {
    if (!cols) return
    const t0 = performance.now()
    boatFlag = null
    frame()
    // Every second or so, check what the frames cost and adjust the detail
    frameCost += performance.now() - t0
    if (++costFrames >= 30) {
      const avg = frameCost / costFrames
      if (avg > 18 && lod === 1) lod = 2
      else if (avg < 8 && lod === 2) lod = 1
      frameCost = 0
      costFrames = 0
    }
    emit({ type: 'surface', clock, amp: surfaceAmp, cw, boat: boatFlag, crab: crabAt })
  }

  // With reduced motion there is one still frame, the jellyfish mid-swim,
  // redrawn whenever the page changes
  function still() {
    if (!reduce) return
    clock = 6
    draw()
  }

  function handle(m: ToEngine) {
    switch (m.type) {
      case 'layout':
        layout(m)
        still()
        break
      case 'state':
        pointer.x = m.pointer.x
        pointer.y = m.pointer.y
        pointer.on = m.pointer.on
        cursor.mode = m.cursor.mode
        cursor.x = m.cursor.x
        cursor.y = m.cursor.y
        cursor.moon = m.cursor.moon
        cursor.sub = m.cursor.sub
        geo.waterY = m.waterY
        geo.floorY = m.floorY
        geo.name = m.name
        geo.focus = m.focus
        geo.reefTop = m.reefTop
        still()
        break
      case 'weave':
        if (m.mask.length === weave.length) weave.set(m.mask)
        still()
        break
      case 'reflection':
        refl = m.src
        still()
        break
      case 'theme':
        day = m.day
        if (m.instant) dayMix = day ? 1 : 0
        if (reduce) {
          dayMix = day ? 1 : 0
          still()
        }
        break
      case 'zone':
        onZone(m.zone)
        break
      case 'lift':
        if (m.x === null) {
          // Let go: sink away from the name and drift aside
          const j = jellies[0]
          if (lift && j) {
            j.sinking = true
            j.sinkFor = 0
            homeX = W * (W < 768 ? 0.78 : 0.86)
          }
          lift = null
        } else lift = { x: m.x, bottom: m.bottom }
        break
      case 'lite':
        lite = true
        break
      case 'crab':
        crabTalking = m.talking
        break
      case 'tow':
        towDx = m.dx
        if (m.dx !== 0) towing = true
        else if (towing) {
          towing = false
          towEnd = clock
        }
        break
      case 'ping':
        ping(m.x, m.y)
        break
      case 'run': {
        const wasStill = reduce
        visible = m.visible
        focused = m.focused
        reduce = m.reduce
        if (reduce) {
          unschedule()
          still()
        } else if (visible) {
          if (wasStill) last = 0
          schedule()
        } else {
          unschedule()
          last = 0
        }
        break
      }
      case 'stop':
        unschedule()
        visible = false
        break
    }
  }

  return { handle }
}
