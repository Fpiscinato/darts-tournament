import type { Point } from "./boardGeometry"

/** Automatic dartboard localisation.
 *
 * Strategy: gradient-directed Hough voting finds an approximate circle
 * (centre + radius), then an algebraic (Kåsa) circle fit refines it on the
 * edge inliers. This finds *where* the board is and *how big* it appears —
 * not which segment is 20, which still needs one tap (or a manual 4-point
 * calibration).
 */

export interface DetectedBoard {
  center: Point
  /** Outer double ring radius, in pixels. */
  radius: number
  /** 0..1, roughly the fraction of the expected ring covered by edges. */
  confidence: number
}

export interface DetectOptions {
  /** Sobel magnitude required to count as an edge. */
  edgeThreshold?: number
  /** Search range as a fraction of the frame's shorter side. */
  minRadiusFraction?: number
  maxRadiusFraction?: number
  /** Accumulator bin size in pixels. */
  binSize?: number
}

interface Gradient {
  gx: Float32Array
  gy: Float32Array
  magnitude: Float32Array
}

function gradients(gray: Uint8ClampedArray, width: number, height: number): Gradient {
  const gx = new Float32Array(gray.length)
  const gy = new Float32Array(gray.length)
  const magnitude = new Float32Array(gray.length)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const tl = gray[i - width - 1]
      const tc = gray[i - width]
      const tr = gray[i - width + 1]
      const ml = gray[i - 1]
      const mr = gray[i + 1]
      const bl = gray[i + width - 1]
      const bc = gray[i + width]
      const br = gray[i + width + 1]

      const dx = tr + 2 * mr + br - (tl + 2 * ml + bl)
      const dy = bl + 2 * bc + br - (tl + 2 * tc + tr)
      gx[i] = dx
      gy[i] = dy
      magnitude[i] = Math.hypot(dx, dy)
    }
  }

  return { gx, gy, magnitude }
}

/**
 * Find the board's outer double ring in a grayscale frame.
 *
 * Returns null when no circle with enough support is found; callers should
 * fall back to the manual 4-point calibration.
 */
export function detectBoard(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  options: DetectOptions = {},
): DetectedBoard | null {
  const edgeThreshold = options.edgeThreshold ?? 60
  const binSize = options.binSize ?? 2
  const shorter = Math.min(width, height)
  const minRadius = Math.round((options.minRadiusFraction ?? 0.14) * shorter)
  const maxRadius = Math.round((options.maxRadiusFraction ?? 0.48) * shorter)
  if (maxRadius <= minRadius) return null

  const { gx, gy, magnitude } = gradients(gray, width, height)

  const cols = Math.ceil(width / binSize)
  const rows = Math.ceil(height / binSize)
  const radiusBins = Math.floor((maxRadius - minRadius) / binSize) + 1
  const accumulator = new Int32Array(cols * rows * radiusBins)

  // Each edge pixel votes for the centre candidates along its gradient
  // normal, once per radius bin, on both sides (inside/outside edge).
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const mag = magnitude[i]
      if (mag < edgeThreshold) continue

      const nx = gx[i] / mag
      const ny = gy[i] / mag

      for (let r = minRadius, bin = 0; r <= maxRadius; r += binSize, bin++) {
        for (const sign of [1, -1]) {
          const cx = x + sign * r * nx
          const cy = y + sign * r * ny
          if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue
          const bx = (cx / binSize) | 0
          const by = (cy / binSize) | 0
          accumulator[(bin * rows + by) * cols + bx] += 1
        }
      }
    }
  }

  let best = -1
  let bestIndex = -1
  for (let i = 0; i < accumulator.length; i++) {
    if (accumulator[i] > best) {
      best = accumulator[i]
      bestIndex = i
    }
  }
  if (bestIndex < 0 || best < 20) return null

  const bin = Math.floor(bestIndex / (cols * rows))
  const rest = bestIndex - bin * cols * rows
  const by = Math.floor(rest / cols)
  const bx = rest - by * cols

  const coarse = {
    center: {
      x: (bx + 0.5) * binSize,
      y: (by + 0.5) * binSize,
    },
    radius: minRadius + bin * binSize,
  }

  // Refine by maximising the mean edge magnitude sampled around the ring.
  // This is far more stable than fitting to inlier pixels: a centre that is
  // a couple of pixels off selects a biased arc, and a biased arc pulls the
  // fit further away.
  const refined = refineCircle(magnitude, width, height, coarse.center, coarse.radius, edgeThreshold)
  const center: Point = refined.center
  const radius = resolveRingScale(magnitude, width, height, refined.center, refined.radius)

  // Confidence: how much of the ideal circumference is covered by edge
  // pixels within the tolerance band. A real board ring scores high; a
  // random texture does not.
  let covered = 0
  const samples = 240
  for (let s = 0; s < samples; s++) {
    const angle = (s / samples) * Math.PI * 2
    const x = Math.round(center.x + radius * Math.cos(angle))
    const y = Math.round(center.y + radius * Math.sin(angle))
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue
    let hit = false
    for (let dy = -1; dy <= 1 && !hit; dy++) {
      for (let dx = -1; dx <= 1 && !hit; dx++) {
        if (magnitude[(y + dy) * width + (x + dx)] >= edgeThreshold) hit = true
      }
    }
    if (hit) covered++
  }

  return { center, radius, confidence: covered / samples }
}

