$ErrorActionPreference = "Stop"

$Repository = "selwen-0102/doubao-sp-skill"
$CodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$Target = Join-Path (Join-Path $CodexRoot "skills") "doubao-seedance"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("doubao-seedance-" + [System.Guid]::NewGuid())

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 18 or newer is required."
}
$NodeMajor = [int]((& node -p 'Number(process.versions.node.split(".")[0])').Trim())
if ($NodeMajor -lt 18) {
    throw "Node.js 18 or newer is required; found $(& node --version)."
}

New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
try {
    $Source = if ($PSScriptRoot) { Join-Path $PSScriptRoot "skills\doubao-seedance" } else { "" }
    if (-not $Source -or -not (Test-Path (Join-Path $Source "SKILL.md"))) {
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            throw "Git is required when install.ps1 is executed without a local repository."
        }
        $RepositoryPath = Join-Path $TempDir "repository"
        & git clone --depth 1 --quiet "https://github.com/$Repository.git" $RepositoryPath
        if ($LASTEXITCODE -ne 0) { throw "Failed to download $Repository." }
        $Source = Join-Path $RepositoryPath "skills\doubao-seedance"
    }
    if (-not (Test-Path (Join-Path $Source "SKILL.md")) -or
        -not (Test-Path (Join-Path $Source "scripts\run.mjs"))) {
        throw "Repository does not contain the doubao-seedance skill."
    }
    & node --check (Join-Path $Source "scripts/run.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Downloaded run.mjs failed the Node.js syntax check." }

    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Target -Recurse -Force

    Write-Host "Installed doubao-seedance to $Target"
    Write-Host 'Restart Codex, then invoke it with $doubao-seedance.'
}
finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
