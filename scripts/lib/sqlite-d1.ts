import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

function sqlBinding(value: unknown): SQLInputValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'bigint'
    || ArrayBuffer.isView(value)
  ) return value
  throw new Error('Unsupported local D1 binding.')
}

export class SqliteD1Statement {
  private bindings: SQLInputValue[] = []

  constructor(
    private readonly database: SqliteD1Database,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values.map(sqlBinding)
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.database.sqlite.prepare(this.query).get(...this.bindings)
    return (row ?? null) as T | null
  }

  async all<T = Record<string, unknown>>() {
    const results = this.database.sqlite.prepare(this.query).all(...this.bindings) as T[]
    return { success: true, results, meta: { changes: 0 } }
  }

  async run() {
    const result = this.database.sqlite.prepare(this.query).run(...this.bindings)
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    }
  }

  isRead() {
    const operation = this.query.trimStart().slice(0, 6).toUpperCase()
    return operation === 'SELECT' || operation.startsWith('WITH')
  }
}

export class SqliteD1Database {
  private pendingBatch: Promise<unknown> = Promise.resolve()

  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string) {
    return new SqliteD1Statement(this, query)
  }

  async batch(statements: SqliteD1Statement[]) {
    const execute = async () => {
      this.sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const statement of statements) {
          results.push(statement.isRead() ? await statement.all() : await statement.run())
        }
        this.sqlite.exec('COMMIT')
        return results
      } catch (error) {
        this.sqlite.exec('ROLLBACK')
        throw error
      }
    }
    const result = this.pendingBatch.then(execute, execute)
    this.pendingBatch = result.then(() => undefined, () => undefined)
    return result
  }
}
