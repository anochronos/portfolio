// The sea's sound, made with the Web Audio API. There's music ("Bread" by
// Lukrembo, public/audio/bread.mp3, credited in the footer), and under it the
// swell of the water, made on the spot. Both grow muffled and deep the
// further down the page you go, as if you were sinking, and the bottom of the
// sea is meant to be unnerving: the music is smothered and slows and sags in
// pitch, a dissonant hum rises under it, and now and then something groans
// in the dark. On top are short
// sounds, also made on the spot, for what you do:
//   - a splash when the cursor goes through the surface
//   - the submarine's bubbles
//   - a sonar ping when you click the water
//   - the ratchet of the fish hook reeling you up
//   - a few notes when night turns to day, or back
// It's on unless the visitor has turned it off (SoundSwitch.vue), which is
// remembered. It tries to start as soon as the page loads, but most browsers
// only let a page make sound once the visitor has clicked, tapped or pressed
// a key (scrolling doesn't count), so usually it starts with the first one.

const KEY = 'sea-sound'
const VOLUME_KEY = 'sea-volume'
const DEEPEST = 5 // the contact section's data-zone

let ac: AudioContext | null = null
let out!: GainNode // everything goes through here; fading it is the on/off
let fx!: GainNode // the short sounds
let echo!: GainNode // send for the sonar's echo
let brown!: AudioBuffer
let amb: {
  body: BiquadFilterNode
  surf: GainNode
  drone: GainNode
  dread: GainNode
} | null = null

// The music: streamed by an audio element (only fetched once sound is on)
// and sent through a filter that muffles it with depth
let musicUrl = ''
let music: HTMLAudioElement | null = null
let musicTone: BiquadFilterNode[] = [] // two lowpass filters in a row, for a steep cut
let musicLevel: GainNode | null = null
let musicRate = 1 // the speed (and with it the pitch) the music is easing toward
let groanTimer = 0

let on = false
let started = false // actually making sound, not just switched on
let depth = 0
const last: Record<string, number> = {}

// The volume, 0 to 1, set with the meter beside the sound switch and
// remembered. Half to begin with. It's squared on the way to the speakers, which sounds more
// even across the meter than a straight line would.
let volume = 0.5
let meter: AnalyserNode | null = null
let meterBuf: Float32Array<ArrayBuffer> | null = null
const loud = () => 0.9 * volume * volume

export function soundVolume(): number {
  return volume
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  try {
    localStorage.setItem(VOLUME_KEY, volume.toFixed(2))
  } catch {}
  if (ac && started) out.gain.setTargetAtTime(loud(), ac.currentTime, 0.05)
}

// How loud it is right now, about 0 to 1, for the meter to flicker with
export function soundLevel(): number {
  if (!meter || !meterBuf || !started) return 0
  meter.getFloatTimeDomainData(meterBuf)
  let sum = 0
  for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i]! * meterBuf[i]!
  return Math.min(1, Math.sqrt(sum / meterBuf.length) * 5)
}

export function soundOn(): boolean {
  return on
}

// Whether sound is actually playing (on, and the browser has let it start)
export function soundPlaying(): boolean {
  return started
}

// ---- setting up --------------------------------------------------------------

// Brown noise: random steps that wander, which sounds like moving water
function makeNoise(c: AudioContext): AudioBuffer {
  const len = c.sampleRate * 4
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let v = 0
    for (let i = 0; i < len; i++) {
      v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = v * 3.5
    }
    // Ease the loop's seam so it doesn't click
    const fade = 2000
    for (let i = 0; i < fade; i++) {
      const k = i / fade
      d[len - fade + i] = d[len - fade + i]! * (1 - k) + d[i]! * k
    }
  }
  return buf
}

function loop(c: AudioContext): AudioBufferSourceNode {
  const s = c.createBufferSource()
  s.buffer = brown
  s.loop = true
  s.start(0, Math.random() * 3)
  return s
}

// A slow wobble added to a gain, like the swell rising and falling
function swell(c: AudioContext, target: AudioParam, rate: number, amount: number) {
  const lfo = c.createOscillator()
  lfo.frequency.value = rate
  const g = c.createGain()
  g.gain.value = amount
  lfo.connect(g).connect(target)
  lfo.start()
}

// Phones and tablets: their speakers can't play the deepest notes (asked
// to, they rattle and crackle), and they're busier, so the sound gets a
// bigger buffer to keep from running dry, which is heard as crackling too
const handheld = () => window.matchMedia('(hover: none), (pointer: coarse)').matches

