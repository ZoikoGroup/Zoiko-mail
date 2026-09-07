<#
.SYNOPSIS
  Starts the whole local stack: database, API, frontend.

.DESCRIPTION
  One command instead of three terminals, and it encodes the two things that
  are easy to get wrong by hand.

  First, the API runs from source rather than from its container image. The
  image is built ahead of time and goes stale the moment the backend changes;
  a stale image once answered every sign-in with a session carrying no
  workspace scope, which the client refuses, so sign-in looked broken while
  the API looked healthy. Running from source cannot drift.

  Second, it refuses to leave the container API holding port 5000, for the
  same reason. `docker compose up -d` with no service named starts it, so this
  brings up only postgres and stops the api container if it is running.

  Idempotent: anything already up is left alone, so it is safe to re-run.

.PARAMETER Check
  Report what is running and whether the API serves workspace-scoped sessions,
  then exit without starting anything.

.PARAMETER Down
  Stop what this script starts.

.PARAMETER Docker
  Run the API from its container image instead of from source, rebuilding the
  image first. Use this when you want the containerised platform; the rebuild
  is what keeps it from being the stale image described above. Slower and far
  more memory-hungry than the default. The frontend still runs with npm —
  there is no Frontend/Dockerfile.

.EXAMPLE
  .\Backend\scripts\dev-up.ps1
  .\Backend\scripts\dev-up.ps1 -Docker
  .\Backend\scripts\dev-up.ps1 -Check
  .\Backend\scripts\dev-up.ps1 -Down
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Down,
  [switch]$Docker
)

$ErrorActionPreference = 'Stop'

$BackendDir  = Split-Path -Parent $PSScriptRoot
$RepoRoot    = Split-Path -Parent $BackendDir
$FrontendDir = Join-Path $RepoRoot 'Frontend'
$DbPort      = '55432'

function Write-Step($text) { Write-Host "  $text" }
function Write-Ok($text)   { Write-Host "  $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  $text" -ForegroundColor Yellow }
function Write-Bad($text)  { Write-Host "  $text" -ForegroundColor Red }

function Test-Port([int]$Port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $Port)
    $c.Close()
    return $true
  } catch { return $false }
}

function Get-DatabaseUrl {
  $line = (Select-String -Path (Join-Path $BackendDir '.env') -Pattern '^POSTGRES_PASSWORD=' -ErrorAction SilentlyContinue).Line
  if (-not $line) { throw "POSTGRES_PASSWORD not found in Backend\.env" }
  $pw = $line -replace '^POSTGRES_PASSWORD=', ''
  return "postgresql://zoiko:$pw@localhost:$DbPort/zoiko_mail?schema=public"
}

<#
  Whether the API issues workspace-scoped sessions.

  This is the specific way a stale API fails, and it is invisible from the
  outside: every endpoint answers normally and only the missing field breaks
  the client. Worth asserting rather than assuming.
