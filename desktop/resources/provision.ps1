param(
    [Parameter(Mandatory=$true)]
    [string]$InstallDir,
    [Parameter(Mandatory=$true)]
    [string]$AppDataDir
)

$ErrorActionPreference = "Stop"
$ServiceName = "ahram_pg_16"
$DbName = "ahram_local"
$DbUser = "ahram_app"
$PgData = Join-Path $AppDataDir "pgdata"
$LogDir = Join-Path $AppDataDir "logs"
$LogFile = Join-Path $LogDir "provision.log"
$ConfigFile = Join-Path $AppDataDir "db-config.json"
$PwdFile = Join-Path $AppDataDir "db-pwd.enc"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$ts] [$Level] $Message"
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
    Write-Host $entry
}

function Fail-Fast {
    param([string]$Stage, [string]$Command, [int]$ExitCode, [string]$Stdout, [string]$Stderr)
    Write-Log "FAILED STAGE: $Stage" "ERROR"
    Write-Log "  Command:  $Command" "ERROR"
    Write-Log "  ExitCode: $ExitCode" "ERROR"
    if ($Stdout) { Write-Log "  Stdout:   $Stdout" "ERROR" }
    if ($Stderr) { Write-Log "  Stderr:   $Stderr" "ERROR" }
    throw "Stage '$Stage' failed (exit code $ExitCode)"
}