function build(): AudioContext | null {
  if (ac) return ac
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  let c: AudioContext
  try {
    c = new AC({ latencyHint: handheld() ? 'playback' : 'interactive' })
  } catch {
    c = new AC()
  }
  ac = c
  brown = makeNoise(c)

  out = c.createGain()
  out.gain.value = 0
  // Everything below what the speakers can play is cut before it gets to them
  const floor = c.createBiquadFilter()
  floor.type = 'highpass'
  floor.frequency.value = handheld() ? 110 : 28
  floor.Q.value = 0.7
  // A gentle limiter, slow enough not to distort the low notes it catches
  const limit = c.createDynamicsCompressor()
  limit.threshold.value = -14
  limit.knee.value = 12
  limit.ratio.value = 6
  limit.attack.value = 0.02
  limit.release.value = 0.3
  out.connect(floor).connect(limit).connect(c.destination)
  meter = c.createAnalyser()
  meter.fftSize = 512
  meterBuf = new Float32Array(meter.fftSize)
  limit.connect(meter)

  fx = c.createGain()
  fx.gain.value = 0.9
  fx.connect(out)

  // The sonar's echo: a dark, fading repeat
  echo = c.createGain()
  echo.gain.value = 0.55
  const delay = c.createDelay(1)
  delay.delayTime.value = 0.34
  const back = c.createGain()
  back.gain.value = 0.38
  const dark = c.createBiquadFilter()
  dark.type = 'lowpass'
  dark.frequency.value = 1500
  echo.connect(delay).connect(dark).connect(back).connect(delay)
  dark.connect(out)

  // The water: a low wash that rises and falls with the swell
  const body = c.createBiquadFilter()
  body.type = 'lowpass'
  body.frequency.value = 700
  body.Q.value = 0.4
  const bodyGain = c.createGain()
  bodyGain.gain.value = 0.13
  loop(c).connect(body).connect(bodyGain).connect(out)
  swell(c, bodyGain.gain, 0.09, 0.05)

  // The surface: the hiss of small waves breaking, only up top
  const hiss = c.createBiquadFilter()
  hiss.type = 'bandpass'
  hiss.frequency.value = 1700
  hiss.Q.value = 0.5
  const surf = c.createGain()
  surf.gain.value = 0.04
  const surfMod = c.createGain()
  surfMod.gain.value = 1
  loop(c).connect(hiss).connect(surfMod).connect(surf).connect(out)
  swell(c, surfMod.gain, 0.14, 0.6)

  // The deep: a low hum that comes in as you go down
  const drone = c.createGain()
  drone.gain.value = 0
  const hum = c.createBiquadFilter()
  hum.type = 'lowpass'
  hum.frequency.value = 160
  for (const [f, g] of [
    [46, 0.6],
    [69.3, 0.35],
    [92.5, 0.15],
  ] as const) {
    const o = c.createOscillator()
    o.frequency.value = f
    const og = c.createGain()
    og.gain.value = g
    o.connect(og).connect(hum)
    swell(c, o.frequency, 0.05 + f * 0.001, 0.6)
    o.start()
  }
  hum.connect(drone).connect(out)

  // The dread: only near the bottom. A very low note with two others a
  // tritone above it, slightly out of tune with each other so they beat
  // slowly and never settle
  const dread = c.createGain()
  dread.gain.value = 0
  const murk = c.createBiquadFilter()
  murk.type = 'lowpass'
  murk.frequency.value = 220
  for (const [f, g] of [
    [32.7, 0.9],
    [46.2, 0.45],
    [47.1, 0.45],
    [138.6, 0.08],
  ] as const) {
    const o = c.createOscillator()
    o.type = f > 100 ? 'triangle' : 'sine'
    o.frequency.value = f
    const og = c.createGain()
    og.gain.value = g
    o.connect(og).connect(murk)
    swell(c, o.frequency, 0.031 + f * 0.0007, f * 0.012)
    o.start()
  }
  murk.connect(dread).connect(out)

  amb = { body, surf, drone, dread }
  setDepth(depth, true)
  return c
}

// The music, set up the first time sound is turned on
function buildMusic(c: AudioContext) {
  if (music || !musicUrl) return
  const el = new Audio()
  el.src = musicUrl
  el.loop = true
  el.preload = 'auto'
  el.crossOrigin = 'anonymous'
  music = el
  // Slowing it down lowers its pitch too, instead of keeping it in tune
  el.preservesPitch = false
  musicTone = [c.createBiquadFilter(), c.createBiquadFilter()]
  for (const f of musicTone) {
    f.type = 'lowpass'
    f.Q.value = 0.85
  }
  musicLevel = c.createGain()
  musicLevel.gain.value = 0.36
  c.createMediaElementSource(el).connect(musicTone[0]!).connect(musicTone[1]!).connect(musicLevel).connect(out)
  setDepth(depth, true)
}

