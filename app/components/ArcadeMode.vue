<script setup lang="ts">
// "The deep end": a hidden arcade game. Open it with the Konami code
// (↑ ↑ ↓ ↓ ← → ← → B A), by typing "dive", or by clicking or tapping the
// moon three times quickly. The submarine dives on its own; you steer it
// (mouse, finger or arrow keys) past jellyfish, and deeper down mines and
// anglerfish, picking up pearls. A click, a tap or Space fires the sonar,
// which shoves things away and stuns jellyfish, then has to recharge. It gets
// faster, and darker around the porthole light, the deeper you go, and the
// music sinks with you. Three hits and the hull gives. Esc goes back up.
//
// While it's open the sea, the cursor and the page's scrolling are paused
// ('sea:arcade' events), and it's all drawn in characters on its own canvas.
// The crab on the sea floor (CrabSecret.vue) can also open it ('sea:play').
import { MONO } from '~/utils/ascii'
import { cursorState, waterlineY, MOON_R, skyMoonR, hasFinePointer } from '~/utils/water'
import { ping, bubble, splash, dawn } from '~/utils/sound'
import { isLite } from '~/utils/lite'

type Mode = 'title' | 'play' | 'over'
interface Thing {
  kind: 'jelly' | 'mine' | 'angler' | 'pearl' | 'big-pearl'
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  phase: number
  stun: number
  facing: number
  gone: boolean
}

const BEST_KEY = 'sea-arcade-best'
let FS = 16 // the game's font size, a little smaller on phones
let LH = FS * 1.15
const SONAR_WAIT = 3 // seconds between sonar pings
const HULL = 3

// The art, facing right where it faces at all
const SUB = ['    __|__     ', '=<(_o_o_o_(@))']
const JELLY = [
  [' .--. ', '(____)', ' )()( '],
  [' .--. ', '(____)', ' ()() '],
]
const MINE = [' \\|/ ', '-(*)-', ' /|\\ ']
const ANGLER = ['   _.*', '  /   ', '<°)))><']
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '<': '>', '>': '<', '/': '\\', '\\': '/' }

const open = ref(false)
const mode = ref<Mode>('title')
const status = ref('') // read out to screen readers
const root = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()

let ctx: CanvasRenderingContext2D | null = null
let W = 0
let H = 0
let cw = 8
let frame = 0
let last = 0
let returnFocus: Element | null = null
let zoneBefore = 0
let zoneSent = -1

// The game
let depth = 0
let pearls = 0
let hull = HULL
let best = 0
let hurt = 0 // seconds of not being hurt again after a hit
let shake = 0
let sonar = 0 // seconds until the sonar is ready
let ring = -1 // the sonar ring's age in seconds, while it spreads
let ringX = 0
let ringY = 0
let t = 0
let things: Thing[] = []
let frameDt = 0
let snow: { x: number; y: number; z: number }[] = []
let spawn = { jelly: 0, mine: 0, angler: 0, pearl: 0 }
const sub = { x: 0, y: 0, tx: 0, ty: 0, facing: 1, vx: 0 }
const keys = new Set<string>()
let useKeys = false

const speed = () => Math.min(400, 130 + depth * 0.06) // how fast the sea rises past, px a second
const light = () => Math.max(150, 640 - depth * 0.12) // how far the porthole light reaches

function size() {
  const cv = canvas.value
  if (!cv) return
  W = window.innerWidth
  H = window.innerHeight
  FS = W < 600 ? 13 : 16
  LH = FS * 1.15
  const dpr = isLite() ? 1 : Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.ceil(W * dpr)
  cv.height = Math.ceil(H * dpr)
  ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (ctx) {
    ctx.font = `${FS}px ${MONO}`
    cw = ctx.measureText('M').width || FS * 0.6
  }
  const n = isLite() ? 60 : 130
  snow = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 0.7 }))
}

function reset() {
  depth = 0
  pearls = 0
  hull = HULL
  hurt = 0
  shake = 0
  sonar = 0
  ring = -1
  things = []
  spawn = { jelly: 0.6, mine: 0, angler: 0, pearl: 0.3 }
  sub.x = W / 2
  sub.y = H * 0.35
  sub.tx = sub.x
  sub.ty = sub.y
}

// ---- opening and closing ----------------------------------------------------
function start() {
  if (open.value) return
  returnFocus = document.activeElement
  open.value = true
  mode.value = 'title'
  status.value = 'The deep end. Press Enter, Space or click to dive. Escape to go back.'
  try {
    best = Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    best = 0
  }
  document.documentElement.classList.add('arcade-open')
  window.dispatchEvent(new CustomEvent('sea:arcade', { detail: true }))
  nextTick(() => {
    size()
    reset()
    root.value?.focus()
    last = 0
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(loop)
  })
}

