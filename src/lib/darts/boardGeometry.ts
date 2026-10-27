/** Geometry of a standard steel-tip dartboard, in millimetres.
 *
 * Board space: origin at the centre of the double bull, +x to the right,
 * +y up. One unit = 1 mm on the board surface. The 20 segment is at 90°.
 *
 * Dimensions follow the standard (WDF) board: overall diameter 451 mm,
 * scoring area 340 mm, triple ring 99–107 mm, double ring 162–170 mm.
 */

export interface Point {
  x: number
  y: number
}

export const BOARD = {
  innerBull: 6.35,
  outerBull: 15.9,
  tripleInner: 99,
  tripleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
  /** Physical board radius, including the non-scoring outer rim. */
  boardRadius: 225.5,
} as const

/** Segment order clockwise starting at the top (20 at 90°). */
export const SEGMENTS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const

export const SEGMENT_COUNT = SEGMENTS.length
export const SEGMENT_DEGREES = 360 / SEGMENT_COUNT

export type Ring =
  | "inner-bull"
  | "outer-bull"
  | "single-inner"
  | "triple"
  | "single-outer"
  | "double"
  | "miss"

export interface BoardScore {
  /** Points scored by a dart at this position. */
  score: number
  /** Segment number, or null for the bull and misses. */
  segment: number | null
  ring: Ring
  /** Short label: 60, 25, 50, S20, T20, D20, MISS. */
  label: string
}

/** Centre angle of a segment, in degrees, in board space. */
export function segmentCentreAngle(segment: number): number {
  const index = SEGMENTS.indexOf(segment as (typeof SEGMENTS)[number])
  if (index < 0) throw new Error(`Unknown segment: ${segment}`)
  return ((90 - index * SEGMENT_DEGREES) % 360 + 360) % 360
}

/** Board point for a segment at a given radius (mm). Handy for tests and for
 * drawing a synthetic board. */
export function pointOnBoard(segment: number, radius: number): Point {
  const radians = (segmentCentreAngle(segment) * Math.PI) / 180
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }
}

/** Segment under a board point (bull offsets are irrelevant here). */
export function segmentAtPoint(point: Point): number {
  const degrees = (Math.atan2(point.y, point.x) * 180) / Math.PI
  // +half a segment so the bin is centred on the segment's centre angle.
  const shifted = (90 - degrees + 360 + SEGMENT_DEGREES / 2) % 360
  const index = Math.floor(shifted / SEGMENT_DEGREES) % SEGMENT_COUNT
  return SEGMENTS[index]
}

export function scoreAtPoint(point: Point): BoardScore {
  const radius = Math.hypot(point.x, point.y)

  if (radius <= BOARD.innerBull) {
    return { score: 50, segment: null, ring: "inner-bull", label: "50" }
  }
  if (radius <= BOARD.outerBull) {
    return { score: 25, segment: null, ring: "outer-bull", label: "25" }
  }
  if (radius > BOARD.doubleOuter) {
    return { score: 0, segment: null, ring: "miss", label: "MISS" }
  }

  const segment = segmentAtPoint(point)

  if (radius >= BOARD.doubleInner) {
    return { score: segment * 2, segment, ring: "double", label: `D${segment}` }
  }
  if (radius >= BOARD.tripleOuter) {
    return { score: segment, segment, ring: "single-outer", label: `S${segment}` }
  }
  if (radius >= BOARD.tripleInner) {
    return { score: segment * 3, segment, ring: "triple", label: `T${segment}` }
  }
  return { score: segment, segment, ring: "single-inner", label: `S${segment}` }
}

/** Closed polygon approximating a circle of `radius` mm around the centre. */
export function ringPolygon(radius: number, steps = 96): Point[] {
  const points: Point[] = []
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
  }
  return points
}

/** The 20 radial wires, from the outer bull to the outer double ring. */
export function segmentSpokes(): [Point, Point][] {
  const spokes: [Point, Point][] = []
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const boundary = 90 + SEGMENT_DEGREES / 2 - i * SEGMENT_DEGREES
    const radians = (boundary * Math.PI) / 180
    spokes.push([
      {
        x: BOARD.outerBull * Math.cos(radians),
        y: BOARD.outerBull * Math.sin(radians),
      },
      {
        x: BOARD.doubleOuter * Math.cos(radians),
        y: BOARD.doubleOuter * Math.sin(radians),
      },
    ])
  }
  return spokes
}

/** Where a segment number should be printed, in board space. */
export function segmentLabelPoint(segment: number): Point {
  return pointOnBoard(segment, 192)
}
