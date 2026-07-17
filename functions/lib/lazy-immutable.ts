/**
 * Cache immutable, isolate-local state only after it is needed. A failed
 * factory is cached as unavailable so hostile requests cannot retry expensive
 * initialization work.
 */
export function createLazyImmutable<T>(factory: () => T): () => T | null {
  let value: T | null | undefined
  return () => {
    if (value !== undefined) return value
    try {
      value = factory()
    } catch {
      value = null
    }
    return value
  }
}
