import { Event, type HTMLInputElement } from 'happy-dom'

// What the EM does to a field in happy-dom, firing the events the browser fires, for the tests of either build's page.

/** Sets `field` to `text`, firing its input, as the browser does on each key. */
export function typed(field: HTMLInputElement, text: string): void {
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Fires `field`'s change, as the browser does on Enter or on leaving it; whether the page let it through. */
export const changed = (field: HTMLInputElement): boolean => field.dispatchEvent(new Event('change', { bubbles: true }))

/** Types `value` into `field`, and fires its change. */
export function change(field: HTMLInputElement, value: string): void {
  field.value = value
  changed(field)
}
