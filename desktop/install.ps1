# SPDX-License-Identifier: AGPL-3.0-or-later
# Install Airborne Submarine Squadron on Windows.
#
# Creates:
#   - Start Menu shortcut (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Games)
#   - Desktop shortcut (%USERPROFILE%\Desktop)
#   - Registers .ico in %LOCALAPPDATA%\AirborneSubmarineSquadron\icon.ico
#
# Launches via Deno (preferred) or Node (fallback). Detects which runtime
# is on PATH; if neither, prints installation instructions and exits with
# a non-zero code but leaves the shortcuts in place for later.
#
# Usage:
#   .\desktop\install.ps1
#   .\desktop\install.ps1 -Uninstall
#
# Tested on: Windows 10 22H2, Windows 11 23H2, PowerShell 5.1+ and 7.x.

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'

# --- Self-awareness ---
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$GameDir = Split-Path -Parent $ScriptDir
$AppName = 'AirborneSubmarineSquadron'
$DisplayName = 'Airborne Submarine Squadron'
$IconSource = Join-Path $ScriptDir 'icons\airborne-submarine-squadron.ico'
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$IconDest = Join-Path $InstallDir 'icon.ico'
$StartMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Games'
$StartMenuLink = Join-Path $StartMenuDir "$DisplayName.lnk"
$DesktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) "$DisplayName.lnk"

# --- Uninstall path ---
function Invoke-Uninstall {
    Write-Host "Uninstalling $DisplayName..."
    foreach ($path in @($StartMenuLink, $DesktopLink)) {
        if (Test-Path $path) {
            Remove-Item -LiteralPath $path -Force
            Write-Host "  - Removed $path"
        }
    }
    if (Test-Path $InstallDir) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
        Write-Host "  - Removed $InstallDir"
    }
    Write-Host "Uninstall complete."
}

# --- Runtime detection ---
function Find-Runtime {
    $deno = Get-Command deno -ErrorAction SilentlyContinue
    if ($deno) {
        return @{ Name = 'deno'; Path = $deno.Source; Args = @('run', '--allow-all') }
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        return @{ Name = 'node'; Path = $node.Source; Args = @() }
    }
    return $null
}

# --- Pre-flight ---
function Test-Prerequisites {
    Write-Host '=== Pre-Installation Check ==='
    $ok = $true
    if (-not (Test-Path $IconSource)) {
        Write-Warning "Icon not found: $IconSource"
        $ok = $false
    }
    $runJs = Join-Path $GameDir 'run.js'
    if (-not (Test-Path $runJs)) {
        Write-Warning "run.js not found in $GameDir"
        $ok = $false
    }
    $runtime = Find-Runtime
    if ($null -eq $runtime) {
        Write-Warning 'No JavaScript runtime detected (deno or node).'
        Write-Warning 'Install Deno: winget install DenoLand.Deno'
        Write-Warning 'Or install Node.js: winget install OpenJS.NodeJS.LTS'
        # Not fatal — shortcuts still useful once runtime is installed.
    } else {
        Write-Host "  - Runtime: $($runtime.Name) at $($runtime.Path)"
    }
    return $ok
}

# --- Install icon + working dir ---
function Install-AppFiles {
    Write-Host 'Installing application files...'
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -LiteralPath $IconSource -Destination $IconDest -Force
    Write-Host "  - Icon: $IconDest"
}

# --- Create shortcut ---
function New-Shortcut {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Target,
        [string]$Arguments = '',
        [string]$WorkingDirectory = '',
        [string]$IconLocation = '',
        [string]$Description = ''
    )
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    if ($Arguments) { $shortcut.Arguments = $Arguments }
    if ($WorkingDirectory) { $shortcut.WorkingDirectory = $WorkingDirectory }
    if ($IconLocation) { $shortcut.IconLocation = $IconLocation }
    if ($Description) { $shortcut.Description = $Description }
    $shortcut.Save()
}

function Install-Shortcuts {
    Write-Host 'Installing shortcuts...'
    $runtime = Find-Runtime
    if ($null -eq $runtime) {
        Write-Warning 'Skipping shortcut creation (no runtime detected).'
        return
    }
    $runJs = Join-Path $GameDir 'run.js'
    $args = ($runtime.Args + @($runJs, '--gossamer')) -join ' '

    New-Shortcut `
        -Path $StartMenuLink `
        -Target $runtime.Path `
        -Arguments $args `
        -WorkingDirectory $GameDir `
        -IconLocation $IconDest `
        -Description 'Sopwith-style flying submarine arcade'
    Write-Host "  - Start Menu: $StartMenuLink"

    New-Shortcut `
        -Path $DesktopLink `
        -Target $runtime.Path `
        -Arguments $args `
        -WorkingDirectory $GameDir `
        -IconLocation $IconDest `
        -Description 'Sopwith-style flying submarine arcade'
    Write-Host "  - Desktop: $DesktopLink"
}

# --- Main ---
if ($Uninstall) {
    Invoke-Uninstall
    exit 0
}

if ($Debug) { $VerbosePreference = 'Continue' }

Test-Prerequisites | Out-Null
Install-AppFiles
Install-Shortcuts

Write-Host ''
Write-Host '=== Installation Complete ==='
Write-Host "  Start Menu  : $StartMenuLink"
Write-Host "  Desktop     : $DesktopLink"
Write-Host "  Install dir : $InstallDir"
Write-Host ''
Write-Host 'Launch from the Start Menu (Games > Airborne Submarine Squadron)'
Write-Host 'or run:  deno run --allow-all run.js --gossamer'
