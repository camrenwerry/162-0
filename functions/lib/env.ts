export type BackendEnv = Partial<Env>

export function getOptionalDatabase(env: BackendEnv): D1Database | null {
  const database = env.DB
  return database && typeof database.prepare === 'function' ? database : null
}