#>
function Test-ApiScoped {
  $body = '{"email":"alex@acme.test","password":"Password123!"}'
  $last = 'not attempted'

  # Retried, because an error here is usually just timing. The API keeps a
  # database connection pool, and for a few seconds after postgres restarts
  # under it that pool is stale and every request 500s before Prisma
  # reconnects. Reporting the first failure said "could not probe the API"
  # about an API that was fine moments later.
  foreach ($attempt in 1..4) {
    try {
      $res = Invoke-RestMethod -Uri 'http://localhost:5000/api/v1/auth/login' `
        -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15
      $scope = $res.data.session.workspace
      if ($scope) { return @{ Scoped = $true; Detail = $scope } }
      # A well-formed answer with no scope is the stale-image symptom, and it
      # will not improve by waiting.
      return @{ Scoped = $false; Detail = 'no workspace on the session' }
    } catch {
      $last = $_.Exception.Message
      if ($attempt -lt 4) { Start-Sleep -Seconds 5 }
    }
  }

  # Still failing after retries. Could be a seeded account this database does
  # not have, so it is reported as unknown rather than as a scope failure.
  return @{ Scoped = $null; Detail = $last }
}

function Show-Status {
  Write-Host ''
  Write-Host '  service            port    state'
  Write-Host '  ------------------ ------- -----'
  $db = Test-Port ([int]$DbPort)
  $api = Test-Port 5000
  $fe = Test-Port 3000
  Write-Host ("  postgres           {0,-7} {1}" -f $DbPort, $(if ($db) { 'up' } else { 'down' }))
  Write-Host ("  api                {0,-7} {1}" -f '5000', $(if ($api) { 'up' } else { 'down' }))
  Write-Host ("  frontend           {0,-7} {1}" -f '3000', $(if ($fe) { 'up' } else { 'down' }))
  Write-Host ''

  if ($api) {
    $probe = Test-ApiScoped
    if ($probe.Scoped -eq $true) {
      Write-Ok "API issues workspace-scoped sessions (alex@acme.test -> $($probe.Detail))"
    } elseif ($probe.Scoped -eq $false) {
      Write-Bad "API is STALE: $($probe.Detail)."
      Write-Bad 'Sign-in will bounce back to the login page. Stop the api container and re-run this script.'
    } else {
      Write-Warn "Could not probe the API: $($probe.Detail)"
    }
  }
  if ($db -and $api -and $fe) { Write-Host ''; Write-Ok 'Open http://localhost:3000/login' }
}

if ($Check) { Show-Status; return }

if ($Down) {
  Write-Step 'Stopping the frontend and API (port owners)...'
  foreach ($port in 3000, 5000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Step "  stopped pid $_ (port $port)" } catch {} }
  }
  Write-Step 'Stopping postgres...'
  Push-Location $BackendDir
  try {
    $env:POSTGRES_HOST_PORT = $DbPort
    & docker compose -f docker-compose.yml -f docker-compose.dev.yml stop postgres 2>&1 | Out-Null
  } finally { Pop-Location }
  Write-Ok 'Stopped.'
  return
}

# Low memory is the reason this stack keeps falling over on this machine, so
# say it up front rather than letting a service die halfway through starting.
$os = Get-CimInstance Win32_OperatingSystem
$freeMb = [math]::Round($os.FreePhysicalMemory / 1KB)
if ($freeMb -lt 700) {
  Write-Warn "Only $freeMb MB RAM free. Close some VS Code windows or this will not all start."
}

<#
  Docker Desktop, started if it is not already.

  Needed because a cold machine has no engine running, and "one command" is
  not one command if it fails on the first step after every reboot. Only the
  engine is checked, not the tray app: the app can be present while the engine
  is still coming up, and it is the engine that compose talks to.
#>
function Start-DockerEngine {
  & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Ok 'engine already running'; return $true }

  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $exe)) {
    Write-Bad "Docker Desktop not found at $exe — start it yourself, then re-run."
    return $false
  }

  Write-Step '  starting Docker Desktop (this takes a minute on a cold start)...'
  Start-Process -FilePath $exe | Out-Null

  $deadline = (Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10
    & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok 'engine up'; return $true }
  }
  Write-Bad 'Docker did not start within 4 minutes.'
  return $false
}

Write-Host ''
Write-Step '1/4  docker'
if (-not (Start-DockerEngine)) { return }

Write-Step '2/4  postgres'
if (Test-Port ([int]$DbPort)) {
  Write-Ok "already up on $DbPort"
} else {
  Push-Location $BackendDir
  try {
    $env:POSTGRES_HOST_PORT = $DbPort
    & docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres 2>&1 |
      Where-Object { $_ -match 'Started|Running|Created|Healthy|Error|error' } |
      ForEach-Object { Write-Step "  $_" }
  } finally { Pop-Location }

  $deadline = (Get-Date).AddMinutes(2)
  while (-not (Test-Port ([int]$DbPort)) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
  if (Test-Port ([int]$DbPort)) { Write-Ok "up on $DbPort" } else { Write-Bad 'postgres did not come up'; return }
}

if ($Docker) {
  Write-Step '3/4  api (container, rebuilt)'

  # The image build is by far the heaviest thing here: two npm ci runs, a
  # prisma generate and a tsc build. On a machine this tight it does not
  # merely fail — it takes the Docker engine down with it, which then looks
  # like an unrelated "cannot connect to the docker API" error. Refusing up
  # front is kinder than a half-finished teardown.
  $freeForBuild = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
  if ($freeForBuild -lt 1500) {
    Write-Bad "Not enough memory to build the image: ${freeForBuild} MB free, and this needs about 1.5 GB."
    Write-Bad 'Close some VS Code windows and re-run, or drop -Docker to run the API from source.'
    Write-Warn 'Nothing was changed — whatever is running stays running.'
    return
  }

  # Build before touching anything that works.
  #
  # The first version stopped the source API first, so a build that died left
  # no API at all: the working setup was torn down for a container that never
  # arrived. Build, and only swap once there is something to swap to.
  Write-Step '  building the image (several minutes, and memory-hungry)...'
  $built = $false
  Push-Location $BackendDir
  try {
    $env:POSTGRES_HOST_PORT = $DbPort
    & docker compose -f docker-compose.yml -f docker-compose.dev.yml build api 2>&1 |
      Where-Object { $_ -match 'Building|Built|ERROR|error|failed|cannot connect' } |
      ForEach-Object { Write-Step "    $_" }
    $built = $LASTEXITCODE -eq 0
  } finally { Pop-Location }

  if (-not $built) {
    # The engine dying mid-build is the common shape of this on a tight
    # machine, and its own error message points at a pipe rather than at
    # memory. Name the likely cause instead.
    & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Bad 'The Docker engine went down during the build — almost always memory.'
    } else {
      Write-Bad 'The image build failed. A build killed for memory shows as exit 137.'
    }
    Write-Bad 'Free some RAM and re-run, or drop -Docker to run the API from source.'
    Write-Warn 'Nothing was swapped — whatever was running is still running.'
    return
  }

  # Only now is it safe to give up the working API.
  Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      try {
        Stop-Process -Id $_ -Force -ErrorAction Stop
        Write-Step "  stopped the source API (pid $_) so the container can bind 5000"
      } catch {}
    }
  # Wait for the port to actually clear: a listener lingers briefly after the
  # process goes, and starting the container into an occupied port fails.
  $freeBy = (Get-Date).AddSeconds(20)
  while ((Test-Port 5000) -and (Get-Date) -lt $freeBy) { Start-Sleep -Seconds 2 }

  Push-Location $BackendDir
  try {
    $env:POSTGRES_HOST_PORT = $DbPort
    & docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d api 2>&1 |
      Where-Object { $_ -match 'Started|Running|Recreated|Healthy|ERROR|error|failed' } |
      ForEach-Object { Write-Step "    $_" }
  } finally { Pop-Location }

  $deadline = (Get-Date).AddMinutes(3)
  while (-not (Test-Port 5000) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 }
  if (Test-Port 5000) {
    Write-Ok 'up on 5000 (container)'
  } else {
    Write-Bad 'the api container did not come up. Check: docker logs backend-api-1'
  }
}
else {

Write-Step '3/4  api (from source)'
# The container image goes stale and answers with unscoped sessions, so it must
# not own port 5000. Stopping it is cheap and prevents a confusing failure.
#
# Then wait for the port to clear before deciding anything. Without the wait,
# the check below saw the stopping container still listening, reported
# "already up on 5000", started nothing, and left no API at all — the status
# table two lines later said down.
& docker stop backend-api-1 2>&1 | Out-Null
$clearBy = (Get-Date).AddSeconds(20)
while ((Test-Port 5000) -and (Get-Date) -lt $clearBy) {
  if (-not (docker ps -q --filter 'name=backend-api-1')) { break }
  Start-Sleep -Seconds 2
}
if (Test-Port 5000) {
  Write-Ok 'already up on 5000'
} else {
  $dbUrl = Get-DatabaseUrl
  $cmd = @"
Set-Location '$BackendDir'
`$env:DATABASE_URL = '$dbUrl'
`$env:PORT = '5000'
Write-Host 'Zoiko API (from source) — Ctrl+C to stop' -ForegroundColor Cyan
npm run dev
"@
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd | Out-Null
  $deadline = (Get-Date).AddMinutes(2)
  while (-not (Test-Port 5000) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
  if (Test-Port 5000) { Write-Ok 'up on 5000 (own window)' } else { Write-Bad 'api did not come up — check its window' }
}

}

# The frontend is not containerised — there is no Frontend/Dockerfile and no
# frontend service in compose — so it runs with npm in both modes. Said here
# rather than left implicit, because "-Docker" reasonably implies otherwise.
Write-Step '4/4  frontend (npm — not containerised)'
if (Test-Port 3000) {
  Write-Ok 'already up on 3000'
} else {
  $cmd = @"
Set-Location '$FrontendDir'
Write-Host 'Zoiko frontend — Ctrl+C to stop' -ForegroundColor Cyan
npm run dev
"@
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd | Out-Null
  $deadline = (Get-Date).AddMinutes(3)
  while (-not (Test-Port 3000) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
  if (Test-Port 3000) { Write-Ok 'up on 3000 (own window)' } else { Write-Bad 'frontend did not come up — check its window' }
}

Show-Status
