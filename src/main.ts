import './style.css'
import { connect } from './live.ts'
import * as panels from './panels.ts'
import * as scene from './scene.ts'
import { ingest } from './vehicles.ts'

connect(
  {
    vehicles: rows => {
      ingest(rows)
      panels.setVehicles()
    },
    punctuality: panels.setPunctuality,
    alerts: panels.setAlerts,
    observations: s => {
      scene.setStations(s)
      panels.setObservations(s)
    },
    forecast: panels.setForecast,
    warnings: panels.setWarnings,
    radar: r => void scene.setRadar(r),
    feeds: panels.setFeeds,
  },
  panels.setConnected,
)

panels.handleFocus(scene.setFocus)
setInterval(() => panels.setRadarTime(scene.stepRadar()), 650)

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  b.addEventListener('click', () => scene.fly(b.dataset.view as scene.View))
}

function toggle(id: string, apply: (on: boolean) => void): void {
  const b = document.getElementById(id)!
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true'
    b.setAttribute('aria-pressed', String(on))
    apply(on)
  })
}
toggle('radar-toggle', scene.setRadarVisible)
toggle('stations-toggle', scene.setStationsVisible)

// Phone layout shows one rail at a time.
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  b.addEventListener('click', () => {
    document.body.dataset.tab = b.dataset.tab
    for (const other of document.querySelectorAll('[data-tab]')) other.setAttribute('aria-selected', String(other === b))
  })
}