function close() {
  if (!open.value) return
  open.value = false
  cancelAnimationFrame(frame)
  keys.clear()
  document.documentElement.classList.remove('arcade-open')
  window.dispatchEvent(new CustomEvent('sea:arcade', { detail: false }))
  // The music goes back to the depth of the page you're on
  window.dispatchEvent(new CustomEvent('sea:zone', { detail: zoneBefore }))
  ;(returnFocus as HTMLElement | null)?.focus?.({ preventScroll: true })
}

function dive() {
  reset()
  zoneSent = -1
  mode.value = 'play'
  status.value = 'Diving.'
  dawn(true)
}

function over() {
  mode.value = 'over'
  const m = Math.round(depth)
  if (m > best) {
    best = m
    try {
      localStorage.setItem(BEST_KEY, String(best))
    } catch {}
  }
  status.value = `Hull breached at ${m.toLocaleString('en-US')} metres, with ${pearls} pearls. Best ${best.toLocaleString('en-US')} metres. Press Enter to dive again, Escape to go back.`
  dawn(false)
}

function fire() {
  if (sonar > 0) return
  sonar = SONAR_WAIT
  ring = 0
  ringX = sub.x
  ringY = sub.y
  ping(sub.x)
}

// ---- the game, frame by frame ---------------------------------------------------
function add(kind: Thing['kind']) {
  const art = kind === 'jelly' ? JELLY[0]! : kind === 'mine' ? MINE : kind === 'angler' ? ANGLER : ['o']
  const w = Math.max(...art.map((r) => r.length)) * cw
  const h = art.length * LH
  const facing = Math.random() < 0.5 ? 1 : -1
  const x = kind === 'angler' ? (facing > 0 ? -w : W) : 20 + Math.random() * (W - w - 40)
  things.push({
    kind,
    x,
    y: H + 20 + Math.random() * 40,
    vx: kind === 'angler' ? facing * (50 + Math.random() * 40) : 0,
    vy: kind === 'jelly' ? -20 - Math.random() * 30 : 0,
    w,
    h,
    phase: Math.random() * 6,
    stun: 0,
    facing,
    gone: false,
  })
}