function playMusic() {
  music?.play().catch(() => {})
}

// ---- turning it on and off -----------------------------------------------------

// `gesture` is whether this is running inside a click, tap or key press,
// when the browser allows sound. Without one it only gets going if the
// browser allows sound anyway (say, Chrome on a site you've played media on
// before); otherwise it waits, and the next gesture starts it.
function start(gesture: boolean) {
  const c = build()
  if (!c) return
  out.gain.cancelScheduledValues(c.currentTime)
  out.gain.setTargetAtTime(loud(), c.currentTime, 0.6)
  const go = () => {
    if (!on || c.state !== 'running') return
    started = true
    // The music is only fetched once there's sound to hear it with
    buildMusic(c)
    playMusic()
  }
  // Safari wants the music started right inside the click, not after it
  if (gesture) {
    buildMusic(c)
    playMusic()
  }
  if (c.state === 'running') go()
  else c.resume().then(go).catch(() => {})
}

function stop() {
  clearTimeout(groanTimer)
  groanTimer = 0
  if (!ac) return
  const c = ac
  out.gain.cancelScheduledValues(c.currentTime)
  out.gain.setTargetAtTime(0, c.currentTime, 0.12)
  started = false
  window.setTimeout(() => {
    if (on) return
    music?.pause()
    c.suspend().catch(() => {})
  }, 700)
}

export function setSound(value: boolean) {
  on = value
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {}
  if (on) {
    start(true)
    // A bubble to say it's on
    window.setTimeout(() => bubble(window.innerWidth / 2, true), 120)
  } else stop()
  window.dispatchEvent(new CustomEvent('sea:sound', { detail: on }))
}

export function toggleSound() {
  setSound(!on)
}

// How deep you are: the water muffles and the hum comes up as you go down
function setDepth(zone: number, now = false) {
  depth = zone
  if (!ac || !amb) return
  const k = Math.max(0, Math.min(1, zone / DEEPEST))
  const t = ac.currentTime
  const tc = now ? 0.01 : 1.2
  amb.body.frequency.setTargetAtTime(700 * Math.pow(160 / 700, k), t, tc)
  amb.surf.gain.setTargetAtTime(zone === 0 ? 0.04 : 0, t, tc)
  // The music: clear at the surface, then cut harder and harder until at
  // the bottom only a dull thud of it gets through (about 6 kHz a section
  // down, under 300 Hz at the bottom), quieter, slower and lower
  const cut = 18000 * Math.pow(260 / 18000, Math.pow(k, 0.85))
  for (const f of musicTone) f.frequency.setTargetAtTime(cut, t, tc)
  musicLevel?.gain.setTargetAtTime(0.36 - 0.1 * k * k, t, tc)
  // (not on phones, where changing the speed as it plays tends to crackle)
  musicRate = handheld() ? 1 : 1 - 0.2 * k * k
  amb.drone.gain.setTargetAtTime(0.012 + 0.07 * k * k, t, tc)
  amb.dread.gain.setTargetAtTime(0.16 * Math.pow(Math.max(0, (k - 0.4) / 0.6), 2), t, tc * 1.6)
  if (zone >= DEEPEST - 2) groanSoon()
  if (!rateTimer) easeRate()
}

// The music's speed eases toward musicRate a little at a time, as a sudden
// jump would be heard as a glitch
let rateTimer = 0
function easeRate() {
  if (!music) return
  const r = music.playbackRate
  if (Math.abs(r - musicRate) < 0.004) {
    music.playbackRate = musicRate
    rateTimer = 0
    return
  }
  music.playbackRate = r + Math.sign(musicRate - r) * 0.004
  rateTimer = window.setTimeout(easeRate, 60)
}

// Something big, far off in the dark: a low groan that sags in pitch, with
// the creak of something under strain. Every so often while you're deep.
function groanSoon() {
  if (groanTimer) return
  groanTimer = window.setTimeout(
    () => {
      groanTimer = 0
      if (depth < DEEPEST - 2) return
      groan()
      groanSoon()
    },
    7000 + Math.random() * 11000,
  )
}

