import { useEffect } from 'react'

export function toggleFullscreen() {
  const result = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()
  void result?.catch(() => undefined)
}

export function usePresentationShortcut(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    function keydown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'f' || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]'))) return
      event.preventDefault()
      toggleFullscreen()
    }
    window.addEventListener('keydown',keydown)
    return () => window.removeEventListener('keydown',keydown)
  },[enabled])
}
