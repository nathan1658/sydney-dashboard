// Bureau of Meteorology: observations, forecast, warnings and rain radar.
import { XMLParser } from 'fast-xml-parser'
import { bomFtp, download, list } from './ftp.ts'

const FWO = '/anon/gen/fwo/'
const RADAR_DIR = '/anon/gen/radar/'
const SYDNEY_DISTRICT = 'NSW_PW005' // forecast district "Sydney Metropolitan"
const SYDNEY_LOCATION = 'NSW_PT131' // precis forecast location "Sydney"

const ARRAYS = new Set(['station', 'element', 'text', 'area', 'forecast-period', 'hazard'])
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'value',
  isArray: (name, _path, _leaf, isAttribute) => !isAttribute && ARRAYS.has(name),
})

// Parsed XML is untyped at the boundary; everything past this file is typed.
type Node = Record<string, any>

const parse = (buf: Buffer): Node => xml.parse(buf.toString('utf8'))
const fetchXml = (file: string): Promise<Node> => bomFtp(async c => parse(await download(c, FWO + file)))
const num = (v: unknown): number | null => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v))

// BoM's <element type="..."> lists become plain lookups.
function values(nodes: Node[] = []): Record<string, unknown> {
  return Object.fromEntries(nodes.map(n => [n.type, n.value]))
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

export async function observations(): Promise<Station[]> {
  const doc = await fetchXml('IDN60920.xml')
  return (doc.product.observations.station as Node[])
    .filter(s => s['forecast-district-id'] === SYDNEY_DISTRICT)
    .map(s => {
      const period = Array.isArray(s.period) ? s.period[0] : s.period
      const v = values(period.level?.element)
      return {
        id: String(s['wmo-id']),
        name: s.description,
        lon: Number(s.lon),
        lat: Number(s.lat),
        time: period['time-utc'],
        temp: num(v.air_temperature),
        feels: num(v.apparent_temp),
        humidity: num(v['rel-humidity']),
        wind: num(v.wind_spd_kmh),
        gust: num(v.gust_kmh),
        windDir: (v.wind_dir as string) ?? null,
        windDeg: num(v.wind_dir_deg),
        rain: num(v.rainfall),
        max: num(v.maximum_air_temperature),
        min: num(v.minimum_air_temperature),
        pressure: num(v.msl_pres),
      }
    })
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

export async function forecast(): Promise<{ issued: string; days: Day[] }> {
  const doc = await fetchXml('IDN11060.xml')
  const area = (doc.product.forecast.area as Node[]).find(a => a.aac === SYDNEY_LOCATION)
  if (!area) throw new Error(`forecast location ${SYDNEY_LOCATION} missing from IDN11060`)
  const days = (area['forecast-period'] as Node[]).map(p => {
    const v = values([...(p.element ?? []), ...(p.text ?? [])])
    return {
      date: p['start-time-local'],
      icon: num(v.forecast_icon_code),
      min: num(v.air_temperature_minimum),
      max: num(v.air_temperature_maximum),
      summary: String(v.precis ?? ''),
      rainChance: num(String(v.probability_of_precipitation ?? '').replace('%', '')),
      rainRange: (v.precipitation_range as string) ?? null,
    }
  })
  return { issued: doc.product.amoc['issue-time-utc'], days }
}

export type Warning = {
  id: string
  headline: string
  areas: string[]
  sydney: boolean
  issued: string
  expires: string
  url: string
}

// Current NSW warnings are the IDN2xxxx/IDN3xxxx products present on FTP.
export async function warnings(): Promise<Warning[]> {
  const docs = await bomFtp(async c => {
    const files = [...(await list(c, FWO + 'IDN2*.amoc.xml')), ...(await list(c, FWO + 'IDN3*.amoc.xml'))]
    const out: Node[] = []
    for (const f of files) out.push(parse(await download(c, FWO + f)).amoc)
    return out
  })
  return docs
    .filter(a => a['product-type'] === 'W' && Date.parse(a['expiry-time']) > Date.now())
    .map(a => {
      const hazards = (a.hazard ?? []) as Node[]
      const areas = [...new Set(hazards.flatMap(h => (h['area-list']?.area ?? []).map((x: Node) => x.description as string)))]
      const headline = hazards.map(h => h.headline).find(Boolean) ?? a.identifier
      return {
        id: a.identifier,
        headline: String(headline).replace(/\s+/g, ' ').trim(),
        areas,
        sydney: hazards.some(h => (h['area-list']?.area ?? []).some((x: Node) => /sydney/i.test(x.description) || x.aac === SYDNEY_DISTRICT)),
        issued: a['issue-time-utc'],
        expires: a['expiry-time'],
        url: `https://www.bom.gov.au/products/${a.identifier}.shtml`,
      }
    })
    .sort((x, y) => Number(y.sydney) - Number(x.sydney) || y.issued.localeCompare(x.issued))
}

// Sydney (Terrey Hills) radar, 128 km range: 512 px images at 500 m per pixel.
const RADAR = { id: 'IDR713', lon: 151.21, lat: -33.701, halfKm: 128 }
const RADAR_FRAMES = 8
const frames = new Map<string, Buffer>()

export const radarImage = (name: string): Buffer | undefined => frames.get(name)

export type Radar = { bounds: [number, number][]; frames: { time: string; url: string }[] }

export async function radar(): Promise<Radar> {
  const names = await bomFtp(async c => {
    const latest = (await list(c, `${RADAR_DIR}${RADAR.id}.T.*.png`)).slice(-RADAR_FRAMES)
    for (const n of latest) if (!frames.has(n)) frames.set(n, await download(c, RADAR_DIR + n))
    return latest
  })
  if (!names.length) throw new Error(`no ${RADAR.id} frames on BoM FTP`)
  for (const n of frames.keys()) if (!names.includes(n)) frames.delete(n)

  const dLat = RADAR.halfKm / 110.574
  const dLon = RADAR.halfKm / (111.32 * Math.cos((RADAR.lat * Math.PI) / 180))
  const { lon, lat } = RADAR
  return {
    // top-left, top-right, bottom-right, bottom-left
    bounds: [[lon - dLon, lat + dLat], [lon + dLon, lat + dLat], [lon + dLon, lat - dLat], [lon - dLon, lat - dLat]],
    frames: names.map(n => {
      const t = n.split('.')[2] // IDR713.T.YYYYMMDDHHmm.png, UTC
      return {
        time: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00Z`,
        url: `/api/radar/${n}`,
      }
    }),
  }
}
