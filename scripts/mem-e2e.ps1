$emailFile = "$env:USERPROFILE\.aether\mem-e2e-email.txt"
$passwordFile = "$env:USERPROFILE\.aether\mem-e2e-password.txt"

if (-not (Test-Path $emailFile)) { Write-Error "Missing email file"; exit 1 }
if (-not (Test-Path $passwordFile)) { Write-Error "Missing password file"; exit 1 }

$email = Get-Content $emailFile -Raw
$password = <REDACTED> -Raw

$email = $email.Trim()
$password = $password.Trim()

$envFile = "C:\Users\Piyush\aether-v2\.env.local"
$envContent = Get-Content $envFile

$anonKey = ($envContent | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$' } | ForEach-Object { $matches[1] })
$serviceKey = ($envContent | Where-Object { $_ -match '^SUPABASE_SERVICE_ROLE_KEY=(.*)$' } | ForEach-Object { $matches[1] })

$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $anonKey
$env:SUPABASE_SERVICE_ROLE_KEY = $serviceKey
$env:MEM_E2E_EMAIL = $email
$env:MEM_E2E_PASSWORD = $password

Write-Host "EMAIL: $email"
Write-Host "PASSWORD_LENGTH: $($password.Length)"
