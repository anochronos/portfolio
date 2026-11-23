// Shared pieces for everything on the site that draws with characters.

// From empty to dense. Index 0 is a space and never gets drawn.
export const RAMP = ' .`:-=+*cxoO#%@'

export const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'

// Seven hues, each in LEVELS steps of brightness, all tuned for the navy page.
// Green and pink belong to the deeper creatures.
export const HUE = { blue: 0, cyan: 1, ice: 2, violet: 3, warm: 4, green: 5, pink: 6 } as const
const HUE_RGB: [number, number, number][] = [
  [72, 118, 255],
  [92, 207, 255],
  [214, 234, 255],
  [150, 132, 255],
  [255, 206, 128],
  [112, 255, 176],
  [255, 122, 206],
]
export const LEVELS = 10

export const COLORS: string[] = HUE_RGB.flatMap(([r, g, b]) =>
  Array.from({ length: LEVELS }, (_, l) => {
    const f = 0.2 + 0.8 * (l / (LEVELS - 1))
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`
  }),
)

// The same colours as numbers (r, g, b per colour index), for code that
// writes pixels directly
export const COLOR_RGB: Uint8Array = Uint8Array.from(
  HUE_RGB.flatMap(([r, g, b]) =>
    Array.from({ length: LEVELS }, (_, l) => {
      const f = 0.2 + 0.8 * (l / (LEVELS - 1))
      return [Math.round(r * f), Math.round(g * f), Math.round(b * f)]
    }).flat(),
  ),
)

export function colorIndex(hue: number, level: number): number {
  return hue * LEVELS + Math.max(0, Math.min(LEVELS - 1, level))
}

// Sort a photo's colour into one of the five hues.
export function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max < 1 || (max - min) / max < 0.22) return HUE.ice
  let h: number
  const d = max - min
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  if (h < 75 || h >= 330) return HUE.warm
  if (h < 200) return HUE.cyan
  if (h < 248) return HUE.blue
  return HUE.violet
}

export function rampIndex(v: number): number {
  return Math.max(0, Math.min(RAMP.length - 1, Math.floor(v * RAMP.length)))
}

// Wait for the mono font so glyphs are measured and drawn with the right shapes.
export async function monoReady(px: number): Promise<void> {
  try {
    await document.fonts?.load(`${px}px ${MONO}`)
  } catch {
    // The fallback monospace font still works.
  }
}

// Every character in every colour, drawn once into one sheet, then copied
// cell by cell. Copying an image is far cheaper than drawing text each frame.
// The sheet is drawn on the page (where the fonts are) and can then be handed
// to a background thread as an image.
export interface GlyphSheet {
  image: CanvasImageSource
  chars: string
  tw: number
  th: number
  perRow: number
}

// Anything canvas-like a glyph can be drawn into, on the page or in a worker
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function drawGlyphSheet(chars: string, fontPx: number, cellW: number, cellH: number, scale = 1): GlyphSheet & { image: HTMLCanvasElement } {
  const unique = Array.from(new Set(chars.split('')))
  const tw = Math.ceil(cellW * scale) + 2
  const th = Math.ceil(cellH * scale) + 2
  const count = unique.length * COLORS.length
  const perRow = Math.max(1, Math.floor(4096 / tw))
  const canvas = document.createElement('canvas')
  canvas.width = tw * Math.min(count, perRow)
  canvas.height = th * Math.ceil(count / perRow)
  const ctx = canvas.getContext('2d')!
  ctx.font = `${fontPx * scale}px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  COLORS.forEach((color, ci) => {
    ctx.fillStyle = color
    unique.forEach((ch, k) => {
      const slot = ci * unique.length + k
      const x = (slot % perRow) * tw
      const y = Math.floor(slot / perRow) * th
      ctx.fillText(ch, x + tw / 2, y + th / 2 + 0.5)
    })
  })
  return { image: canvas, chars: unique.join(''), tw, th, perRow }
}

export class GlyphAtlas {
  readonly image: CanvasImageSource
  readonly tw: number
  readonly th: number
  private readonly index = new Map<string, number>()
  private readonly perRow: number
  private readonly chars: number

  constructor(sheet: GlyphSheet) {
    this.image = sheet.image
    this.tw = sheet.tw
    this.th = sheet.th
    this.perRow = sheet.perRow
    const unique = Array.from(sheet.chars)
    unique.forEach((ch, i) => this.index.set(ch, i))
    this.chars = unique.length
  }

  has(ch: string): boolean {
    return this.index.has(ch)
  }

  // Draw character `ch` in colour `ci` with its cell's top-left at (x, y).
  draw(ctx: Ctx2D, ch: string, ci: number, x: number, y: number, w = this.tw, h = this.th): void {
    const k = this.index.get(ch)
    if (k === undefined) return
    const slot = ci * this.chars + k
    ctx.drawImage(
      this.image,
      (slot % this.perRow) * this.tw,
      Math.floor(slot / this.perRow) * this.th,
      this.tw,
      this.th,
      x,
      y,
      w,
      h,
    )
  }
}

// A character cell in the tiles is this many times taller than wide.
export const ASPECT = 1.75

// One large atlas shared by every tile; glyphs are scaled down as they are drawn.
let tileAtlas: GlyphAtlas | null = null
export function tileGlyphs(): GlyphAtlas {
  tileAtlas ??= new GlyphAtlas(drawGlyphSheet(RAMP, 40, 24, 24 * ASPECT))
  return tileAtlas
}

export function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

// Deterministic 0..1 noise from two numbers.
export function hash2(a: number, b: number): number {
  const v = Math.sin(a * 91.345 + b * 47.853) * 24634.6345
  return v - Math.floor(v)
}
