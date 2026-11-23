<script setup lang="ts">
// The cursor, on computers with a mouse or trackpad. Above the waterline it
// is the moon; below it, a submarine whose round porthole glows yellow. The
// hotspot is the moon's centre or the porthole. Going through the surface
// makes a splash, and the propeller leaves bubbles that rise and pop on the
// waves.
//
// Both stay in the scene when they aren't the cursor. The moon has a home in
// the sky and glides back to it when the cursor goes under water (or leaves
// the window); the submarine cruises about under water on its own while the
// cursor is up in the sky. Whichever one the cursor picks up swims or glides
// over to it first, then sticks to it.
//
// Everything is drawn in characters on one full-screen canvas above the page.
import { MONO, RAMP } from '~/utils/ascii'
import { waterlineY, hasFinePointer, cursorState, surfaceY, MOON_R } from '~/utils/water'
import { splash as splashSound, bubble as bubbleSound } from '~/utils/sound'
import { isDay, toggleDay, HOLD_MS } from '~/utils/theme'
import { isLite } from '~/utils/lite'

const canvas = ref<HTMLCanvasElement>()
let stop = () => {}

// Facing right. The "@" is the porthole, and the hotspot. Row 4 is the
// widest part of the hull; its inside gets shaded so the hull looks round.
const SUB = [
  '             _              ',
  '            | |__           ',
  '         ___|_|__|___       ',
  "   _.--''            ''--._ ",
  '|=<   o    o    o   (@)    )',
  "   '--..______________..--' ",
]
const BODY_ROW = 4
const PORT_ROW = 4
const PORT_COL = SUB[PORT_ROW]!.indexOf('@')
const PROP = ['|=<', '/=<', '-=<', '\\=<']
// Dim characters that fill the hull, from its edges to its fullest middle
const SHADE = ' .:-=+'

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '<': '>', '>': '<', '/': '\\', '\\': '/', '[': ']', ']': '[' }

const HULL = '#a9bfdc'
const HULL_DARK = '#5d7699'
const TOWER = '#c9d8ee'
const TRIM = '#e2b469'
const PORT = '#ffd36b'
const PROP_C = '#5ccfff'
const FOAM = '#d4e8ff'
const MOON = '#e4eeff'

const FS = 10
const LH = 11

interface Bubble { x: number; y: number; vy: number; age: number; ph: number; pop: number }
interface Drop { x: number; y: number; vx: number; vy: number; age: number; g: string; fall: number }

