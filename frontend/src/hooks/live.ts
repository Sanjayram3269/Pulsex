import { useEffect, useState } from 'react'
import { base } from '../services/api'

type Connection = 'connecting' | 'live' | 'reconnecting' | 'unavailable'
export function useStream<T extends { version: number }>(path: string, enabled = true) {
  const [current, setCurrent] = useState<{ path: string; value: T }>()
  const [connection, setConnection] = useState<{ path: string; state: Connection }>()
  useEffect(() => {
    if (!enabled) return
    let stream: EventSource | undefined
    let timer: number | undefined
    let delay = 1000
    let terminal = false
    function connect() {
      if (terminal || !navigator.onLine) return
      const source = new EventSource(base + path)
      stream = source
      source.onmessage = (event: MessageEvent<string>) => {
        const next = JSON.parse(event.data) as T
        delay = 1000
        setConnection({ path, state: 'live' })
        setCurrent(prev => prev?.path === path && prev.value.version > next.version ? prev : { path, value: next })
      }
      source.onerror = () => {
        source.close()
        setConnection({ path, state: 'reconnecting' })
        timer = window.setTimeout(connect, delay + Math.random() * 300)
        delay = Math.min(delay * 2, 15000)
      }
      source.addEventListener('unavailable', () => {
        terminal = true
        source.close()
        setCurrent(undefined)
        setConnection({ path, state: 'unavailable' })
      })
    }
    function offline() {
      stream?.close()
      window.clearTimeout(timer)
      if (!terminal) setConnection({ path, state: 'reconnecting' })
    }
    function online() {
      stream?.close()
      window.clearTimeout(timer)
      connect()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    connect()
    return () => {
      terminal = true
      offline()
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [path, enabled])
  return { value: current?.path === path ? current.value : undefined, state: connection?.path === path ? connection.state : 'connecting' as const }
}
