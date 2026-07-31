export {
  detectPostgreSQL,
  checkHealth,
  tryConnect,
  createDatabase,
  runSchemaBootstrap,
  executeQuery,
  getPool,
  loadDbConfig,
  saveDbConfig,
  ensureDirectories,
  startService,
  stopService,
  startAhramService,
  stopAhramService,
  findAvailablePort,
  generatePassword,
  savePassword,
  loadPassword,
  DATA_DIR,
  DB_NAME,
  DB_USER,
  AH_SERVICE_NAME,
  AH_PG_VERSION,
  BACKUP_DIR,
  logProvision,
} from './PostgreSQLManager.js'

export type {
  PgConnection,
  PgStatus,
  PgHealthCheck,
} from './PostgreSQLManager.js'

export {
  initialSync,
  incrementalSync,
} from './InitialSync.js'

export {
  createBackup,
  restoreBackup,
  listBackups,
  shouldBackup,
} from './BackupManager.js'

export type { BackupResult } from './BackupManager.js'

export {
  bootstrapLocalDatabase,
  performInitialSync,
  performIncrementalSync,
  performBackup,
} from './HealthChecker.js'

export type {
  DesktopHealthReport,
  StatusCallback,
} from './HealthChecker.js'