function Write-FileNoBom {
    param([string]$Path, [string]$Content)
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Read-FileNoBom {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
}

function Find-PGBinDir {
    $candidates = @(
        (Join-Path $InstallDir "pg-bin\pgsql\bin"),
        (Join-Path $InstallDir "pg-bin\bin")
    )
    foreach ($dir in $candidates) {
        if (Test-Path (Join-Path $dir "psql.exe")) { return $dir }
    }
    $pgBin = Join-Path $InstallDir "pg-bin"
    if (Test-Path $pgBin) {
        foreach ($entry in (Get-ChildItem $pgBin -Directory -ErrorAction SilentlyContinue)) {
            if (Test-Path (Join-Path $entry.FullName "bin\psql.exe")) { return (Join-Path $entry.FullName "bin") }
        }
    }
    return $null
}

function Find-AvailablePort {
    param([int]$StartPort = 5432)
    for ($port = $StartPort; $port -lt $StartPort + 100; $port++) {
        $inUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if (-not $inUse) { return $port }
    }
    return $StartPort
}

function New-SecurePassword {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $bytes = New-Object byte[] 24
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Run-Psql {
    param([string]$PgBinDir, [int]$Port, [string]$User, [string]$Database, [string]$Command)
    $psql = Join-Path $PgBinDir "psql.exe"
    $args = @("-U", $User, "-h", "127.0.0.1", "-p", "$Port", "-tAc", $Command)
    if ($Database) { $args = @("-U", $User, "-h", "127.0.0.1", "-p", "$Port", "-d", $Database, "-tAc", $Command) }
    $output = & $psql @args 2>&1
    return @{ Output = ($output | Out-String).Trim(); ExitCode = $LASTEXITCODE }
}

# === MAIN ===

Write-Log "=== Provisioning started ==="
Write-Log "InstallDir=$InstallDir AppDataDir=$AppDataDir"
Write-Log "Canonical config path: $ConfigFile"
Write-Log "Canonical pwd path: $PwdFile"
Write-Log "Canonical data dir: $PgData"
Write-Log "DPAPI scope: LocalMachine (machine-level, cross-user decryption)"

try {
    Add-Type -AssemblyName System.Security

    # ── STAGE 0: Early exit if fully provisioned ──
    $svcExists = $false
    $svcRunning = $false
    try { $svc = Get-Service -Name $ServiceName -ErrorAction Stop; $svcExists = $true; $svcRunning = $svc.Status -eq "Running" } catch {}
    $configExists = Test-Path $ConfigFile

    if ($svcRunning -and $configExists) {
        Write-Log "Already provisioned and running. Skipping."
        exit 0
    }

    # If config exists but service is not running, try to restart pg directly
    if ($configExists -and (Test-Path (Join-Path $PgData "postgresql.conf"))) {
        $pgBinDir = Find-PGBinDir
        if (-not $pgBinDir) {
            # pg-bin was deleted (e.g. by uninstaller during reinstall) — extract from ZIP
            $zipPath = Join-Path $InstallDir "resources\pg-binaries.zip"
            if (Test-Path $zipPath) {
                $destDir = Join-Path $InstallDir "pg-bin"
                try {
                    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                    & cmd /c "tar -xf `"$zipPath`" -C `"$destDir`" 2>&1" | Out-Null
                    if ($LASTEXITCODE -eq 0) { $pgBinDir = Find-PGBinDir }
                } catch { Write-Log "Could not re-extract PG binaries: $($_.Exception.Message)" "WARN" }
            }
        }
        if ($pgBinDir) {
            try {
                # Determine port from existing config (may differ from default 5432)
                $restorePort = 5432
                try {
                    $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
                    if ($cfg.port) { $restorePort = [int]$cfg.port }
                } catch {}

                # Re-register Windows service if it was deleted (reinstall scenario)
                if (-not $svcExists) {
                    Write-Log "Reinstall: Registering Windows service $ServiceName..."
                    $pgCtl = Join-Path $pgBinDir "pg_ctl.exe"
                    $output = & $pgCtl register -D $PgData -N $ServiceName -w 2>&1 | Out-String
                    if ($LASTEXITCODE -eq 0) {
                        & sc.exe config $ServiceName start= auto 2>&1 | Out-Null
                        Write-Log "Reinstall: Service registered with AUTO_START"
                        $svcExists = $true
                    } else {
                        Write-Log "Reinstall: Service registration failed, will start as process: $output" "WARN"
                    }
                }

                # Check if postgres already running
                $pgReady = Join-Path $pgBinDir "pg_isready.exe"
                & cmd /c "`"$pgReady`" -h 127.0.0.1 -p $restorePort 2>&1" | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    # Not running — start via service if registered, else pg_ctl
                    if ($svcExists) {
                        Write-Log "Reinstall: Starting service..."
                        & sc.exe start $ServiceName 2>&1 | Out-Null
                        for ($i = 0; $i -lt 15; $i++) {
                            Start-Sleep -Seconds 2
                            try { $svc = Get-Service -Name $ServiceName -ErrorAction Stop; if ($svc.Status -eq "Running") { break } } catch {}
                        }
                    } else {
                        $pgCtl = Join-Path $pgBinDir "pg_ctl.exe"
                        & cmd /c "`"$pgCtl`" start -D `"$PgData`" -w -t 15 2>&1" | Out-Null
                    }
                    if ($LASTEXITCODE -eq 0) { Start-Sleep -Seconds 3 }
                }
                # Verify DB connectivity
                $check = Run-Psql -PgBinDir $pgBinDir -Port $restorePort -User "postgres" -Database "" -Command "SELECT 1"
                if ($check.ExitCode -eq 0 -and $check.Output -match "1") {
                    Write-Log "Existing PostgreSQL data detected and running. Already provisioned. Skipping."
                    exit 0
                }
            } catch {
                Write-Log "Could not start existing PostgreSQL: $($_.Exception.Message)" "WARN"
            }
        }
    }

    # If service is running but config is missing, test DB health directly
    if ($svcRunning) {
        $pgBinDir = Find-PGBinDir
        if ($pgBinDir) {
            try {
                $dbCheck = Run-Psql -PgBinDir $pgBinDir -Port 5432 -User "postgres" -Database "" -Command "SELECT count(*) FROM pg_database WHERE datname='$DbName'"
                if ($dbCheck.ExitCode -eq 0 -and $dbCheck.Output -match "1") {
                    $userCheck = Run-Psql -PgBinDir $pgBinDir -Port 5432 -User "postgres" -Database "" -Command "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'"
                    if ($userCheck.ExitCode -eq 0 -and $userCheck.Output -match "1") {
                        Write-Log "DB and user already exist. Regenerating config, skipping full provisioning."
                        $regenPwd = New-SecurePassword
                        Run-Psql -PgBinDir $pgBinDir -Port 5432 -User "postgres" -Database "" -Command "ALTER USER $DbUser WITH PASSWORD '$regenPwd'" | Out-Null
                        $regenConfig = @{ host = "localhost"; port = 5432; database = $DbName; user = $DbUser } | ConvertTo-Json -Depth 5
                        Write-FileNoBom $ConfigFile $regenConfig
                        $regenPwdBytes = [System.Text.Encoding]::UTF8.GetBytes($regenPwd)
                        $regenEncrypted = [System.Security.Cryptography.ProtectedData]::Protect($regenPwdBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
                        [System.IO.File]::WriteAllText($PwdFile, [Convert]::ToBase64String($regenEncrypted), [System.Text.UTF8Encoding]::new($false))
                        Write-Log "Config regenerated. Skipping full provisioning."
                        exit 0
                    }
                }
            } catch {
                Write-Log "DB health check failed, will re-provision: $($_.Exception.Message)" "WARN"
            }
        }
    }

    # ── STAGE 1: Extract PostgreSQL binaries ──
    $pgBinDir = Find-PGBinDir
    if (-not $pgBinDir) {
        $zipPath = Join-Path $InstallDir "resources\pg-binaries.zip"
        if (-not (Test-Path $zipPath)) { throw "pg-binaries.zip not found at $zipPath" }
        $destDir = Join-Path $InstallDir "pg-bin"
        Write-Log "STAGE 1: Extracting PostgreSQL from $zipPath..."
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        $output = & tar -xf $zipPath -C $destDir 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { Fail-Fast "1-extract" "tar -xf $zipPath -C $destDir" $LASTEXITCODE $output "" }
        $pgBinDir = Find-PGBinDir
        if (-not $pgBinDir) { throw "Stage 1: PG binaries not found after extraction" }
    }
    Write-Log "STAGE 1 PASS: PG binaries at $pgBinDir"

    # ── STAGE 2: Verify required executables ──
    $required = @("psql.exe", "initdb.exe", "pg_ctl.exe", "postgres.exe", "pg_isready.exe")
    foreach ($exe in $required) {
        $path = Join-Path $pgBinDir $exe
        if (-not (Test-Path $path)) { throw "Stage 2: Required executable missing: $path" }
    }
    Write-Log "STAGE 2 PASS: All required executables verified"

    # ── STAGE 3: Initialize data directory ──
    $needsInit = -not (Test-Path (Join-Path $PgData "postgresql.conf"))
    if ($needsInit) {
        Write-Log "STAGE 3: Initializing data directory at $PgData..."
        if (-not (Test-Path $PgData)) { New-Item -ItemType Directory -Path $PgData -Force | Out-Null }
        $initdb = Join-Path $pgBinDir "initdb.exe"
        $output = & $initdb -D $PgData --encoding=UTF8 --no-locale --username=postgres --auth=trust 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { Fail-Fast "3-initdb" "$initdb -D $PgData" $LASTEXITCODE $output "" }
        # Validate initdb created postgresql.conf
        if (-not (Test-Path (Join-Path $PgData "postgresql.conf"))) { throw "Stage 3: postgresql.conf not created by initdb" }
        if (-not (Test-Path (Join-Path $PgData "pg_hba.conf"))) { throw "Stage 3: pg_hba.conf not created by initdb" }
        if (-not (Test-Path (Join-Path $PgData "PG_VERSION"))) { throw "Stage 3: PG_VERSION not created by initdb" }
    }
    Write-Log "STAGE 3 PASS: Data directory ready at $PgData"

    # ── STAGE 4: Configure postgresql.conf ──
    $port = Find-AvailablePort -StartPort 5432
    $confPath = Join-Path $PgData "postgresql.conf"
    $conf = Read-FileNoBom $confPath

    # Strip BOM if present (from initdb or previous write)
    if ($conf.Length -gt 0 -and $conf[0] -eq [char]0xFEFF) { $conf = $conf.Substring(1) }

    # Set port
    if ($conf -match '(?m)^#\s*port\s*=') {
        $conf = $conf -replace '(?m)^#\s*port\s*=.*$', "port = $port"
    } elseif ($conf -match '(?m)^port\s*=') {
        $conf = $conf -replace '(?m)^port\s*=.*$', "port = $port"
    } else {
        $conf += "`nport = $port`n"
    }
    # Set listen_addresses
    if ($conf -match '(?m)^#\s*listen_addresses\s*=') {
        $conf = $conf -replace '(?m)^#\s*listen_addresses\s*=.*$', "listen_addresses = 'localhost'"
    } elseif ($conf -match '(?m)^listen_addresses\s*=') {
        $conf = $conf -replace '(?m)^listen_addresses\s*=.*$', "listen_addresses = 'localhost'"
    } else {
        $conf += "listen_addresses = 'localhost'`n"
    }

    Write-FileNoBom $confPath $conf

    # Validate: no BOM, contains port, contains listen_addresses
    $bytes = [System.IO.File]::ReadAllBytes($confPath)
    if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw "Stage 4: postgresql.conf has BOM after write" }
    $verifyConf = Read-FileNoBom $confPath
    if ($verifyConf -notmatch "(?m)^port\s*=\s*$port") { throw "Stage 4: port=$port not found in postgresql.conf after write" }
    if ($verifyConf -notmatch "(?m)^listen_addresses\s*=") { throw "Stage 4: listen_addresses not set in postgresql.conf" }
    Write-Log "STAGE 4 PASS: postgresql.conf configured (port=$port, listen_addresses=localhost, no BOM)"

    # ── STAGE 5: Configure pg_hba.conf ──
    $hbaPath = Join-Path $PgData "pg_hba.conf"
    $hbaContent = "# TYPE  DATABASE        USER            ADDRESS                 METHOD`nlocal   all             all                                     trust`nhost    all             all             127.0.0.1/32            trust`nhost    all             all             ::1/128                 trust`n"
    Write-FileNoBom $hbaPath $hbaContent

    # Validate
    $hbaBytes = [System.IO.File]::ReadAllBytes($hbaPath)
    if ($hbaBytes[0] -eq 0xEF) { throw "Stage 5: pg_hba.conf has BOM after write" }
    $verifyHba = Read-FileNoBom $hbaPath
    if ($verifyHba -notmatch "trust") { throw "Stage 5: trust entries not found in pg_hba.conf" }
    Write-Log "STAGE 5 PASS: pg_hba.conf configured (trust for local connections)"

    # ── STAGE 6: Register Windows service ──
    if (-not $svcExists) {
        Write-Log "STAGE 6: Registering Windows service $ServiceName..."
        $pgCtl = Join-Path $pgBinDir "pg_ctl.exe"
        $output = & $pgCtl register -D $PgData -N $ServiceName -w 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { Fail-Fast "6-register" "$pgCtl register -D $PgData -N $ServiceName" $LASTEXITCODE $output "" }

        # Set auto-start
        $configOutput = & sc.exe config $ServiceName start= auto 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { Fail-Fast "6-autostart" "sc config $ServiceName start= auto" $LASTEXITCODE $configOutput "" }

        # Set description
        & sc.exe description $ServiceName "Ahram ERP local PostgreSQL 16 database" 2>&1 | Out-Null
        & sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 2>&1 | Out-Null

        # Verify registration
        $verifyOutput = & sc.exe qc $ServiceName 2>&1 | Out-String
        if ($verifyOutput -notmatch "ahram_pg_16") { throw "Stage 6: Service not found after registration" }
        if ($verifyOutput -notmatch "AUTO_START") { throw "Stage 6: Service not set to AUTO_START" }
    } else {
        Write-Log "STAGE 6: Service already exists."
    }
    Write-Log "STAGE 6 PASS: Service registered with AUTO_START"

    # ── STAGE 7: Start service ──
    if (-not $svcRunning) {
        Write-Log "STAGE 7: Starting service..."
        $output = & sc.exe start $ServiceName 2>&1 | Out-String
        # Wait for RUNNING state
        $started = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 1
            try { $svc = Get-Service -Name $ServiceName -ErrorAction Stop; if ($svc.Status -eq "Running") { $started = $true; break } } catch {}
        }
        if (-not $started) {
            $finalStatus = & sc.exe query $ServiceName 2>&1 | Out-String
            Fail-Fast "7-start" "sc start $ServiceName" 1 "" "Service not RUNNING after 30s. Final state: $finalStatus"
        }
    }
    Write-Log "STAGE 7 PASS: Service is RUNNING"

    # ── STAGE 8: Verify PostgreSQL readiness with pg_isready ──
    Write-Log "STAGE 8: Checking PostgreSQL readiness with pg_isready..."
    $pgIsReady = Join-Path $pgBinDir "pg_isready.exe"
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        $output = & $pgIsReady -h 127.0.0.1 -p $port -U postgres 2>&1 | Out-String
        if ($output -match "accepting connections") { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        $finalOutput = & $pgIsReady -h 127.0.0.1 -p $port 2>&1 | Out-String
        Fail-Fast "8-pg_isready" "$pgIsReady -h 127.0.0.1 -p $port" 1 "" $finalOutput
    }
    Write-Log "STAGE 8 PASS: pg_isready confirms accepting connections"

    # ── STAGE 9: Connect with psql ──
    Write-Log "STAGE 9: Connecting with psql..."
    $connResult = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "SELECT version()"
    if ($connResult.ExitCode -ne 0) { Fail-Fast "9-connect" "psql SELECT version()" $connResult.ExitCode "" $connResult.Output }
    Write-Log "STAGE 9 PASS: Connected. $($connResult.Output)"

    # ── STAGE 10: Create/verify ahram_app user ──
    $existingPwd = $null
    if ($configExists) {
        try {
            $existingConfig = Get-Content $ConfigFile -Raw | ConvertFrom-Json
            if (Test-Path $PwdFile) {
                $b64 = (Get-Content $PwdFile -Raw).Trim()
                $encrypted = [Convert]::FromBase64String($b64)
                $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
                $existingPwd = [System.Text.Encoding]::UTF8.GetString($decrypted)
            }
        } catch {}
    }

    if ($existingPwd) {
        $pwd = $existingPwd
        Write-Log "STAGE 10: Using existing password from config (length=$($pwd.Length))"
    } else {
        $pwd = New-SecurePassword
        Write-Log "STAGE 10: Generated new password (length=$($pwd.Length))"
    }

    $userCheck = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'"
    if ($userCheck.Output -ne "1") {
        $createResult = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "CREATE USER $DbUser WITH PASSWORD '$pwd' SUPERUSER"
        if ($createResult.ExitCode -ne 0) { Fail-Fast "10-create-user" "CREATE USER $DbUser" $createResult.ExitCode "" $createResult.Output }
    } else {
        $alterResult = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "ALTER USER $DbUser WITH PASSWORD '$pwd' SUPERUSER"
        if ($alterResult.ExitCode -ne 0) { Fail-Fast "10-alter-user" "ALTER USER $DbUser" $alterResult.ExitCode "" $alterResult.Output }
    }
    # Verify user exists
    $verifyUser = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'"
    if ($verifyUser.Output -ne "1") { throw "Stage 10: User $DbUser does not exist after creation" }
    Write-Log "STAGE 10 PASS: User $DbUser verified"

    # ── STAGE 11: Create/verify ahram_local database ──
    $dbCheck = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "SELECT 1 FROM pg_database WHERE datname='$DbName'"
    if ($dbCheck.Output -ne "1") {
        $createDb = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "CREATE DATABASE $DbName OWNER $DbUser"
        if ($createDb.ExitCode -ne 0) { Fail-Fast "11-create-db" "CREATE DATABASE $DbName" $createDb.ExitCode "" $createDb.Output }
    }
    # Verify database exists
    $verifyDb = Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "SELECT 1 FROM pg_database WHERE datname='$DbName'"
    if ($verifyDb.Output -ne "1") { throw "Stage 11: Database $DbName does not exist after creation" }

    # Grant privileges
    Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database "" -Command "GRANT ALL PRIVILEGES ON DATABASE $DbName TO $DbUser" | Out-Null
    Run-Psql -PgBinDir $pgBinDir -Port $port -User "postgres" -Database $DbName -Command "GRANT ALL ON SCHEMA public TO $DbUser" | Out-Null
    Write-Log "STAGE 11 PASS: Database $DbName verified, privileges granted"

    # ── STAGE 12: Apply schema.sql ──
    $schemaPath = Join-Path $InstallDir "resources\schema.sql"
    if (-not (Test-Path $schemaPath)) { throw "Stage 12: schema.sql not found at $schemaPath" }
    Write-Log "STAGE 12: Applying schema from $schemaPath..."
    $psql = Join-Path $pgBinDir "psql.exe"
    $schemaResult = & cmd /c "`"$psql`" -U $DbUser -h 127.0.0.1 -p $port -d $DbName -f `"$schemaPath`" 2>&1"
    $schemaExit = $LASTEXITCODE
    $schemaText = @($schemaResult) -join "`r`n"
    # Log NOTICE/WARNING lines separately (not errors)
    $schemaText -split "`r`n" | Where-Object { $_ -match "NOTICE:|WARNING:" } | ForEach-Object { Write-Log "psql: $_" "WARN" }
    if ($schemaExit -ne 0) { Fail-Fast "12-schema" "psql -f $schemaPath" $schemaExit "" $schemaText }
    Write-Log "STAGE 12 PASS: Schema applied"

    # ── STAGE 13: Apply sync_metadata DDL ──
    $syncDdl = @"
