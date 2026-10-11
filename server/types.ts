// What the live API sends to browsers. Shared by the Worker and the client,
// so it imports nothing.

export type Mode = 'train' | 'metro' | 'lightrail' | 'ferry' | 'bus'

// [id, mode, route, label, bearing, points]; points are flat [lon, lat, t, ...], t in epoch seconds
export type WireTrack = [string, Mode, string, string, number | null, number[]]

export type Punctuality = { mode: Mode; running: number; onTime: number; avgDelay: number; cancelled: number }

export type Alert = {
  id: string
  mode: Mode
  effect: string
  title: string
  detail: string
  url: string | null
  start: number | null
  end: number | null
}

export type Station = {
  id: string
  name: string
  lon: number
  lat: number
  time: string
  temp: number | null
  feels: number | null
  humidity: number | null
  wind: number | null
  gust: number | null
  windDir: string | null
  windDeg: number | null
  rain: number | null // mm since 9am
  max: number | null
  min: number | null
  pressure: number | null
}

export type Day = {
  date: string
  icon: number | null
  min: number | null
  max: number | null
  summary: string
  rainChance: number | null
  rainRange: string | null
}

export type Forecast = { issued: string; days: Day[] }

export type Warning = {
  id: string
  headline: string
  areas: string[]
  sydney: boolean
  issued: string
  expires: string
  url: string
}

// Frame urls are paths on the live API (/api/radar/...).
export type Radar = { bounds: [number, number][]; frames: { time: string; url: string }[] }

export type Health = { name: string; ok: boolean; at: number; error?: string }
