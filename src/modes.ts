import type { Mode } from '../server/types.ts'

type ModeStyle = {
  name: string
  letter: string
  rgb: [number, number, number]
  radius: number // metres
  width: number // trail width, px
}

// Transport for NSW wayfinding colours, in the order the panel lists them.
export const MODES: Record<Mode, ModeStyle> = {
  train: { name: 'Trains', letter: 'T', rgb: [246, 137, 31], radius: 60, width: 2.6 },
  metro: { name: 'Metro', letter: 'M', rgb: [22, 131, 136], radius: 60, width: 2.6 },
  lightrail: { name: 'Light rail', letter: 'L', rgb: [238, 52, 63], radius: 45, width: 2.2 },
  ferry: { name: 'Ferries', letter: 'F', rgb: [90, 176, 49], radius: 60, width: 2.6 },
  bus: { name: 'Buses', letter: 'B', rgb: [0, 181, 239], radius: 26, width: 1.4 },
}

export const MODE_ORDER = Object.keys(MODES) as Mode[]

export const hex = ([r, g, b]: [number, number, number]): string =>
  '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
