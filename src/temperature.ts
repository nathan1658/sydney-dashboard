// One temperature ramp for the map columns and the forecast bars.
type RGB = [number, number, number]

const STOPS: [number, RGB][] = [
  [4, [74, 116, 178]],
  [13, [84, 156, 166]],
  [20, [222, 190, 88]],
  [27, [228, 128, 52]],
  [36, [190, 54, 42]],
]

export function tempRgb(t: number): RGB {
  if (t <= STOPS[0][0]) return STOPS[0][1]
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i]
    if (t > t1) continue
    const [t0, c0] = STOPS[i - 1]
    const k = (t - t0) / (t1 - t0)
    return c0.map((c, j) => Math.round(c + (c1[j] - c) * k)) as RGB
  }
  return STOPS[STOPS.length - 1][1]
}

export const tempCss = (t: number): string => `rgb(${tempRgb(t).join(' ')})`

// Gradient for a bar spanning lo..hi degrees.
export function tempGradient(lo: number, hi: number): string {
  const steps = 5
  const stops = Array.from({ length: steps }, (_, i) => tempCss(lo + ((hi - lo) * i) / (steps - 1)))
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
