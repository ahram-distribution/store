import { ipcMain } from 'electron'

export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number
  fields: Array<{ name: string; dataType: string }>
}

export function registerDatabaseHandlers(): void {
  ipcMain.handle('db:query', async (_event, _sql: string, _params?: unknown[]): Promise<QueryResult> => {
    return { rows: [], rowCount: 0, fields: [] }
  })

  ipcMain.handle('db:connect', async (): Promise<boolean> => {
    return false
  })

  ipcMain.handle('db:disconnect', async (): Promise<boolean> => {
    return false
  })
}
