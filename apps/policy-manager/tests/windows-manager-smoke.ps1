param(
  [Parameter(Mandatory = $true)]
  [string] $ManagerExePath
)

$ErrorActionPreference = 'Stop'
$managerPath = (Resolve-Path -LiteralPath $ManagerExePath).Path
if ([IO.Path]::GetExtension($managerPath) -ne '.exe') {
  throw 'The smoke target must be a packaged Windows executable.'
}

$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$sandbox = Join-Path $tempParent ("dsh-policy-manager-smoke-" + [guid]::NewGuid().ToString('N'))
if (-not $sandbox.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The generated smoke sandbox is outside the temporary directory.'
}
$homePath = Join-Path $sandbox 'harness-home'
$localData = Join-Path $sandbox 'local-app-data'
$oldDshHome = $env:DSH_HOME
$oldLocalAppData = $env:LOCALAPPDATA
$manager = $null

try {
  New-Item -ItemType Directory -Path $homePath -Force | Out-Null
  New-Item -ItemType Directory -Path $localData -Force | Out-Null
  $env:DSH_HOME = $homePath
  $env:LOCALAPPDATA = $localData

  $manager = Start-Process -FilePath $managerPath -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 3
  if ($manager.HasExited) {
    throw "The packaged manager exited during startup with code $($manager.ExitCode)."
  }
  Stop-Process -Id $manager.Id -Force
  $manager = $null

  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --features app --test backup --test catalog --test installer --test launcher --test installed_dsh --test profile_mode --test recovery --test recovery_descriptor --test transaction
  if ($LASTEXITCODE -ne 0) {
    throw 'The isolated release transition scenarios failed.'
  }

  Write-Output 'Packaged manager start and isolated release transition scenarios passed.'
} finally {
  if ($manager -and -not $manager.HasExited) {
    Stop-Process -Id $manager.Id -Force
  }
  $env:DSH_HOME = $oldDshHome
  $env:LOCALAPPDATA = $oldLocalAppData
  $sandboxFull = [IO.Path]::GetFullPath($sandbox).TrimEnd('\')
  if ($sandboxFull.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $sandboxFull -Recurse -Force -ErrorAction SilentlyContinue
  }
}
