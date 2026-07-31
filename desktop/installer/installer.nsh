; Ahram ERP NSIS Installer Customization
; Provides provisioning of bundled PostgreSQL during installation

; Force admin execution for service registration and system-level setup
!macro customHeader
  RequestExecutionLevel admin
!macroend

; Run PostgreSQL provisioning after files are extracted
!macro customInstall
  DetailPrint "Setting up PostgreSQL database..."
  DetailPrint "This may take a minute on first install..."

  ; Run the provisioning PowerShell script
  ; $INSTDIR = install directory (contains resources/provision.ps1)
  ; ProgramData environment variable = shared machine-level data directory
  ReadEnvStr $R0 "ProgramData"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\provision.ps1" -InstallDir "$INSTDIR" -AppDataDir "$R0\ahram-desktop"' $0

  ${If} $0 != "0"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Database setup encountered an issue (exit code $0).$\nThe application will still launch, but offline database may not be available.$\n$\nCheck $R0\ahram-desktop\logs\provision.log for details."
  ${Else}
    DetailPrint "PostgreSQL database setup complete."
  ${EndIf}
!macroend

; Cleanup PostgreSQL service on uninstall
!macro customUnInstall
  ; Stop and remove the PostgreSQL service
  DetailPrint "Stopping Ahram PostgreSQL service..."
  ExecWait 'sc.exe stop "ahram_pg_16"'
  Sleep 2000

  DetailPrint "Removing Ahram PostgreSQL service..."
  ExecWait 'sc.exe delete "ahram_pg_16"'
!macroend
