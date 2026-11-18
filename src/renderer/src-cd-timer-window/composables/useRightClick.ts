import { tryOnScopeDispose, useEventListener } from '@vueuse/core'

/** A triple click wins over a double click anywhere in this overlay. */
export function useRightClick(
  onDoubleClick: (target: HTMLElement) => void,
  onTripleClick: () => void,
  delay = 400
) {
  let count = 0
  let firstTarget: HTMLElement | null = null
  let sameTarget = true
  let timeout: ReturnType<typeof setTimeout> | null = null

  const reset = () => {
    if (timeout !== null) clearTimeout(timeout)
    timeout = null
    count = 0
    firstTarget = null
    sameTarget = true
  }

  useEventListener(window, 'contextmenu', (event) => event.preventDefault())
  useEventListener(
    window,
    'pointerup',
    (event) => {
      if (event.button !== 2) return
      event.preventDefault()
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-timer-slot]')
          : null
      if (count === 0) firstTarget = target
      else if (target !== firstTarget) sameTarget = false
      count++
      if (timeout !== null) clearTimeout(timeout)
      if (count === 3) {
        reset()
        onTripleClick()
        return
      }
      timeout = setTimeout(() => {
        const doubleTarget = count === 2 && sameTarget ? firstTarget : null
        reset()
        if (doubleTarget?.isConnected) onDoubleClick(doubleTarget)
      }, delay)
    },
    { capture: true }
  )
  // A different mouse action interrupts a pending right-click gesture.
  useEventListener(
    window,
    'pointerdown',
    (event) => {
      if (event.button !== 2) reset()
    },
    { capture: true }
  )
  useEventListener(window, 'blur', reset)
  tryOnScopeDispose(reset)
  return reset
}