function groan() {
  const c = ready('groan', 4000)
  if (!c) return
  const t = c.currentTime
  const deep = Math.min(1, depth / DEEPEST)
  const x = Math.random() * window.innerWidth
  const p = pan(c, x)
  p.connect(fx)
  p.connect(echo)
  const f0 = 70 + Math.random() * 30
  const o = c.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(f0, t)
  o.frequency.linearRampToValueAtTime(f0 * 1.12, t + 0.9)
  o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 3.2)
  const dark = c.createBiquadFilter()
  dark.type = 'lowpass'
  dark.frequency.setValueAtTime(180, t)
  dark.frequency.linearRampToValueAtTime(420, t + 1)
  dark.frequency.exponentialRampToValueAtTime(140, t + 3.2)
  dark.Q.value = 4
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.22 * deep, t + 0.8)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4)
  o.connect(dark).connect(g).connect(p)
  o.start(t)
  o.stop(t + 3.5)
  // The creak: a handful of rough little scrapes
  const creak = c.createBiquadFilter()
  creak.type = 'bandpass'
  creak.frequency.value = 520 + Math.random() * 300
  creak.Q.value = 9
  creak.connect(p)
  const n = 5 + Math.floor(Math.random() * 6)
  for (let i = 0; i < n; i++) {
    const tt = t + 0.4 + i * (0.05 + Math.random() * 0.06)
    burst(c, tt, 0.04).connect(hit(c, tt, 0.5 * deep, 0.002, 0.035)).connect(creak)
  }
}

// Read the remembered choice and listen for what the sound follows. Called
// once, by SoundSwitch.vue, which returns the cleanup.
export function initSound(url: string): () => void {
  musicUrl = url
  try {
    on = localStorage.getItem(KEY) !== 'off'
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '')
    if (Number.isFinite(v)) volume = Math.max(0, Math.min(1, v))
  } catch {
    on = true
  }
  // Each of these can be the gesture that lets sound start. A tap only
  // counts once the finger lifts, so pointerdown alone isn't enough on phones.
  const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']
  const unlock = (e: Event) => {
    // A first click on the switch itself is turning the sound off: don't
    // start it just to stop it again
    if ((e.target as Element | null)?.closest?.('.sound-switch')) return
    if (on && (!started || music?.paused)) start(true)
  }
  const onZone = (e: Event) => {
    const z = (e as CustomEvent<number>).detail
    if (typeof z === 'number') setDepth(z)
  }
  const onVisible = () => {
    if (!ac) return
    if (document.hidden) {
      music?.pause()
      ac.suspend().catch(() => {})
    } else if (on && started) {
      ac.resume().catch(() => {})
      playMusic()
    }
  }
  for (const g of GESTURES) window.addEventListener(g, unlock, true)
  window.addEventListener('sea:zone', onZone)
  document.addEventListener('visibilitychange', onVisible)
  // Try straight away, in case this browser lets the page play sound
  if (on) start(false)
  return () => {
    for (const g of GESTURES) window.removeEventListener(g, unlock, true)
    window.removeEventListener('sea:zone', onZone)
    document.removeEventListener('visibilitychange', onVisible)
    stop()
  }
}

// ---- the short sounds ----------------------------------------------------------

// Whether a sound can play now: sound is on and running, and this kind of
// sound hasn't played in the last `gap` milliseconds
function ready(kind: string, gap: number): AudioContext | null {
  if (!on || !ac || ac.state !== 'running') return null
  const now = performance.now()
  if (now - (last[kind] ?? -1e9) < gap) return null
  last[kind] = now
  return ac
}

// Left or right with where it happened on screen
function pan(c: AudioContext, x: number): StereoPannerNode {
  const p = c.createStereoPanner()
  p.pan.value = Math.max(-1, Math.min(1, (x / window.innerWidth) * 2 - 1)) * 0.7
  return p
}

// A gain that rises quickly to `peak` and dies away over `decay` seconds
function hit(c: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  return g
}

function burst(c: AudioContext, t: number, dur: number): AudioBufferSourceNode {
  const s = c.createBufferSource()
  s.buffer = brown
  s.start(t, Math.random() * 3, dur)
  return s
}

// Through the surface: a rush of water, and a plop going in
export function splash(x: number, goingIn: boolean) {
  const c = ready('splash', 160)
  if (!c) return
  const t = c.currentTime
  const p = pan(c, x)
  p.connect(fx)
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = 0.8
  f.frequency.setValueAtTime(goingIn ? 1600 : 1100, t)
  f.frequency.exponentialRampToValueAtTime(goingIn ? 420 : 2200, t + 0.35)
  burst(c, t, 0.6).connect(f).connect(hit(c, t, 0.9, 0.008, 0.45)).connect(p)
  if (goingIn) {
    const o = c.createOscillator()
    o.frequency.setValueAtTime(260, t + 0.02)
    o.frequency.exponentialRampToValueAtTime(70, t + 0.22)
    o.connect(hit(c, t + 0.02, 0.28, 0.006, 0.2)).connect(p)
    o.start(t + 0.02)
    o.stop(t + 0.3)
  }
}

