param()
$ErrorActionPreference = 'Stop'
$taskMobile = Split-Path $PSScriptRoot -Parent
$taskRoot = Split-Path $taskMobile -Parent
$taskNode = Join-Path $taskRoot '.tools/node-v24.22.0-win-x64'
if (Test-Path (Join-Path $taskNode 'node.exe')) { $env:Path = $taskNode + ';' + $env:Path }
$taskJdk = Join-Path $taskRoot '.tools/petcare-jdk21'
if (-not $env:JAVA_HOME -and (Test-Path $taskJdk)) {
    $env:JAVA_HOME = (Get-ChildItem -LiteralPath $taskJdk -Directory | Select-Object -First 1).FullName
}
$taskSdk = Join-Path $taskRoot '.tools/petcare-android-sdk'
if (-not $env:ANDROID_HOME -and (Test-Path $taskSdk)) { $env:ANDROID_HOME = $taskSdk }
if (-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) { throw 'Set JAVA_HOME (JDK 21) and ANDROID_HOME (Android SDK 36), or install Android Studio.' }
Push-Location $taskMobile
try {
    & npm.cmd run sync
    if ($LASTEXITCODE -ne 0) { throw 'Mobile asset build failed.' }
    & '.\android\gradlew.bat' -p android assembleDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    $taskReleases = Join-Path $taskMobile 'releases'
    New-Item -ItemType Directory -Path $taskReleases -Force | Out-Null
    Copy-Item -LiteralPath 'android/app/build/outputs/apk/debug/app-debug.apk' -Destination (Join-Path $taskReleases 'PetCare-android-debug.apk') -Force
    Write-Output (Join-Path $taskReleases 'PetCare-android-debug.apk')
} finally { Pop-Location }
