param(
  [Parameter(Mandatory = $true)]
  [string]$PocketBaseBinary,
  [int]$Port = 18095
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$migrations = Join-Path $projectRoot 'infra\pocketbase\pb_migrations'
$hooks = Join-Path $projectRoot 'infra\pocketbase\pb_hooks'
$testScript = Join-Path $projectRoot 'infra\pocketbase\tests\runtime-smoke.mjs'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$qaDirectory = Join-Path $tempRoot ('uroprofin-runtime-smoke-' + [guid]::NewGuid().ToString('N'))
$dataDirectory = Join-Path $qaDirectory 'pb_data'
$stdoutLog = Join-Path $qaDirectory 'pocketbase.stdout.log'
$stderrLog = Join-Path $qaDirectory 'pocketbase.stderr.log'
$superuser = 'qa-superuser@uroprofin.invalid'
$superuserPassword = 'QaSuper-' + [guid]::NewGuid().ToString('N') + '9'
$userPassword = 'QaUser-' + [guid]::NewGuid().ToString('N') + '8'
$process = $null

New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null

try {
  & $PocketBaseBinary migrate up "--dir=$dataDirectory" "--migrationsDir=$migrations" "--hooksDir=$hooks"
  if ($LASTEXITCODE -ne 0) { throw 'Falló migrate up en la instancia aislada.' }

  & $PocketBaseBinary superuser upsert $superuser $superuserPassword "--dir=$dataDirectory"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el superusuario temporal.' }

  $arguments = @(
    'serve',
    "--http=127.0.0.1:$Port",
    "--dir=$dataDirectory",
    "--migrationsDir=$migrations",
    "--hooksDir=$hooks",
    '--dev=false',
    '--automigrate=false',
    '--hooksWatch=false'
  )
  $process = Start-Process -FilePath $PocketBaseBinary -ArgumentList $arguments -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru

  $healthy = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $healthy) { throw 'PocketBase aislado no respondió saludable.' }

  $env:PB_QA_URL = "http://127.0.0.1:$Port"
  $env:PB_QA_SUPERUSER = $superuser
  $env:PB_QA_SUPERPASS = $superuserPassword
  $env:PB_QA_USERPASS = $userPassword
  & node $testScript
  if ($LASTEXITCODE -ne 0) { throw 'Falló la prueba runtime-smoke.' }
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  $resolved = [IO.Path]::GetFullPath($qaDirectory)
  $leaf = Split-Path $resolved -Leaf
  if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and $leaf.StartsWith('uroprofin-runtime-smoke-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  } else {
    Write-Warning 'El directorio temporal no se eliminó porque no pasó la validación de ruta.'
  }
}