function bilinear(field: Float32Array, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return 0
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const i = y0 * width + x0
  const top = field[i] * (1 - fx) + field[i + 1] * fx
  const bottom = field[i + width] * (1 - fx) + field[i + width + 1] * fx
  return top * (1 - fy) + bottom * fy
}

/** Mean edge magnitude along the circle. */
function ringScore(
  magnitude: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  samples = 180,
): number {
  let sum = 0
  for (let s = 0; s < samples; s++) {
    const angle = (s / samples) * Math.PI * 2
    sum += bilinear(magnitude, width, height, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
  }
  return sum / samples
}

function refineCircle(
  magnitude: Float32Array,
  width: number,
  height: number,
  center: Point,
  radius: number,
  edgeThreshold: number,
): { center: Point; radius: number } {
  let cx = center.x
  let cy = center.y
  let r = radius
  let best = ringScore(magnitude, width, height, cx, cy, r)

  for (let step = 2; step >= 0.25; step /= 2) {
    let improved = true
    while (improved) {
      improved = false
      for (let dr = -1; dr <= 1; dr++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dr === 0) continue
            const ncx = cx + dx * step
            const ncy = cy + dy * step
            const nr = r + dr * step
            if (nr < 4) continue
            const score = ringScore(magnitude, width, height, ncx, ncy, nr)
            if (score > best) {
              best = score
              cx = ncx
              cy = ncy
              r = nr
              improved = true
            }
          }
        }
      }
    }
  }

  // Sub-pixel pass: walk the radial profile at 180 angles, take the peak
  // (parabolic interpolation) and fit a circle to those edge points. This
  // removes the plateau effect of a thick ring, where many slightly
  // different circles score equally well.
  for (let pass = 0; pass < 2; pass++) {
    const edgePoints: Point[] = []
    for (let s = 0; s < 180; s++) {
      const angle = (s / 180) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)

      let peakOffset = 0
      let peakValue = -1
      for (let offset = -6; offset <= 6; offset += 0.5) {
        const value = bilinear(magnitude, width, height, cx + (r + offset) * cos, cy + (r + offset) * sin)
        if (value > peakValue) {
          peakValue = value
          peakOffset = offset
        }
      }
      if (peakValue < edgeThreshold * 0.5) continue

      // Parabola through the peak and its two neighbours.
      const at = (offset: number) =>
        bilinear(magnitude, width, height, cx + (r + offset) * cos, cy + (r + offset) * sin)
      const left = at(peakOffset - 0.5)
      const right = at(peakOffset + 0.5)
      const denominator = left - 2 * peakValue + right
      const shift = denominator === 0 ? 0 : (0.25 * (left - right)) / denominator
      const refinedRadius = r + peakOffset + shift

      edgePoints.push({ x: cx + refinedRadius * cos, y: cy + refinedRadius * sin })
    }

    if (edgePoints.length < 24) break
    const fitted = fitCircle(edgePoints)
    if (!fitted) break
    cx = fitted.center.x
    cy = fitted.center.y
    r = fitted.radius
  }

  r = snapToWirePair(magnitude, width, height, cx, cy, r)
  return { center: { x: cx, y: cy }, radius: r }
}

/**
 * The strongest circle in a dartboard scene is often the board's outer rim
 * (225.5 mm), not the double ring. Using the rim as if it were the double
 * shrinks the scale by ~25% and pushes every dart outwards.
 *
 * Test both readings against the rings that should accompany them and keep
 * the one with more edge support. The returned radius is always the double
 * ring (170 mm) radius.
 */