// A bubble: a short note that slides up as it rises
export function bubble(x: number, always = false) {
  const c = ready('bubble', 90)
  if (!c || (!always && Math.random() < 0.35)) return
  const t = c.currentTime
  const f0 = 360 + Math.random() * 460
  const o = c.createOscillator()
  o.frequency.setValueAtTime(f0, t)
  o.frequency.exponentialRampToValueAtTime(f0 * 2.3, t + 0.07)
  const p = pan(c, x)
  o.connect(hit(c, t, 0.09 + Math.random() * 0.05, 0.004, 0.08)).connect(p).connect(fx)
  o.start(t)
  o.stop(t + 0.12)
}

// Sonar: a clear tone that rings out and comes back off the dark. A little
// lower the deeper you are.
export function ping(x: number) {
  const c = ready('ping', 180)
  if (!c) return
  const t = c.currentTime
  const f = 1240 - Math.min(depth, DEEPEST) * 70
  const p = pan(c, x)
  p.connect(fx)
  p.connect(echo)
  for (const [mul, level] of [
    [1, 0.24],
    [2.01, 0.04],
  ] as const) {
    const o = c.createOscillator()
    o.frequency.value = f * mul
    o.connect(hit(c, t, level, 0.004, 1.3)).connect(p)
    o.start(t)
    o.stop(t + 1.5)
  }
}

// The fish hook's reel: a ratchet that speeds up and then slows, for as long
// as the page takes to scroll back to the top
export function reel() {
  const c = ready('reel', 1200)
  if (!c) return
  const t0 = c.currentTime + 0.02
  const n = 26
  const len = 1.45
  const tick = c.createBiquadFilter()
  tick.type = 'highpass'
  tick.frequency.value = 2400
  tick.connect(fx)
  let t = t0
  for (let i = 0; i < n; i++) {
    // Fast in the middle, slow at either end, like the scroll itself
    const k = i / (n - 1)
    t += (len / n) * (1.6 - Math.sin(Math.PI * k) * 1.05)
    const level = 0.16 + 0.1 * Math.sin(Math.PI * k)
    burst(c, t, 0.02).connect(hit(c, t, level, 0.001, 0.014)).connect(tick)
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = 1700 + Math.random() * 300
    o.connect(hit(c, t, level * 0.35, 0.001, 0.01)).connect(fx)
    o.start(t)
    o.stop(t + 0.03)
  }
}

// The boat's radio, when the crew calls out (ShipCalls.vue): two quick,
// quiet blips
export function chirp(x: number) {
  const c = ready('chirp', 800)
  if (!c) return
  const p = pan(c, x)
  p.connect(fx)
  ;[1560, 2080].forEach((f, i) => {
    const t = c.currentTime + i * 0.075
    const o = c.createOscillator()
    o.type = 'square'
    o.frequency.value = f
    const soft = c.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = 2600
    o.connect(soft).connect(hit(c, t, 0.022, 0.003, 0.05)).connect(p)
    o.start(t)
    o.stop(t + 0.08)
  })
}

// The crab, clacking its claws as it talks (CrabSecret.vue): two dry clicks
export function clack(x: number) {
  const c = ready('clack', 150)
  if (!c) return
  const p = pan(c, x)
  p.connect(fx)
  const dry = c.createBiquadFilter()
  dry.type = 'bandpass'
  dry.frequency.value = 3200
  dry.Q.value = 3
  dry.connect(p)
  ;[0, 0.085].forEach((d, i) => {
    const t = c.currentTime + d
    burst(c, t, 0.02).connect(hit(c, t, i ? 0.35 : 0.45, 0.001, 0.018)).connect(dry)
  })
}

// Night to day: a few soft notes rising; day to night: falling, and lower
export function dawn(day: boolean) {
  const c = ready('dawn', 600)
  if (!c) return
  const notes = day ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 622.25, 523.25, 392]
  notes.forEach((f, i) => {
    const t = c.currentTime + 0.02 + i * 0.11
    const o = c.createOscillator()
    o.type = day ? 'triangle' : 'sine'
    o.frequency.value = f
    const g = hit(c, t, 0.1, 0.02, 1.4)
    o.connect(g).connect(fx)
    g.connect(echo)
    o.start(t)
    o.stop(t + 1.6)
  })
}
