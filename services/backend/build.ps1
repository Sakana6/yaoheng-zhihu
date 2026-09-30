$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $projectRoot
try {
  mvn -DskipTests clean compile
  if ($LASTEXITCODE -ne 0) {
    throw "Maven backend build failed (exit code $LASTEXITCODE)."
  }
}
finally {
  Pop-Location
}