function resolveRingScale(
  magnitude: Float32Array,
  width: number,
  height: number,
  center: Point,
  radius: number,
): number {
  const RIM_RATIO = 225.5
  const DOUBLE = 170
  const TRIPLE_OUTER = 107

  const asRim = radius / RIM_RATIO
  const rimEvidence =
    ringEdgeScore(magnitude, width, height, center, asRim * DOUBLE) +
    ringEdgeScore(magnitude, width, height, center, asRim * TRIPLE_OUTER)

  // If this circle is the double ring, the triple sits at 107/170 of it.
  const asDouble = radius / DOUBLE
  const doubleEvidence = ringEdgeScore(magnitude, width, height, center, asDouble * TRIPLE_OUTER)

  // Ties and weak evidence fall back to "this is the double ring", which is
  // what the synthetic single-ring tests expect.
  if (rimEvidence > doubleEvidence * 1.25 && rimEvidence > 0) {
    return asRim * DOUBLE
  }
  return radius
}

function ringEdgeScore(
  magnitude: Float32Array,
  width: number,
  height: number,
  center: Point,
  radius: number,
): number {
  if (radius < 6) return 0
  return ringScore(magnitude, width, height, center.x, center.y, radius)
}

/**
 * A painted ring has two edges (inner and outer). Fitting one of them biases
 * the radius by half the band width, which on a dartboard is ~4–8 mm — enough
 * to move a dart across a wire. When both edges of the same ring are visible,
 * use the midpoint of the pair instead, which corresponds to the middle of the
 * ring rather than an arbitrary edge.
 */
function snapToWirePair(
  magnitude: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): number {
  const offsets: number[] = []
  for (let offset = -12; offset <= 12; offset += 0.5) offsets.push(offset)

  const profile = offsets.map((offset) => {
    let sum = 0
    for (let s = 0; s < 180; s++) {
      const angle = (s / 180) * Math.PI * 2
      sum += bilinear(
        magnitude,
        width,
        height,
        cx + (radius + offset) * Math.cos(angle),
        cy + (radius + offset) * Math.sin(angle),
      )
    }
    return sum / 180
  })

  const peak = Math.max(...profile)
  if (peak <= 0) return radius

  const candidates: { offset: number; value: number }[] = []
  for (let i = 1; i < profile.length - 1; i++) {
    if (profile[i] >= profile[i - 1] && profile[i] >= profile[i + 1] && profile[i] >= peak * 0.45) {
      candidates.push({ offset: offsets[i], value: profile[i] })
    }
  }
  candidates.sort((a, b) => b.value - a.value)
  if (candidates.length < 2) return radius

  const [first, second] = candidates
  const separation = Math.abs(first.offset - second.offset)
  if (separation < 2.5 || separation > 20) return radius

  return radius + (first.offset + second.offset) / 2
}

/** Edge magnitude only; the Hough needs the direction too, this does not.
 * Optionally only over `region`, in absolute frame coordinates. */
function magnitudeField(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  region?: { x: number; y: number; width: number; height: number },
): Float32Array {
  const x0 = region ? region.x : 0
  const y0 = region ? region.y : 0
  const w = region ? region.width : width
  const h = region ? region.height : height
  const magnitude = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const ay = y0 + y
    if (ay < 1 || ay >= height - 1) continue
    for (let x = 0; x < w; x++) {
      const ax = x0 + x
      if (ax < 1 || ax >= width - 1) continue
      const i = ay * width + ax
      const dx =
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1] -
        (gray[i - width - 1] + 2 * gray[i - 1] + gray[i + width - 1])
      const dy =
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1] -
        (gray[i - width - 1] + 2 * gray[i - width] + gray[i - width + 1])
      magnitude[y * w + x] = Math.hypot(dx, dy)
    }
  }
  return magnitude
}

/**
 * Radii of the four scoring wires, in mm. Their *ratio pattern* is a
 * fingerprint: a lamp, a wall edge or the board's own surround can look like
 * one circle, but nothing in a room has four concentric rings at 1, 0.95,
 * 0.63 and 0.58 of its radius. That is what tells the 170 mm double ring
 * apart from the 225.5 mm rim and from the black surround behind the board.
 */
const RING_FINGERPRINT_MM = [170, 162, 107, 99]

function fingerprintScore(
  magnitude: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  samples: number,
): number {
  const scale = radius / 170
  let sum = 0
  for (const mm of RING_FINGERPRINT_MM) {
    sum += ringScore(magnitude, width, height, cx, cy, scale * mm, samples)
  }
  return sum / RING_FINGERPRINT_MM.length
}

export interface BoardSeed {
  center: Point
  /** Rough radius of *some* board circle (double ring, rim or surround). */
  radius: number
}

