$b64 = Get-Content "$env:USERPROFILE\.aether\mem-e2e-script-b64.txt" -Raw
$bytes = [Convert]::FromBase64String($b64.Trim())
$script = [System.Text.Encoding]::UTF8.GetString($bytes)
[System.IO.File]::WriteAllText("C:\Users\Piyush\aether-v2\scripts\mem-e2e-run.mjs", $script)
Write-Host "WRITTEN"
