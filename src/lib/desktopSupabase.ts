type Api = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number; fields: Array<{ name: string; dataType: string }> }>
}

function getApi(): Api | null {
  return (window as any).api?.db ?? null
}

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is'

class DesktopPostgrestBuilder {
  private table: string
  private selectCols = '*'
  private filters: { op: FilterOp; col: string; val: any }[] = []
  private orderBy: string | null = null
  private orderAsc = true
  private limitVal: number | null = null
  private offsetVal: number | null = null
  private method: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private insertData: Record<string, any> | Record<string, any>[] | null = null
  private updateData: Record<string, any> | null = null
  private joinTables: string[] = []

  constructor(table: string) { this.table = table }

  select(columns: string): this {
    this.parseSelect(columns)
    return this
  }

  private parseSelect(columns: string) {
    const parts = columns.split(',').map(s => s.trim())
    this.joinTables = []
    const mainParts: string[] = []
    for (const p of parts) {
      const m = p.match(/^(\w+)\(\*\)$/)
      if (m) {
        this.joinTables.push(m[1])
      } else {
        mainParts.push(p)
      }
    }
    this.selectCols = mainParts.join(', ') || '*'
  }

  private sanitize(col: string): string {
    return `"${col.replace(/[^a-zA-Z0-9_]/g, '')}"`
  }

  private addFilter(op: FilterOp, col: string, val: any): this {
    this.filters.push({ op, col, val })
    return this
  }

