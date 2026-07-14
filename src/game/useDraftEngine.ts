import { useEffect, useSyncExternalStore } from 'react'
import type { DraftEngine } from './DraftEngine'

export function useDraftEngine(engine: DraftEngine) {
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
  useEffect(() => {
    engine.start()
    return () => engine.dispose()
  }, [engine])
  return snapshot
}
