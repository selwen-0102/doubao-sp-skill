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
        function Get-RemoteSkill {
            $ArchivePath = Join-Path $TempDir "repository.zip"
            $Headers = @{
                Accept = "application/vnd.github+json"
                "User-Agent" = "doubao-seedance-installer"
            }
            $Downloaded = $false
            for ($Attempt = 1; $Attempt -le 3 -and -not $Downloaded; $Attempt++) {
                try {
                    Invoke-WebRequest `
                        -UseBasicParsing `
                        -Headers $Headers `
                        -Uri "https://api.github.com/repos/$Repository/zipball/main" `
                        -OutFile $ArchivePath `
                        -TimeoutSec 120
                    $Downloaded = $true
                } catch {
                    if ($Attempt -lt 3) { Start-Sleep -Seconds 2 }
                }
            }
            if ($Downloaded) {
                try {
                    Expand-Archive -Path $ArchivePath -DestinationPath $TempDir -Force
                    $SkillFile = Get-ChildItem -Path $TempDir -Filter "SKILL.md" -Recurse |
                        Where-Object { $_.FullName -match "[\\/]skills[\\/]doubao-seedance[\\/]SKILL\.md$" } |
                        Select-Object -First 1
                    if ($SkillFile) { return $SkillFile.Directory.FullName }
                } catch {
                    # Fall back to Git below when the archive cannot be extracted.
                }
            }

            if (Get-Command git -ErrorAction SilentlyContinue) {
                $RepositoryPath = Join-Path $TempDir "repository"
                & git -c http.version=HTTP/1.1 `
                    -c http.connectTimeout=15 `
                    -c http.lowSpeedLimit=1000 `
                    -c http.lowSpeedTime=30 `
                    clone --depth 1 --quiet "https://github.com/$Repository.git" $RepositoryPath
                if ($LASTEXITCODE -eq 0) {
                    return (Join-Path $RepositoryPath "skills\doubao-seedance")
                }
            }
            throw "Unable to download $Repository. Check your network or proxy and retry."
        }
        $Source = Get-RemoteSkill
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
