// Forecast glyphs for BoM's forecast_icon_code, drawn as 24px strokes that
// inherit the text colour.
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

const cloud = 'M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 11 3.5 3.5 0 0 0 7 18z'
const smallSun = '<circle cx="8" cy="8" r="2.6"/><path d="M8 2.5v1.2M2.5 8h1.2M4.1 4.1l.9.9M11.9 4.1l-.9.9"/>'

const GLYPHS = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  moon: svg('<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>'),
  partly: svg(`${smallSun}<path d="M9 19h8a3.4 3.4 0 0 0 .3-6.8A4.7 4.7 0 0 0 8.4 13.4 2.8 2.8 0 0 0 9 19z"/>`),
  cloud: svg(`<path d="${cloud}"/>`),
  showers: svg(`<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 8 3.5 3.5 0 0 0 7 15z"/><path d="M9 18l-.8 2M13 18l-.8 2"/>`),
  rain: svg(`<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 8 3.5 3.5 0 0 0 7 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>`),
  storm: svg(`<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 8 3.5 3.5 0 0 0 7 15z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>`),
  fog: svg('<path d="M4 9h16M6 13h12M4 17h16"/>'),
  wind: svg('<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7"/>'),
  snow: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>'),
}

const BY_CODE: Record<number, keyof typeof GLYPHS> = {
  1: 'sun', 2: 'moon', 3: 'partly', 4: 'cloud', 6: 'fog', 8: 'showers', 9: 'wind', 10: 'fog',
  11: 'showers', 12: 'rain', 13: 'wind', 14: 'snow', 15: 'snow', 16: 'storm', 17: 'showers', 18: 'rain', 19: 'storm',
}

export const forecastIcon = (code: number | null): string => GLYPHS[BY_CODE[code ?? 0] ?? 'cloud']