  eq(col: string, val: any) { return this.addFilter('eq', col, val) }
  neq(col: string, val: any) { return this.addFilter('neq', col, val) }
  gt(col: string, val: any) { return this.addFilter('gt', col, val) }
  gte(col: string, val: any) { return this.addFilter('gte', col, val) }
  lt(col: string, val: any) { return this.addFilter('lt', col, val) }
  lte(col: string, val: any) { return this.addFilter('lte', col, val) }
  like(col: string, pat: string) { return this.addFilter('like', col, pat) }
  ilike(col: string, pat: string) { return this.addFilter('ilike', col, pat) }
  is(col: string, val: any) { return this.addFilter('is', col, val) }
  in(col: string, vals: any[]) { return this.addFilter('in', col, vals) }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = this.sanitize(col)
    this.orderAsc = opts?.ascending ?? true
    return this
  }

  limit(n: number): this { this.limitVal = n; return this }
  range(start: number, end: number): this { this.offsetVal = start; this.limitVal = end - start + 1; return this }

  single() { return this._execute(true) }
  maybeSingle() { return this._execute('maybe') }

  insert(data: Record<string, any> | Record<string, any>[]): this {
    this.method = 'insert'
    this.insertData = data
    return this
  }

  update(data: Record<string, any>): this {
    this.method = 'update'
    this.updateData = data
    return this
  }

  delete(): this {
    this.method = 'delete'
    return this
  }

  then(resolve: (v: any) => any, reject: (e: any) => any) {
    return this._execute().then(resolve, reject)
  }

  private buildWhereClause(): { clause: string; params: any[] } {
    const clauses: string[] = []
    const params: any[] = []
    for (const f of this.filters) {
      const col = this.sanitize(f.col)
      const idx = params.length + 1
      switch (f.op) {
        case 'eq':
          if (f.val === null) { clauses.push(`${col} IS NULL`) }
          else { clauses.push(`${col} = $${idx}`); params.push(f.val) }
          break
        case 'neq':
          if (f.val === null) { clauses.push(`${col} IS NOT NULL`) }
          else { clauses.push(`${col} != $${idx}`); params.push(f.val) }
          break
        case 'gt': clauses.push(`${col} > $${idx}`); params.push(f.val); break
        case 'gte': clauses.push(`${col} >= $${idx}`); params.push(f.val); break
        case 'lt': clauses.push(`${col} < $${idx}`); params.push(f.val); break
        case 'lte': clauses.push(`${col} <= $${idx}`); params.push(f.val); break
        case 'like': clauses.push(`${col} LIKE $${idx}`); params.push(f.val); break
        case 'ilike': clauses.push(`${col} ILIKE $${idx}`); params.push(f.val); break
        case 'is': clauses.push(`${col} IS $${idx}`); params.push(f.val); break
        case 'in':
          const arr = Array.isArray(f.val) ? f.val : [f.val]
          const phs = arr.map((_, i) => `$${idx + i}`)
          clauses.push(`${col} IN (${phs.join(',')})`)
          params.push(...arr)
          break
      }
    }
    return { clause: clauses.length ? clauses.join(' AND ') : 'TRUE', params }
  }

  private buildInsertSQL(): { sql: string; params: any[] } {
    const rows = Array.isArray(this.insertData) ? this.insertData : [this.insertData]
    const first = rows[0] || {}
    const cols = Object.keys(first)
    const colList = cols.map(c => this.sanitize(c)).join(', ')
    const params: any[] = []
    const valueRows = rows.map(row => {
      const vals = cols.map(c => {
        params.push(row[c] ?? null)
        return `$${params.length}`
      })
      return `(${vals.join(', ')})`
    })
    return { sql: `INSERT INTO ${this.sanitize(this.table)} (${colList}) VALUES ${valueRows.join(', ')} RETURNING *`, params }
  }

  private buildUpdateSQL(): { sql: string; params: any[] } {
    const data = this.updateData || {}
    const cols = Object.keys(data)
    const params: any[] = cols.map(c => data[c] ?? null)
    const setClause = cols.map((c, i) => `${this.sanitize(c)} = $${i + 1}`).join(', ')
    const { clause, params: whereParams } = this.buildWhereClause()
    return { sql: `UPDATE ${this.sanitize(this.table)} SET ${setClause} WHERE ${clause} RETURNING *`, params: [...params, ...whereParams] }
  }

  private buildDeleteSQL(): { sql: string; params: any[] } {
    const { clause, params } = this.buildWhereClause()
    return { sql: `DELETE FROM ${this.sanitize(this.table)} WHERE ${clause} RETURNING *`, params }
  }

  private buildSelectSQL(): { sql: string; params: any[] } {
    const { clause, params } = this.buildWhereClause()
    let sql = `SELECT ${this.selectCols} FROM ${this.sanitize(this.table)}`
    sql += ` WHERE ${clause}`
    if (this.orderBy) sql += ` ORDER BY ${this.orderBy} ${this.orderAsc ? 'ASC' : 'DESC'}`
    if (this.limitVal) sql += ` LIMIT ${this.limitVal}`
    if (this.offsetVal) sql += ` OFFSET ${this.offsetVal}`
    return { sql, params }
  }

  private guessFkCol(joinTable: string): string {
    const singular = joinTable.endsWith('s') ? joinTable.slice(0, -1) : joinTable
    return `${singular}_id`
  }

  private async _execute(single?: boolean | 'maybe'): Promise<{ data: any; error: any; count?: number }> {
    const api = getApi()
    if (!api) return { data: null, error: new Error('Desktop API not available') }

    try {
      let { sql, params } = this.method === 'insert'
        ? this.buildInsertSQL()
        : this.method === 'update'
        ? this.buildUpdateSQL()
        : this.method === 'delete'
        ? this.buildDeleteSQL()
        : this.buildSelectSQL()

      const result = await api.query(sql, params)

      if (result.rows.length === 0) {
        if (single === true) return { data: null, error: { code: 'PGRST116', message: 'Row not found', details: 'The result contains 0 rows', hint: '' } }
        if (single === 'maybe') return { data: null, error: null }
        return { data: [], error: null, count: 0 }
      }

      let rows = result.rows
      if (this.method === 'select' && this.joinTables.length > 0) {
        for (const row of rows) {
          for (const jt of this.joinTables) {
            const fkCol = this.guessFkCol(jt)
            const joinResult = await api.query(`SELECT * FROM ${this.sanitize(jt)} WHERE ${this.sanitize(fkCol)} = $1`, [row.id])
            row[jt] = joinResult.rows
          }
        }
      }

      if (single === true || single === 'maybe') {
        return { data: rows[0], error: null }
      }
      return { data: rows, error: null, count: result.rowCount }
    } catch (err: any) {
      return { data: null, error: { message: err.message } }
    }
  }
}

export function createDesktopSupabase(): any {
  const api = getApi()

  return {
    rpc: async (fn: string, args: Record<string, unknown> = {}): Promise<{ data: any; error: any }> => {
      if (!api) return { data: null, error: new Error('Desktop API not available') }
      try {
        const entries = Object.entries(args)
        const params = entries.map(([, v]) => v ?? null)
        const paramRefs = entries.map(([k], i) => `"${k.replace(/[^a-zA-Z0-9_]/g, '')}" := $${i + 1}`).join(', ')
        const sql = entries.length > 0
          ? `SELECT * FROM "public"."${fn.replace(/[^a-zA-Z0-9_]/g, '')}"(${paramRefs})`
          : `SELECT * FROM "public"."${fn.replace(/[^a-zA-Z0-9_]/g, '')}"()`
        const result = await api.query(sql, params)
        const rows = result.rows
        if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
          const val = Object.values(rows[0])[0]
          return { data: val, error: null }
        }
        return { data: rows.length === 1 ? rows[0] : rows, error: null }
      } catch (err: any) {
        return { data: null, error: { message: err.message } }
      }
    },

    from: (table: string): any => {
      return new DesktopPostgrestBuilder(table)
    },

    channel: () => ({
      on: () => ({ subscribe: () => {} }),
      subscribe: () => {},
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
    getChannels: () => [],
  }
}
