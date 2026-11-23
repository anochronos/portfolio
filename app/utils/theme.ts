// Day or night. Night is the default; holding down the moon (or the sun, by
// day) switches it, and so does the "Switch to daytime" button that appears
// when you tab to it. The choice is remembered. A one-line script in the
// page head (nuxt.config.ts) puts the remembered choice back before the
// first paint.
import { dawn } from './sound'

const KEY = 'sea-theme'

export function isDay(): boolean {
  return document.documentElement.dataset.theme === 'day'
}

export function setDay(day: boolean) {
  const root = document.documentElement
  root.dataset.theme = day ? 'day' : 'night'
  try {
    localStorage.setItem(KEY, day ? 'day' : 'night')
  } catch {
    // Private browsing: it just won't be remembered
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', day ? '#4aa0de' : '#040a15')
  window.dispatchEvent(new CustomEvent('sea:theme', { detail: day }))
  dawn(day)
}

export function toggleDay() {
  setDay(!isDay())
}

// How long the moon or sun has to be held down
export const HOLD_MS = 900
