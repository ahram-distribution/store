$files = Get-ChildItem -Recurse -Filter *.ts -Path src
$files += Get-ChildItem -Recurse -Filter *.tsx -Path src
$rpcs = @()
foreach ($f in $files) {
  $content = Get-Content -LiteralPath $f.FullName -Raw
  $matches = [regex]::Matches($content, "supabase\.rpc\('([^']+)'")
  foreach ($m in $matches) {
    $rpcs += $m.Groups[1].Value
  }
}
$rpcs | Sort-Object -Unique
