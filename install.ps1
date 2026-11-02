# Installs Claude Session Relay into VS Code.
#
# Modes:
#   .\install.ps1                # install the locally built VSIX if present, else the latest release
#   .\install.ps1 -FromRelease   # always download and install the latest GitHub release
#
# One-command install (no clone or local build needed) - run in PowerShell:
#   irm https://raw.githubusercontent.com/rbritta/claude-session-relay/main/install.ps1 -OutFile "$env:TEMP\csr.ps1"; & "$env:TEMP\csr.ps1"
#
# Use -Code to pick another VS Code build, for example -Code code-insiders.
param([switch]$FromRelease, [string]$Code = "code")
$ErrorActionPreference = "Stop"

$RepoSlug  = "rbritta/claude-session-relay"
$AssetName = "claude-session-relay.vsix"

if (-not (Get-Command $Code -ErrorAction SilentlyContinue)) {
    throw "'$Code' is not on the PATH. In VS Code run: Shell Command: Install 'code' command in PATH."
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$localVsix = Join-Path $root "dist\$AssetName"
if (-not $FromRelease -and (Test-Path $localVsix)) {
    $vsix = $localVsix
    Write-Host "Installing locally built VSIX: $vsix"
}
else {
    $vsix = Join-Path $env:TEMP $AssetName
    $url = "https://github.com/$RepoSlug/releases/latest/download/$AssetName"
    Write-Host "Downloading the latest release: $url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $vsix -UseBasicParsing
}

& $Code --install-extension $vsix --force
if ($LASTEXITCODE -ne 0) { throw "VS Code could not install $vsix." }
Write-Host "Done. Reload the VS Code windows (Developer: Reload Window) to start listening." -ForegroundColor Green