CREATE TABLE IF NOT EXISTS sync_metadata (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name varchar(100) NOT NULL, last_sync_at timestamptz NOT NULL DEFAULT now(), last_sync_cursor varchar(255), row_count integer DEFAULT 0, sync_status varchar(20) DEFAULT 'idle', error_message text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(table_name));
CREATE TABLE IF NOT EXISTS sync_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name varchar(100) NOT NULL, operation varchar(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')), record_id uuid NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), synced boolean DEFAULT false, synced_at timestamptz, retry_count integer DEFAULT 0, last_error text);
CREATE TABLE IF NOT EXISTS sync_conflicts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name varchar(100) NOT NULL, record_id uuid NOT NULL, local_version jsonb NOT NULL, remote_version jsonb NOT NULL, resolution varchar(20) DEFAULT 'pending' CHECK (resolution IN ('pending', 'local', 'remote', 'merged')), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_sync_outbox_unsynced ON sync_outbox (created_at) WHERE synced = false;
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_pending ON sync_conflicts (created_at) WHERE resolution = 'pending';
CREATE INDEX IF NOT EXISTS idx_sync_metadata_table ON sync_metadata (table_name);
"@
    $syncFile = Join-Path $env:TEMP "ahram_sync_ddl.sql"
    Write-FileNoBom $syncFile $syncDdl
    $syncResult = & cmd /c "`"$psql`" -U $DbUser -h 127.0.0.1 -p $port -d $DbName -f `"$syncFile`" 2>&1"
    $syncExit = $LASTEXITCODE
    $syncText = @($syncResult) -join "`r`n"
    if ($syncExit -ne 0) { Fail-Fast "13-sync-ddl" "psql -f sync_ddl.sql" $syncExit "" $syncText }
    Remove-Item $syncFile -Force -ErrorAction SilentlyContinue
    Write-Log "STAGE 13 PASS: Sync metadata DDL applied"

    # ── STAGE 14: Verify expected table count ──
    $tableResult = Run-Psql -PgBinDir $pgBinDir -Port $port -User $DbUser -Database $DbName -Command "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
    $tableCount = 0
    if ([int]::TryParse($tableResult.Output, [ref]$tableCount)) {
        if ($tableCount -lt 90) { throw "Stage 14: Expected >= 90 tables, got $tableCount" }
    } else {
        throw "Stage 14: Could not parse table count: '$($tableResult.Output)'"
    }
    Write-Log "STAGE 14 PASS: $tableCount tables verified (>= 90)"

    # ── STAGE 15: Save configuration ──
    $config = @{ host = "localhost"; port = [int]$port; database = $DbName; user = $DbUser } | ConvertTo-Json -Depth 5
    Write-FileNoBom $ConfigFile $config
    # Validate config written
    if (-not (Test-Path $ConfigFile)) { throw "Stage 15: db-config.json not created" }
    $verifyConfig = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    if ($verifyConfig.port -ne $port) { throw "Stage 15: port mismatch in config" }
    if ($verifyConfig.database -ne $DbName) { throw "Stage 15: database mismatch in config" }
    if ($verifyConfig.user -ne $DbUser) { throw "Stage 15: user mismatch in config" }
    Write-Log "STAGE 15 PASS: Configuration saved to $ConfigFile"

    # ── STAGE 16: Save encrypted password ──
    $pwdBytes = [System.Text.Encoding]::UTF8.GetBytes($pwd)
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($pwdBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    $b64 = [Convert]::ToBase64String($encrypted)
    [System.IO.File]::WriteAllText($PwdFile, $b64, [System.Text.UTF8Encoding]::new($false))
    if (-not (Test-Path $PwdFile)) { throw "Stage 16: db-pwd.enc not created" }
    Write-Log "STAGE 16 PASS: Encrypted password saved to $PwdFile (DPAPI LocalMachine scope)"

    # ── DPAPI READBACK VERIFICATION ──
    try {
        $verifyB64 = [System.IO.File]::ReadAllText($PwdFile, [System.Text.UTF8Encoding]::new($false)).Trim()
        $verifyEnc = [Convert]::FromBase64String($verifyB64)
        $verifyDec = [System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($verifyEnc, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine))
        if ($verifyDec -eq $pwd) {
            Write-Log "DPAPI readback: PASS (password round-trips correctly with LocalMachine scope)"
        } else {
            throw "DPAPI readback: content mismatch"
        }
    } catch {
        Write-Log "DPAPI readback: FAIL - $($_.Exception.Message)" "ERROR"
        throw "DPAPI verification failed"
    }

    Write-Log "=== Provisioning completed successfully ==="
    exit 0

} catch {
    Write-Log "FATAL: $($_.Exception.Message)" "ERROR"
    Write-Log $_.ScriptStackTrace "ERROR"
    exit 1
}
