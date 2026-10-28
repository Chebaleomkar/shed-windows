# Starts Shed when you sign in to Windows. Run `npm run autostart` to add it and `npm run autostart -- -Remove` to take it away.
param([switch]$Remove)

$name = 'Shed'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Shed will no longer start when you sign in.'
  return
}

$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$node' server\index.js`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Shed: control coding agents on this PC from a phone' -Force | Out-Null
Write-Host "Shed will start when $env:USERNAME signs in. It runs from $root."
