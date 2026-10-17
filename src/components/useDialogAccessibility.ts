import { useEffect, useRef } from 'react'

export function useDialogAccessibility(open: boolean, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    if (!dialog) return
    const background = [...document.querySelectorAll<HTMLElement>('.sidebar, .main-area, .mobile-nav')]
    background.forEach(element => { element.inert = true })
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, summary, a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0)
    if (!dialog.contains(document.activeElement)) focusables()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key !== 'Tab') return
      const elements = focusables()
      const first = elements[0]; const last = elements.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      background.forEach(element => { element.inert = false })
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open])
}