export interface RefineOptions {
  /** Half-width of the centre search, as a fraction of the seed radius. */
  spanFraction?: number
  /** Coarse grid points per axis. */
  centres?: number
  /** Coarse radius samples across the search band. */
  radii?: number
  /** Radius search band, as a multiple of the seed radius. */
  radiusScale?: [number, number]
}

/**
 * Turn a rough guess into the board's real centre and double-ring radius.
 *
 * The Hough pass is good at "there is a circle here" and poor at "which circle
 * is the 170 mm one": on a real phone it locks onto the surround or the rim,
 * which puts every ring 20–45% off. This refines centre and radius together by
 * matching the four-wire fingerprint, which is unambiguous.
 *
 * Runs at the caller's resolution (call it on the full detection frame, not on
 * the small search frame) because 1 mm is about one pixel there.
 */
export function refineBoard(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  seed: BoardSeed,
  options: RefineOptions = {},
): DetectedBoard | null {
  if (!(seed.radius > 4)) return null
  const shorter = Math.min(width, height)

  // The seed may be the double ring, the rim or the surround; search a band
  // that contains all three readings of it. Tracking passes a tight band
  // because the board only moved a little since the last time.
  const [minScale, maxScale] = options.radiusScale ?? [0.5, 1.3]
  const minRadius = Math.max(10, seed.radius * minScale)
  const maxRadius = Math.min(shorter * 0.62, seed.radius * maxScale)
  if (maxRadius <= minRadius) return null

  const spanFraction = options.spanFraction ?? 0.32
  const centres = options.centres ?? 32
  const radii = options.radii ?? 48

  // A fixed budget for the coarse pass: 33 × 33 centres × ~48 radii. The hill
  // climb afterwards covers any distance the coarser grid skipped.
  const span = Math.max(24, seed.radius * spanFraction)
  const step = Math.max(2, (span * 2) / centres)
  const radiusStep = Math.max(1.5, (maxRadius - minRadius) / radii)

  // Only the band around the board can be sampled, so the gradient field is
  // built for that box alone: on a 1080p frame that is ~10× less work than the
  // whole buffer, and the difference between a smooth tap and a visible stall.
  const pad = Math.ceil(span + maxRadius + 8)
  const left = Math.max(0, Math.floor(seed.center.x - pad))
  const top = Math.max(0, Math.floor(seed.center.y - pad))
  const right = Math.min(width, Math.ceil(seed.center.x + pad))
  const bottom = Math.min(height, Math.ceil(seed.center.y + pad))
  const boxWidth = right - left
  const boxHeight = bottom - top
  if (boxWidth < 24 || boxHeight < 24) return null
  const magnitude = magnitudeField(gray, width, height, {
    x: left,
    y: top,
    width: boxWidth,
    height: boxHeight,
  })

  // Everything below works in box coordinates.
  const originX = seed.center.x - left
  const originY = seed.center.y - top
  const fieldWidth = boxWidth
  const fieldHeight = boxHeight
  const fieldShorter = Math.min(boxWidth, boxHeight)

  let cx = originX
  let cy = originY
  let radius = seed.radius
  let best = -1

  for (let y = originY - span; y <= originY + span; y += step) {
    for (let x = originX - span; x <= originX + span; x += step) {
      for (let r = minRadius; r <= maxRadius; r += radiusStep) {
        const score = fingerprintScore(magnitude, fieldWidth, fieldHeight, x, y, r, 24)
        if (score > best) {
          best = score
          cx = x
          cy = y
          radius = r
        }
      }
    }
  }
  if (best <= 0) return null

  // Hill climb on all three parameters, then a finer pass. Best ascent (all
  // ten neighbours each round) rather than first ascent: the fingerprint is
  // noisy enough that stopping at the first improvement strands the search on
  // the wrong side of a doublet.
  for (let par = 2; par >= 0.25; par /= 2) {
    let improved = true
    while (improved) {
      improved = false
      let bestScore = fingerprintScore(magnitude, fieldWidth, fieldHeight, cx, cy, radius, 180)
      let moveX = 0
      let moveY = 0
      let moveR = 0
      for (const [dx, dy, dr] of [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0],
      ]) {
        const nx = cx + dx * par
        const ny = cy + dy * par
        const nr = radius + dr * par
        if (nr < 8 || nr > fieldShorter * 0.7) continue
        if (nx < 0 || ny < 0 || nx >= fieldWidth || ny >= fieldHeight) continue
        const score = fingerprintScore(magnitude, fieldWidth, fieldHeight, nx, ny, nr, 180)
        if (score > bestScore) {
          bestScore = score
          moveX = dx
          moveY = dy
          moveR = dr
          improved = true
        }
      }
      if (improved) {
        cx += moveX * par
        cy += moveY * par
        radius += moveR * par
      }
    }
  }

  // Confidence: how much of the double ring sits on a real edge, relative to
  // the strongest part of that same ring (so lighting does not matter).
  const samples = 360
  const peaks: number[] = []
  for (let s = 0; s < samples; s++) {
    const angle = (s / samples) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let peak = 0
    for (let offset = -1.5; offset <= 1.5; offset += 0.5) {
      const value = bilinear(
        magnitude,
        fieldWidth,
        fieldHeight,
        cx + (radius + offset) * cos,
        cy + (radius + offset) * sin,
      )
      if (value > peak) peak = value
    }
    peaks.push(peak)
  }
  const sorted = [...peaks].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const covered = peaks.filter((value) => value >= median * 0.5).length

  // The wires read as two gradient edges with a flat middle, so the peak can
  // sit on either edge (±1–2 px ≈ 1% of the radius). Average the four ring
  // profiles and use the midpoint of the edge pair, which is the wire.
  radius = wireCentre(magnitude, fieldWidth, fieldHeight, cx, cy, radius)

  return {
    center: { x: cx + left, y: cy + top },
    radius,
    confidence: covered / samples,
  }
}