function step(dt: number) {
  t += dt
  // Steering: toward the pointer, or with the keys
  if (useKeys) {
    const k = 380 * dt
    if (keys.has('ArrowLeft') || keys.has('a')) sub.tx -= k
    if (keys.has('ArrowRight') || keys.has('d')) sub.tx += k
    if (keys.has('ArrowUp') || keys.has('w')) sub.ty -= k
    if (keys.has('ArrowDown') || keys.has('s')) sub.ty += k
  }
  sub.tx = Math.max(60, Math.min(W - 60, sub.tx))
  sub.ty = Math.max(70, Math.min(H - 40, sub.ty))
  const px = sub.x
  const ease = Math.min(1, dt * 9)
  sub.x += (sub.tx - sub.x) * ease
  sub.y += (sub.ty - sub.y) * ease
  sub.vx += ((sub.x - px) / Math.max(dt, 1e-3) - sub.vx) * Math.min(1, dt * 6)
  if (Math.abs(sub.vx) > 20) sub.facing = sub.vx > 0 ? 1 : -1

  if (mode.value !== 'play') return

  const v = speed()
  depth += (v / 4) * dt
  hurt = Math.max(0, hurt - dt)
  shake = Math.max(0, shake - dt)
  sonar = Math.max(0, sonar - dt)
  if (ring >= 0) ring = ring + dt > 0.7 ? -1 : ring + dt

  // New things, more often and nastier the deeper it gets
  spawn.jelly -= dt
  spawn.mine -= dt
  spawn.angler -= dt
  spawn.pearl -= dt
  if (spawn.jelly <= 0) {
    add('jelly')
    spawn.jelly = Math.max(0.32, 1.15 - depth * 0.00028) * (0.7 + Math.random() * 0.6)
  }
  if (depth > 500 && spawn.mine <= 0) {
    add('mine')
    spawn.mine = Math.max(0.9, 2.6 - depth * 0.0004) * (0.7 + Math.random() * 0.6)
  }
  if (depth > 1400 && spawn.angler <= 0) {
    add('angler')
    spawn.angler = Math.max(1.6, 4.5 - depth * 0.0006) * (0.7 + Math.random() * 0.6)
  }
  if (spawn.pearl <= 0) {
    add(Math.random() < 0.08 ? 'big-pearl' : 'pearl')
    spawn.pearl = 0.55 + Math.random() * 0.6
  }

  // Everything rises past the diving submarine
  const R = 270 * Math.min(1, Math.max(0, ring) / 0.5)
  for (const th of things) {
    th.y -= v * dt
    th.y += th.vy * dt
    th.x += th.vx * dt
    th.stun = Math.max(0, th.stun - dt)
    if (th.kind === 'jelly') th.x += Math.sin(t * 1.6 + th.phase) * 22 * dt
    if (th.kind === 'angler') {
      // It turns to drift toward the submarine
      th.vy += (sub.y - (th.y + th.h / 2) > 0 ? 18 : -18) * dt
      th.vy *= 0.98
    }
    // The sonar ring shoves things outward and stuns jellyfish
    if (ring >= 0) {
      const cx = th.x + th.w / 2
      const cy = th.y + th.h / 2
      const d = Math.hypot(cx - ringX, cy - ringY)
      if (d < R + 20 && d > R - 60 && d > 1) {
        const push = 900 * dt
        th.vx += ((cx - ringX) / d) * push
        th.vy += ((cy - ringY) / d) * push
        if (th.kind === 'jelly') th.stun = 1.8
      }
    }
    th.vx *= th.kind === 'angler' ? 1 : 0.97
    if (th.y + th.h < -60 || th.x > W + 200 || th.x + th.w < -200) th.gone = true
  }

  // Bumping into things
  const hw = SUB[1]!.length * cw * 0.36
  const hh = LH * 0.8
  for (const th of things) {
    if (th.gone) continue
    const pad = th.kind.includes('pearl') ? -6 : th.w * 0.14
    const hit =
      sub.x + hw > th.x + pad && sub.x - hw < th.x + th.w - pad && sub.y + hh > th.y + pad * 0.6 && sub.y - hh < th.y + th.h - pad * 0.6
    if (!hit) continue
    if (th.kind === 'pearl' || th.kind === 'big-pearl') {
      th.gone = true
      pearls += th.kind === 'big-pearl' ? 5 : 1
      bubble(sub.x, true)
    } else if (!hurt && !(th.kind === 'jelly' && th.stun > 0)) {
      th.gone = true
      hull--
      hurt = 1.6
      shake = 0.35
      splash(sub.x, true)
      navigator.vibrate?.(60)
      if (hull <= 0) over()
    }
  }
  things = things.filter((th) => !th.gone)

  // The music sinks with you: the page's depths go from 0 to 5
  const z = Math.round(Math.min(5, depth / 800) * 20) / 20
  if (z !== zoneSent) {
    zoneSent = z
    window.dispatchEvent(new CustomEvent('sea:zone', { detail: z }))
  }
}

// ---- drawing ------------------------------------------------------------------
function text(s: string, x: number, y: number, color: string, alpha = 1) {
  if (!ctx) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillText(s, x, y)
}

function art(lines: string[], x: number, y: number, color: string, facing = 1, alpha = 1) {
  lines.forEach((line, r) => {
    const row = facing < 0 ? [...line].reverse().map((g) => MIRROR[g] ?? g).join('') : line
    text(row, x, y + r * LH, color, alpha)
  })
}

