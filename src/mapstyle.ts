// A sandstone architectural-model basemap over OpenFreeMap's OpenMapTiles
// vector tiles. Owning the whole style keeps us independent of upstream
// layer names.
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

const C = {
  ground: '#efe8db',
  residential: '#eae2d3',
  green: '#dde2cf',
  water: '#90abba',
  waterLabel: '#4f6878',
  roadMinor: '#f7f2e8',
  roadMajor: '#fcf9f2',
  roadCasing: '#ddd2bf',
  rail: '#b9aa92',
  buildingLow: '#e7dcc6',
  buildingHigh: '#d6c09c',
  label: '#5f5443',
  halo: '#f4eee3',
}

const name: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name']]
// Not every building carries a height; treat unknowns as a low two-storey block.
const height: ExpressionSpecification = ['coalesce', ['get', 'render_height'], 6]

export const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  // Southern hemisphere: the sun sits to the north.
  light: { anchor: 'map', position: [1.3, 10, 45], color: '#fff6e8', intensity: 0.35 },
  sky: {
    'sky-color': '#dfe6ea',
    'horizon-color': '#efe8db',
    'fog-color': '#efe8db',
    'fog-ground-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'sky-horizon-blend': 0.6,
    'atmosphere-blend': 0,
  },
  layers: [
    { id: 'ground', type: 'background', paint: { 'background-color': C.ground } },
    {
      id: 'residential',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'class'], 'residential'],
      paint: { 'fill-color': C.residential },
    },
    {
      id: 'green',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landcover',
      filter: ['match', ['get', 'class'], ['wood', 'grass', 'farmland', 'wetland'], true, false],
      paint: { 'fill-color': C.green, 'fill-opacity': 0.8 },
    },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.green } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
    {
      id: 'road-casing',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': C.roadCasing,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.5, 18, 26],
      },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['match', ['get', 'class'], ['tertiary', 'minor', 'service'], true, false],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': C.roadMinor,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13, 0.8, 18, 14],
      },
    },
    {
      id: 'road-major',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      minzoom: 8,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': C.roadMajor,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.6, 18, 22],
      },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['all', ['match', ['get', 'class'], ['rail', 'transit'], true, false], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: {
        'line-color': C.rail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 16, 2.2],
      },
    },
    {
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'omt',
      'source-layer': 'building',
      minzoom: 12.5,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], height, 0, C.buildingLow, 120, C.buildingHigh],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, height],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: 'water-label',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'water_name',
      layout: {
        'text-field': name,
        'text-font': ['Noto Sans Italic'],
        'text-size': 12,
        'text-letter-spacing': 0.15,
        'text-max-width': 6,
      },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': C.water, 'text-halo-width': 0.6 },
    },
    {
      id: 'place-label',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      filter: ['match', ['get', 'class'], ['suburb', 'quarter', 'neighbourhood', 'town', 'city'], true, false],
      layout: {
        'text-field': name,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-max-width': 8,
      },
      paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
    },
  ],
}