/**
 * Sub-pixel radius polish. Each painted line has two gradient edges, so the
 * fingerprint maximum is a doublet; averaging it puts the answer between them,
 * on the wire rather than on one of its sides.
 */
function wireCentre(
  magnitude: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): number {
  const offsets: number[] = []
  for (let offset = -4; offset <= 4; offset += 0.25) offsets.push(offset)
  const profile = offsets.map((offset) =>
    fingerprintScore(magnitude, width, height, cx, cy, radius + offset, 240),
  )

  const peak = Math.max(...profile)
  if (!(peak > 0)) return radius

  const maxima: { offset: number; value: number }[] = []
  for (let i = 1; i < profile.length - 1; i++) {
    if (profile[i] >= profile[i - 1] && profile[i] >= profile[i + 1] && profile[i] >= peak * 0.5) {
      maxima.push({ offset: offsets[i], value: profile[i] })
    }
  }
  maxima.sort((a, b) => b.value - a.value)
  if (maxima.length < 2) return radius

  // The two strongest edges of the same wire: close together, one on each side
  // of the current radius. A wire pair gap (8 mm ≈ 6+ px at this scale) is
  // therefore not mistaken for the two sides of one wire.
  const first = maxima[0]
  for (let i = 1; i < maxima.length; i++) {
    const second = maxima[i]
    const separation = Math.abs(second.offset - first.offset)
    if (separation < 0.75 || separation > 5) continue
    if (Math.sign(second.offset - first.offset) === Math.sign(first.offset)) continue
    return radius + (first.offset + second.offset) / 2
  }

  // Single resolved edge: use the parabola vertex instead of the grid point.
  const index = offsets.indexOf(first.offset)
  const left = profile[index - 1]
  const centre = profile[index]
  const right = profile[index + 1]
  const denominator = left - 2 * centre + right
  const shift = denominator === 0 ? 0 : (0.25 * (left - right)) / denominator
  return radius + first.offset + shift
}

/** Algebraic circle fit (Kasa): minimises sum (x^2+y^2+Dx+Ey+F)^2. */
function fitCircle(points: readonly Point[]): { center: Point; radius: number } | null {
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  let sxz = 0
  let syz = 0
  let sz = 0

  for (const { x, y } of points) {
    const z = x * x + y * y
    n += 1
    sx += x
    sy += y
    sxx += x * x
    syy += y * y
    sxy += x * y
    sxz += x * z
    syz += y * z
    sz += z
  }

  const m = [
    [sxx, sxy, sx, -sxz],
    [sxy, syy, sy, -syz],
    [sx, sy, n, -sz],
  ]

  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null
    const swap = m[col]
    m[col] = m[pivot]
    m[pivot] = swap

    const divisor = m[col][col]
    for (let k = col; k < 4; k++) m[col][k] /= divisor

    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const factor = m[row][col]
      if (factor === 0) continue
      for (let k = col; k < 4; k++) m[row][k] -= factor * m[col][k]
    }
  }

  const d = m[0][3]
  const e = m[1][3]
  const f = m[2][3]
  const center = { x: -d / 2, y: -e / 2 }
  const squared = center.x * center.x + center.y * center.y - f
  if (squared <= 0) return null

  return { center, radius: Math.sqrt(squared) }
}