function glow(x: number, y: number, r: number, rgb: string, a: number) {
  if (!ctx) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb}, ${a})`)
  g.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.globalAlpha = 1
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

function draw() {
  const c = ctx
  if (!c) return
  const deep = Math.min(1, depth / 4000)
  // The water darkens as you go down
  const top = [Math.round(10 - 8 * deep), Math.round(30 - 26 * deep), Math.round(58 - 50 * deep)]
  c.globalAlpha = 1
  c.fillStyle = `rgb(${top.join(',')})`
  c.fillRect(0, 0, W, H)

  c.save()
  if (shake > 0) c.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake)
  c.font = `${FS}px ${MONO}`
  c.textBaseline = 'top'
  c.textAlign = 'left'

  // Marine snow, rising past
  const v = mode.value === 'play' ? speed() : 40
  for (const s of snow) {
    s.y -= v * s.z * frameDt
    if (s.y < -10) {
      s.y = H + 10
      s.x = Math.random() * W
    }
    text(s.z > 0.75 ? '·' : '.', s.x, s.y, '#9fc6e8', 0.25 + 0.35 * s.z)
  }

  for (const th of things) {
    if (th.kind === 'pearl' || th.kind === 'big-pearl') {
      const big = th.kind === 'big-pearl'
      glow(th.x + cw / 2, th.y + LH / 2, big ? 26 : 16, '255, 236, 190', big ? 0.5 : 0.35)
      text(big ? 'O' : 'o', th.x, th.y, '#fff1cf')
    } else if (th.kind === 'jelly') {
      const stunned = th.stun > 0
      const col = stunned ? '#4d5f7a' : th.phase > 3 ? '#ff7ace' : '#9684ff'
      if (!stunned) glow(th.x + th.w / 2, th.y + LH, 46, th.phase > 3 ? '255, 122, 206' : '150, 132, 255', 0.22)
      art(JELLY[Math.floor(t * 4 + th.phase) % 2]!, th.x, th.y, col)
    } else if (th.kind === 'mine') {
      glow(th.x + th.w / 2, th.y + LH * 1.5, 34, '255, 120, 80', 0.18 + 0.12 * Math.sin(t * 6 + th.phase))
      art(MINE, th.x, th.y, '#ff9a6b')
    } else {
      // The anglerfish: a dim body behind a bright lure
      art(ANGLER, th.x, th.y, '#7fd6a8', th.vx >= 0 ? 1 : -1, 0.85)
      const lureX = th.vx >= 0 ? th.x + 5 * cw : th.x + (ANGLER[2]!.length - 6) * cw
      glow(lureX + cw / 2, th.y + LH / 2, 30, '255, 230, 140', 0.5)
    }
  }

  // The submarine, blinking for a moment after a hit
  if (mode.value !== 'over' && !(hurt > 0 && Math.floor(hurt * 10) % 2 === 0)) {
    const w = SUB[1]!.length * cw
    const port = sub.facing > 0 ? sub.x + w / 2 - 2.5 * cw : sub.x - w / 2 + 2.5 * cw
    glow(port, sub.y + LH * 0.5, 60, '255, 206, 96', 0.6)
    art(SUB, sub.x - w / 2, sub.y - LH, '#c9d8ee', sub.facing)
    if (Math.random() < 0.3) text('o', sub.x - sub.facing * (w / 2 + cw), sub.y + Math.random() * 6, '#d4e8ff', 0.6)
  }

  // The sonar ring, in dots
  if (ring >= 0) {
    const R = 270 * Math.min(1, ring / 0.5)
    const n = 48
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      text(k % 2 ? '.' : 'o', ringX + Math.cos(a) * R, ringY + Math.sin(a) * R, '#5ccfff', 1 - ring / 0.7)
    }
  }
  c.restore()

  // The dark closing in around the porthole light (and lit up by the sonar)
  const reach = light() + (ring >= 0 ? 200 * (1 - ring / 0.7) : 0)
  const dark = c.createRadialGradient(sub.x, sub.y, reach * 0.35, sub.x, sub.y, reach)
  dark.addColorStop(0, 'rgba(1, 3, 8, 0)')
  dark.addColorStop(1, `rgba(1, 3, 8, ${0.3 + 0.65 * deep})`)
  c.globalAlpha = 1
  c.fillStyle = dark
  c.fillRect(0, 0, W, H)

  // What you need to know, along the top
  c.font = `${FS}px ${MONO}`
  c.textBaseline = 'top'
  c.textAlign = 'left'
  const m = `${Math.round(depth).toLocaleString('en-US')} m`
  text(m, 20, 18, '#e4eeff')
  text(`pearls ${pearls}`, 20, 18 + LH * 1.4, '#fff1cf', 0.85)
  text(`hull [${'#'.repeat(hull)}${'-'.repeat(HULL - hull)}]`, 20, 18 + LH * 2.6, hull > 1 ? '#c9d8ee' : '#ff9a6b', 0.85)
  const ready = sonar <= 0
  text(ready ? 'sonar ready' : `sonar ${'.'.repeat(Math.ceil((sonar / SONAR_WAIT) * 6))}`, 20, 18 + LH * 3.8, ready ? '#5ccfff' : '#7f95b8', 0.85)
  c.textAlign = 'right'
  if (best) text(`best ${best.toLocaleString('en-US')} m`, W - 20, 18 + LH * 2.6, '#7f95b8', 0.75)

  // The title and the end
  c.textAlign = 'center'
  if (mode.value === 'title') {
    c.font = `bold ${FS * 2.2}px ${MONO}`
    text('the deep end', W / 2, H * 0.42, '#e4eeff')
    c.font = `${FS}px ${MONO}`
    text('steer with the mouse, a finger or the arrow keys', W / 2, H * 0.42 + 56, '#9fc6e8', 0.9)
    text('click, tap or space fires the sonar', W / 2, H * 0.42 + 56 + LH * 1.3, '#9fc6e8', 0.9)
    text('dodge everything but the pearls', W / 2, H * 0.42 + 56 + LH * 2.6, '#9fc6e8', 0.9)
    text('[ click to dive ]', W / 2, H * 0.42 + 56 + LH * 4.6, '#5ccfff', 0.6 + 0.4 * Math.sin(t * 3))
  } else if (mode.value === 'over') {
    c.font = `bold ${FS * 1.8}px ${MONO}`
    text('hull breached', W / 2, H * 0.4, '#ff9a6b')
    c.font = `${FS}px ${MONO}`
    text(`${m} down, ${pearls} pearls`, W / 2, H * 0.4 + 48, '#e4eeff')
    text(Math.round(depth) >= best ? 'your deepest yet' : `best ${best.toLocaleString('en-US')} m`, W / 2, H * 0.4 + 48 + LH * 1.4, '#9fc6e8', 0.9)
    text('[ click to dive again ]', W / 2, H * 0.4 + 48 + LH * 3.4, '#5ccfff', 0.6 + 0.4 * Math.sin(t * 3))
  }
  c.globalAlpha = 1
}

function loop(now: number) {
  frame = requestAnimationFrame(loop)
  if (document.hidden) {
    last = 0
    return
  }
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
  last = now
  frameDt = dt
  step(dt)
  draw()
}

// ---- input --------------------------------------------------------------------
function onPointer(e: PointerEvent) {
  useKeys = false
  sub.tx = e.clientX
  sub.ty = e.clientY
}
function onPress(e: PointerEvent) {
  onPointer(e)
  if (mode.value === 'play') fire()
  else dive()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    if (mode.value === 'play') fire()
    else dive()
    return
  }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(k)) {
    e.preventDefault()
    useKeys = true
    keys.add(k)
  }
}
function onKeyUp(e: KeyboardEvent) {
  keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key)
}

// ---- the secret ways in ------------------------------------------------------------
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
let typed: string[] = []
function listen(e: KeyboardEvent) {
  if (open.value) return
  if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return
  typed = [...typed, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-10)
  const tail = (n: number) => typed.slice(-n).join(',')
  if (tail(10) === KONAMI.join(',') || typed.slice(-4).join('') === 'dive') {
    typed = []
    e.preventDefault()
    start()
  }
}

// Three quick clicks or taps on the moon
let taps: number[] = []
function onTap(e: PointerEvent) {
  if (open.value || e.button !== 0) return
  const level = waterlineY()
  let mx: number
  let my: number
  let r: number
  if (hasFinePointer() && e.pointerType !== 'touch') {
    if (!cursorState.moon) return
    mx = cursorState.moon.x
    my = cursorState.moon.y
    r = MOON_R * 1.2
  } else {
    if (!Number.isFinite(level) || level <= 110) return
    mx = window.innerWidth * 0.8
    my = level * 0.36
    r = skyMoonR(level) * 1.5
  }
  if (Math.hypot(e.clientX - mx, e.clientY - my) > r) {
    taps = []
    return
  }
  const now = performance.now()
  taps = [...taps.filter((x) => now - x < 700), now]
  if (taps.length >= 3) {
    taps = []
    start()
  }
}

function onZone(e: Event) {
  if (open.value) return
  const z = (e as CustomEvent<number>).detail
  if (typeof z === 'number') zoneBefore = z
}

onMounted(() => {
  window.addEventListener('keydown', listen)
  window.addEventListener('pointerdown', onTap)
  window.addEventListener('sea:zone', onZone)
  window.addEventListener('sea:play', start)
  window.addEventListener('resize', size)
})

onBeforeUnmount(() => {
  close()
  window.removeEventListener('keydown', listen)
  window.removeEventListener('pointerdown', onTap)
  window.removeEventListener('sea:zone', onZone)
  window.removeEventListener('sea:play', start)
  window.removeEventListener('resize', size)
})
</script>

<template>
  <div
    v-if="open"
    ref="root"
    class="arcade"
    role="dialog"
    aria-modal="true"
    aria-label="The deep end, a game"
    tabindex="-1"
    @keydown="onKey"
    @keyup="onKeyUp"
  >
    <canvas
      ref="canvas"
      class="arcade-canvas"
      aria-hidden="true"
      @pointermove="onPointer"
      @pointerdown.prevent="onPress"
    />
    <button type="button" class="arcade-exit" @click="close">surface <span aria-hidden="true">(esc)</span></button>
    <p class="sr-only" aria-live="polite">{{ status }}</p>
  </div>
</template>
