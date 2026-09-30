$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# Compatibility with the supplied local Spring-style credentials (never printed).
if (-not $env:DB_USER -and $env:SPRING_DATASOURCE_USERNAME) { $env:DB_USER = $env:SPRING_DATASOURCE_USERNAME }
if (-not $env:DB_PASSWORD -and $env:SPRING_DATASOURCE_PASSWORD) { $env:DB_PASSWORD = $env:SPRING_DATASOURCE_PASSWORD }

function Require-Env {
  param([string]$Name)
  $value = [System.Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }
  return $value
}

$dbEnabled = [System.Environment]::GetEnvironmentVariable("DB_ENABLED")
if ($dbEnabled -ne "true") {
  throw "DB_ENABLED must be set to true before starting backend."
}

$dbHost = Require-Env "DB_HOST"
$dbPort = Require-Env "DB_PORT"
Require-Env "DB_NAME" | Out-Null
Require-Env "DB_USER" | Out-Null
Require-Env "DB_PASSWORD" | Out-Null

try {
  $tcpReady = Test-NetConnection -ComputerName $dbHost -Port ([int]$dbPort) -InformationLevel Quiet -WarningAction SilentlyContinue -ErrorAction Stop
  if (-not $tcpReady) {
    throw "TCP endpoint is unavailable"
  }
}
catch {
  throw "Database TCP check failed: $dbHost`:$dbPort"
}

Push-Location $projectRoot
try {
  Write-Host "DB preflight check passed. Starting backend..."
  mvn clean compile exec:java
  if ($LASTEXITCODE -ne 0) {
    throw "Maven backend startup failed (exit code $LASTEXITCODE)."
  }
}
finally {
  Pop-Location
}