onMounted(() => {
  const cv = canvas.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx || !hasFinePointer()) return

  const root = document.documentElement
  root.classList.add('has-sea-cursor')
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

  let W = 0
  let H = 0
  let cw = 6
  // Whether anything has changed since the last drawing; a still moon with
  // nothing else moving doesn't need redrawing every frame
  let stale = true
  function resize() {
    stale = true
    W = window.innerWidth
    H = window.innerHeight
    // Ordinary resolution without graphics acceleration (utils/lite.ts)
    const dpr = isLite() ? 1 : Math.min(2, window.devicePixelRatio || 1)
    cv!.width = Math.ceil(W * dpr)
    cv!.height = Math.ceil(H * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx!.font = `${FS}px ${MONO}`
    cw = ctx!.measureText('M').width || FS * 0.6
  }
  resize()

  const pointer = { x: -500, y: -500, on: false }
  let hovering = false
  // The moon and the submarine, wherever they are; `held` once they've
  // caught up with the cursor and stick to it
  const moon = { x: NaN, y: NaN, held: false, shown: false }
  const sub = { x: NaN, y: NaN, held: false, shown: false, vx: 0 }
  let lastX = 0
  let facing = 1
  let t = 0
  let wasUnder: boolean | null = null
  let nextBubble = 0.3
  let bubbles: Bubble[] = []
  let drops: Drop[] = []

  // Holding the mouse button down on the moon (or the sun) switches day and
  // night. While it's held, a ring of dots fills in around it.
  let holdStart = 0
  let holdTimer = 0
  let lastMoveAt = performance.now()
  let hintDrawn = false

  function endHold() {
    holdStart = 0
    clearTimeout(holdTimer)
    stale = true
  }

  function onDown(e: PointerEvent) {
    if (e.pointerType === 'touch' || e.button !== 0 || cursorState.mode !== 'moon') return
    // Pressing a control (the volume meter, say) is for the control, not the moon
    if ((e.target as Element | null)?.closest?.('a, button, label, input, textarea, select, [role="button"], .depth-meter, .arcade')) return
    // Nothing to select up there, and a long press shouldn't start selecting the name
    e.preventDefault()
    holdStart = performance.now()
    clearTimeout(holdTimer)
    holdTimer = window.setTimeout(() => {
      if (!holdStart || cursorState.mode !== 'moon') return
      endHold()
      toggleDay()
      if (reduce.matches) frame(0)
    }, HOLD_MS)
    stale = true
  }

  function onMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return
    pointer.x = e.clientX
    pointer.y = e.clientY
    if (sub.held && Math.abs(pointer.x - lastX) > 2) facing = pointer.x > lastX ? 1 : -1
    lastX = pointer.x
    const target = e.target as Element | null
    hovering = !!target?.closest?.('a, button, label, input, textarea, select, [role="button"]')
    // Over the sound switch, its volume meter and the depth gauge the moon
    // would sit right on top of them, so it steps aside for an ordinary
    // pointer (see main.css)
    pointer.on = !target?.closest?.('.sound-control, .depth-meter')
    lastMoveAt = performance.now()
    stale = true
    if (reduce.matches) frame(0)
  }

  function onOut(e: MouseEvent) {
    if (!e.relatedTarget) {
      pointer.on = false
      stale = true
    }
  }

  function glow(x: number, y: number, r: number, rgb: string, a: number) {
    const g = ctx!.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${rgb}, ${a})`)
    g.addColorStop(0.45, `rgba(${rgb}, ${a * 0.35})`)
    g.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx!.fillStyle = g
    ctx!.fillRect(x - r, y - r, r * 2, r * 2)
  }

  function splash(x: number, y: number) {
    if (reduce.matches) return
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      const v = 90 + Math.random() * 150
      drops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: Math.random() * -0.05, g: "',.`"[i % 4]!, fall: 1 })
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        drops.push({ x: x + side * k * cw, y, vx: side * (40 + k * 25), vy: 0, age: 0, g: '~', fall: 0 })
      }
    }
  }

  // A full moon: brighter in the middle, darker at the edge, with the grey
  // "seas" across its face and a few small craters (MOON_R sets its size)
  const SIZE = MOON_R / 36 // the glow and the sun's rays were laid out for a radius of 36
  const CRATERS = [
    [0.42, -0.52],
    [-0.6, 0.53],
    [0.14, 0.79],
    [-0.2, -0.2],
  ]
  function drawMoon(cx: number, cy: number) {
    const hov = hovering && moon.held
    glow(cx, cy, (hov ? 100 : 78) * SIZE, '200, 222, 255', hov ? 0.45 : 0.32)
    ctx!.font = `9px ${MONO}`
    const mw = ctx!.measureText('M').width
    const lh = 9 * 1.05
    const nc = Math.ceil(MOON_R / mw)
    const nr = Math.ceil(MOON_R / lh)
    for (let r = -nr; r <= nr; r++) {
      for (let c = -nc; c <= nc; c++) {
        const dx = c * mw
        const dy = r * lh
        const d = Math.hypot(dx, dy) / MOON_R
        if (d > 1) continue
        const u = dx / MOON_R
        const w = dy / MOON_R
        const sea = Math.sin(u * 3.1 + 1.2) * Math.sin(w * 3.7 - 0.4) + 0.6 * Math.sin(u * 5.3 - w * 2.2 + 2) > 0.55 ? 0.28 : 0
        const crater = CRATERS.some(([cu, cw2]) => Math.hypot(u - cu!, w - cw2!) < 0.1) ? 0.3 : 0
        const v = Math.min(1, 0.45 + 0.6 * (1 - d * d) - sea - crater)
        ctx!.globalAlpha = 0.55 + 0.45 * v
        ctx!.fillStyle = MOON
        ctx!.fillText(RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.floor(v * RAMP.length)))]!, cx + dx, cy + dy)
      }
    }
    ctx!.globalAlpha = 1
    ctx!.font = `${FS}px ${MONO}`
  }

  // Where a cell of the submarine lands on screen, with the porthole at (x, y)
  const at = (r: number, c: number, x: number, y: number) => ({
    x: x + (c - PORT_COL) * cw * facing,
    y: y + (r - PORT_ROW) * LH,
  })

  function drawSub(x: number, y: number) {
    const hov = hovering && sub.held
    glow(x, y, hov ? 60 : 42, '255, 206, 96', hov ? 0.75 : 0.55)
    SUB.forEach((src, r) => {
      const line = r === BODY_ROW && !reduce.matches ? PROP[Math.floor(t * 14) % PROP.length]! + src.slice(3) : src
      // The inside of the hull: darker at the ends, fuller in the middle,
      // and warm where the porthole lights it
      const first = r === BODY_ROW ? line.indexOf('<') : -1
      const last = r === BODY_ROW ? line.lastIndexOf(')') : -1
      for (let c = 0; c < line.length; c++) {
        let g = line[c]!
        const p = at(r, c, x, y)
        if (g === ' ') {
          if (c > first && c < last) {
            const f = (c - first) / (last - first)
            const round = Math.sin(Math.PI * f)
            const lit = Math.exp(-(((c - PORT_COL) / 4) ** 2))
            const k = Math.min(SHADE.length - 1, Math.round(1 + round * 2.2 + lit * 1.5))
            ctx!.globalAlpha = 0.3 + 0.35 * round
            ctx!.fillStyle = lit > 0.4 ? TRIM : HULL_DARK
            ctx!.fillText(SHADE[k]!, p.x, p.y)
            ctx!.globalAlpha = 1
          }
          continue
        }
        if (facing < 0) g = MIRROR[g] ?? g
        const isPort = r === PORT_ROW && Math.abs(c - PORT_COL) <= 1
        const isProp = r === BODY_ROW && c < 3
        const isWindow = r === BODY_ROW && g === 'o'
        ctx!.fillStyle = isPort ? PORT : isProp ? PROP_C : isWindow ? TRIM : r === SUB.length - 1 ? HULL_DARK : r <= 2 ? TOWER : HULL
        if (isPort || isWindow) {
          ctx!.shadowColor = PORT
          ctx!.shadowBlur = isPort ? (hov ? 14 : 9) : 4
        }
        ctx!.fillText(g, p.x, p.y)
        ctx!.shadowBlur = 0
      }
    })
  }

  // Where the moon lives when it isn't the cursor (the same spot the sea
  // uses for it on touch screens), and whether there's any sky to see it in
  const moonHome = (level: number) => ({ x: W * 0.8, y: level * 0.36 })
  const skyShown = (level: number) => Number.isFinite(level) && level > 110

  // Where the submarine heads when it's on its own: a slow, wandering course
  // through whatever water is on screen. Null when there's too little water.
  function cruise(level: number) {
    const top = Math.max(Number.isFinite(level) ? level + 60 : 0, 40)
    const bottom = H - 50
    if (bottom - top < 60) return null
    const k = reduce.matches ? 0 : t
    return {
      x: W * (0.5 + 0.36 * Math.sin(k * 0.05 + 1.3) + 0.07 * Math.sin(k * 0.17)),
      y: top + (bottom - top) * (0.5 + 0.38 * Math.sin(k * 0.09 + 0.4)),
      top,
      bottom,
    }
  }

  // Move the moon and the submarine on by one frame
  function steer(dt: number, level: number, mode: 'moon' | 'sub' | 'none') {
    const jump = reduce.matches || !dt
    // The moon: stuck to the cursor in the sky, otherwise gliding home
    const wasShown = moon.shown
    moon.shown = skyShown(level)
    if (moon.shown) {
      const home = moonHome(level)
      const want = mode === 'moon' ? pointer : home
      if (!wasShown || Number.isNaN(moon.x)) {
        moon.x = home.x
        moon.y = home.y
      }
      if (mode !== 'moon') moon.held = false
      if (moon.held || jump) {
        moon.x = want.x
        moon.y = want.y
        moon.held = mode === 'moon'
      } else {
        const k = 1 - Math.exp(-dt * (mode === 'moon' ? 16 : 2.6))
        moon.x += (want.x - moon.x) * k
        moon.y += (want.y - moon.y) * k
        if (mode === 'moon' && Math.hypot(want.x - moon.x, want.y - moon.y) < 3) moon.held = true
      }
    } else moon.held = false

    // The submarine: stuck to the cursor under water, otherwise cruising
    if (mode === 'sub') {
      sub.shown = true
      if (Number.isNaN(sub.x) || jump || sub.held) {
        sub.x = pointer.x
        sub.y = pointer.y
        sub.held = true
      } else {
        const k = 1 - Math.exp(-dt * 16)
        sub.x += (pointer.x - sub.x) * k
        sub.y += (pointer.y - sub.y) * k
        if (Math.abs(pointer.x - sub.x) > 2) facing = pointer.x > sub.x ? 1 : -1
        if (Math.hypot(pointer.x - sub.x, pointer.y - sub.y) < 3) sub.held = true
      }
      return
    }
    sub.held = false
    const c = cruise(level)
    if (!c) {
      sub.shown = false
      return
    }
    if (!sub.shown || Number.isNaN(sub.x) || jump) {
      sub.x = c.x
      sub.y = c.y
    } else {
      // Head for the course at an easy pace, turning to face the way it's going
      const dx = c.x - sub.x
      const dy = c.y - sub.y
      const d = Math.hypot(dx, dy)
      const step = Math.min(d, 70 * dt)
      if (d > 0.01) {
        sub.x += (dx / d) * step
        sub.y += (dy / d) * step
      }
      sub.vx += ((dx / Math.max(d, 1)) * step / Math.max(dt, 1e-3) - sub.vx) * Math.min(1, dt * 2)
      if (Math.abs(sub.vx) > 6) facing = sub.vx > 0 ? 1 : -1
    }
    // Never above the water, if scrolling has brought the surface down onto it
    sub.y = Math.max(c.top, Math.min(c.bottom, sub.y))
    sub.shown = true
  }

  function frame(dt: number) {
    ctx!.clearRect(0, 0, W, H)
    const level = waterlineY()
    const under = pointer.on && pointer.y >= surfaceY(pointer.x, level)

    // A splash each time the cursor goes through the surface
    if (pointer.on && wasUnder !== null && under !== wasUnder) {
      const s = surfaceY(pointer.x, level)
      if (Number.isFinite(s)) {
        splash(pointer.x, s)
        splashSound(pointer.x, under)
      }
    }
    if (pointer.on) wasUnder = under

    cursorState.mode = pointer.on ? (under ? 'sub' : 'moon') : 'none'
    cursorState.x = pointer.x
    cursorState.y = pointer.y
    steer(dt, level, cursorState.mode)
    // The sea lights the water around the porthole and reflects the moon
    const mp = moon.shown ? { x: Math.round(moon.x), y: Math.round(moon.y) } : null
    const sp = sub.shown ? { x: Math.round(sub.x), y: Math.round(sub.y) } : null
    if (mp?.x !== cursorState.moon?.x || mp?.y !== cursorState.moon?.y || sp?.x !== cursorState.sub?.x || sp?.y !== cursorState.sub?.y) {
      cursorState.moon = mp
      cursorState.sub = sp
      window.dispatchEvent(new Event('sea:cursor'))
    }

    ctx!.textAlign = 'center'
    ctx!.textBaseline = 'middle'
    ctx!.font = `${FS}px ${MONO}`

    // Bubbles from the propeller: a steady trickle, and a little burst now
    // and then (heard only while it's yours)
    if (sub.shown && !reduce.matches) {
      nextBubble -= dt
      if (nextBubble <= 0) {
        const prop = at(BODY_ROW, 0, sub.x, sub.y)
        const n = Math.random() < 0.25 ? 3 : 1
        if (cursorState.mode === 'sub') bubbleSound(prop.x)
        for (let k = 0; k < n; k++) {
          bubbles.push({ x: prop.x - facing * cw, y: prop.y, vy: 34 + Math.random() * 30, age: -k * 0.14, ph: Math.random() * 6, pop: 0 })
        }
        nextBubble = 0.22 + Math.random() * 0.5
      }
    }
    for (const b of bubbles) {
      b.age += dt
      if (b.age < 0) continue
      if (b.pop > 0) {
        b.pop += dt
        continue
      }
      b.y -= b.vy * dt
      b.x += Math.sin(b.age * 5 + b.ph) * 14 * dt
      if (b.y <= surfaceY(b.x, level)) b.pop = 0.001
    }
    bubbles = bubbles.filter((b) => b.pop < 0.3 && b.y > -LH && b.age < 14)
    ctx!.fillStyle = FOAM
    for (const b of bubbles) {
      if (b.age < 0) continue
      if (b.pop > 0) {
        ctx!.globalAlpha = 1 - b.pop / 0.3
        ctx!.fillText(b.pop < 0.12 ? '*' : '.', b.x, b.y)
      } else {
        ctx!.globalAlpha = 0.8
        ctx!.fillText(b.age < 0.4 ? '.' : b.age < 1.4 ? 'o' : 'O', b.x, b.y)
      }
    }
    ctx!.globalAlpha = 1

    for (const d of drops) {
      d.age += dt
      if (d.age < 0) continue
      d.x += d.vx * dt
      d.y += d.vy * dt
      d.vy += 520 * d.fall * dt
    }
    drops = drops.filter((d) => d.age < 0.75)
    for (const d of drops) {
      if (d.age < 0) continue
      ctx!.globalAlpha = Math.max(0, 1 - d.age / 0.75)
      ctx!.fillText(d.g, d.x, d.y)
    }
    ctx!.globalAlpha = 1

    if (cursorState.mode !== 'moon' && holdStart) endHold()
    if (sub.shown) drawSub(sub.x, sub.y)
    if (moon.shown) {
      if (isDay()) drawSun(moon.x, moon.y)
      else drawMoon(moon.x, moon.y)
      if (holdStart) drawHold(moon.x, moon.y, (performance.now() - holdStart) / HOLD_MS)
      hintDrawn = wantsHint()
      if (hintDrawn) drawHint(moon.x, moon.y)
    }
  }

  // A hint under the moon once the cursor has rested in the sky for a moment
  function wantsHint(): boolean {
    return cursorState.mode === 'moon' && moon.held && !holdStart && performance.now() - lastMoveAt > 1400
  }

  function drawHint(cx: number, cy: number) {
    ctx!.font = `11px ${MONO}`
    ctx!.fillStyle = isDay() ? '#0c2c4c' : '#9fc6e8'
    ctx!.globalAlpha = 0.85
    ctx!.fillText(isDay() ? 'hold for night' : 'hold for daytime', cx, cy + MOON_R + 26)
    ctx!.globalAlpha = 1
    ctx!.font = `${FS}px ${MONO}`
  }

  // The ring of dots that fills in while the moon or sun is held down
  function drawHold(cx: number, cy: number, p: number) {
    const n = 28
    const R = MOON_R + 12
    ctx!.font = `11px ${MONO}`
    ctx!.fillStyle = isDay() ? '#fff4c2' : '#e4eeff'
    for (let k = 0; k < n; k++) {
      const f = k / n
      if (f > p) break
      const a = -Math.PI / 2 + f * Math.PI * 2
      ctx!.fillText(k % 2 ? '.' : 'o', cx + Math.cos(a) * R, cy + Math.sin(a) * R)
    }
    ctx!.font = `${FS}px ${MONO}`
  }

  // The sun, by day: a warm disc with rays turning slowly around it
  function drawSun(cx: number, cy: number) {
    const hov = hovering && moon.held
    glow(cx, cy, (hov ? 130 : 110) * SIZE, '255, 214, 110', hov ? 0.6 : 0.5)
    ctx!.font = `9px ${MONO}`
    const mw = ctx!.measureText('M').width
    const lh = 9 * 1.05
    const R = MOON_R * 0.82
    const nc = Math.ceil(R / mw)
    const nr = Math.ceil(R / lh)
    for (let r = -nr; r <= nr; r++) {
      for (let c = -nc; c <= nc; c++) {
        const dx = c * mw
        const dy = r * lh
        const d = Math.hypot(dx, dy) / R
        if (d > 1) continue
        const v = Math.min(1, 0.55 + 0.5 * (1 - d * d))
        ctx!.globalAlpha = 0.7 + 0.3 * v
        ctx!.fillStyle = d < 0.6 ? '#fff4c2' : '#ffd36b'
        ctx!.fillText(RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.floor(v * RAMP.length)))]!, cx + dx, cy + dy)
      }
    }
    ctx!.globalAlpha = 1
    ctx!.font = `${Math.round(12 * SIZE)}px ${MONO}`
    ctx!.fillStyle = '#ffd36b'
    const turn = reduce.matches ? 0 : t * 0.15
    for (let k = 0; k < 12; k++) {
      const a = turn + (k / 12) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const g = Math.abs(sa) > 0.92 ? '|' : Math.abs(ca) > 0.92 ? '-' : ca * sa > 0 ? '\\' : '/'
      for (const rr of [R + 9 * SIZE, R + 18 * SIZE]) ctx!.fillText(g, cx + ca * rr, cy + sa * rr)
    }
    ctx!.font = `${FS}px ${MONO}`
  }

  // Resting while the arcade game is open over everything
  let resting = false
  const onArcade = (e: Event) => {
    resting = !!(e as CustomEvent<boolean>).detail
    if (resting) {
      endHold()
      ctx!.clearRect(0, 0, W, H)
    }
    stale = true
  }
  window.addEventListener('sea:arcade', onArcade)

  let rafId = 0
  let last = 0
  function tick(now: number) {
    rafId = requestAnimationFrame(tick)
    if (resting) return
    if (now - last < 30) return
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    t += dt
    if (document.hidden) return
    // The submarine is always on the move, and so are the sun's rays; the
    // moon only while it's on its way somewhere
    const moonMoving = moon.shown && !moon.held && Math.hypot(moonHome(waterlineY()).x - moon.x, moonHome(waterlineY()).y - moon.y) > 0.5
    const busy = sub.shown || moonMoving || bubbles.length || drops.length || holdStart || (isDay() && moon.shown)
    if (!stale && !busy && wantsHint() === hintDrawn) return
    stale = false
    frame(dt)
  }
  if (!reduce.matches) rafId = requestAnimationFrame(tick)

  // Scrolling moves the waterline under a still cursor
  const onScroll = () => {
    stale = true
    if (reduce.matches) frame(0)
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown)
  window.addEventListener('pointerup', endHold)
  window.addEventListener('pointercancel', endHold)
  const onTheme = () => {
    stale = true
    if (reduce.matches) frame(0)
  }
  window.addEventListener('sea:theme', onTheme)
  document.addEventListener('mouseout', onOut)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', resize)
  window.addEventListener('sea:lite', resize)

  stop = () => {
    window.removeEventListener('sea:arcade', onArcade)
    window.removeEventListener('sea:lite', resize)
    cancelAnimationFrame(rafId)
    root.classList.remove('has-sea-cursor')
    cursorState.mode = 'none'
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointerup', endHold)
    window.removeEventListener('pointercancel', endHold)
    window.removeEventListener('sea:theme', onTheme)
    clearTimeout(holdTimer)
    document.removeEventListener('mouseout', onOut)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', resize)
  }
})

onBeforeUnmount(() => stop())
</script>

<template>
  <canvas ref="canvas" class="sea-cursor" aria-hidden="true" />
</template>
