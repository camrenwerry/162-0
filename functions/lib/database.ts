import { getOptionalDatabase, type BackendEnv } from './env'

export const EXPECTED_SCHEMA_VERSION = 1

export interface DatabaseHealth {
  configured: boolean
  reachable: boolean
  schemaVersion: number | null
}

const notConfigured = Object.freeze<DatabaseHealth>({
  configured: false,
  reachable: false,
  schemaVersion: null,
})

export async function readDatabaseHealth(env: BackendEnv): Promise<DatabaseHealth> {
  const database = getOptionalDatabase(env)
  if (!database) return notConfigured

  try {
    const connectivity = await database
      .prepare('SELECT 1 AS value')
      .first<{ value: number }>()
    if (connectivity?.value !== 1) {
      return { configured: true, reachable: false, schemaVersion: null }
    }
  } catch {
    return { configured: true, reachable: false, schemaVersion: null }
  }

  try {
    const schema = await database
      .prepare('SELECT version FROM backend_schema WHERE id = 1')
      .first<{ version: number }>()
    const version = schema?.version
    const schemaVersion = typeof version === 'number' && Number.isInteger(version)
      ? version
      : null
    return { configured: true, reachable: true, schemaVersion }
  } catch {
    return { configured: true, reachable: true, schemaVersion: null }
  }
}
