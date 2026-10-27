import { describe, expect, it } from "vitest"
import {
  changedRatio,
  connectedComponents,
  differenceMask,
  toGrayscale,
} from "./dartDetection"

describe("toGrayscale", () => {
  it("weights channels like Rec. 601", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    const gray = toGrayscale(rgba, 2, 1)
    expect(gray[0]).toBe(255)
    expect(gray[1]).toBe(0)
  })
})

describe("differenceMask", () => {
  it("marks only pixels above the threshold", () => {
    const a = new Uint8ClampedArray([0, 100, 200, 255])
    const b = new Uint8ClampedArray([10, 100, 240, 250])
    const mask = differenceMask(a, b, 30)
    expect(Array.from(mask)).toEqual([0, 0, 1, 0])
  })

  it("computes the changed ratio", () => {
    const mask = new Uint8Array([1, 0, 0, 1])
    expect(changedRatio(mask)).toBe(0.5)
  })
})

describe("connectedComponents", () => {
  it("finds separate blobs and ignores specks", () => {
    const width = 40
    const height = 40
    const mask = new Uint8Array(width * height)

    // A 10x3 "dart" and a 2x2 speck that must be filtered out.
    for (let y = 5; y < 8; y++) {
      for (let x = 5; x < 15; x++) mask[y * width + x] = 1
    }
    for (let y = 20; y < 22; y++) {
      for (let x = 20; x < 22; x++) mask[y * width + x] = 1
    }

    const blobs = connectedComponents(mask, width, height, { minArea: 10 })
    expect(blobs).toHaveLength(1)

    const blob = blobs[0]
    expect(blob.area).toBe(30)
    expect(blob.cx).toBeCloseTo(9.5, 6)
    expect(blob.cy).toBeCloseTo(6, 6)
    expect(blob.minX).toBe(5)
    expect(blob.maxX).toBe(14)
  })

  it("puts the endpoints on the major axis of an elongated shape", () => {
    const width = 60
    const height = 60
    const mask = new Uint8Array(width * height)

    // Thin horizontal bar: the major axis is horizontal.
    for (let y = 28; y < 31; y++) {
      for (let x = 10; x < 40; x++) mask[y * width + x] = 1
    }

    const [blob] = connectedComponents(mask, width, height, { minArea: 10 })
    const [a, b] = blob.endpoints

    const left = a.x < b.x ? a : b
    const right = a.x < b.x ? b : a
    expect(left.x).toBe(10)
    expect(right.x).toBe(39)
    expect(blob.length).toBeCloseTo(29, 6)
    expect(Math.abs(blob.orientation)).toBeLessThan(0.2)
  })

  it("drops components larger than maxArea (a hand crossing the frame)", () => {
    const width = 40
    const height = 40
    const mask = new Uint8Array(width * height).fill(1)

    expect(connectedComponents(mask, width, height, { maxArea: 100 })).toHaveLength(0)
    expect(connectedComponents(mask, width, height, { maxArea: 5000 })).toHaveLength(1)
  })

  it("enforces the minimum length", () => {
    const width = 20
    const height = 20
    const mask = new Uint8Array(width * height)
    for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) mask[y * width + x] = 1

    expect(connectedComponents(mask, width, height, { minArea: 1, minLength: 10 })).toHaveLength(0)
  })
})
