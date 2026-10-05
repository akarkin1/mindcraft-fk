# Starts the bot with the claude profile.
# The API key comes from the PowerShell secret vault and is passed to the bot as an
# environment variable, so no keys.json is needed.
#
#   .\start-claude.ps1          start the bot
#   .\start-claude.ps1 -Log     also save the output under %LOCALAPPDATA%\Mindcraft\logs
param([switch] $Log)

if (Get-Command fnm -ErrorAction SilentlyContinue) {
    fnm env --shell powershell | Out-String | Invoke-Expression
    fnm use 20
}

Push-Location $PSScriptRoot
try {
    $env:ANTHROPIC_API_KEY = Get-Secret -Name AnthropicsApiKey -AsPlainText -ErrorAction Stop
    $env:OPENAI_API_KEY = Get-Secret -Name OpenaiApiKey -AsPlainText -ErrorAction Stop
    # v0.1.4.12: the token of the watch server (settings watch_server), from the vault when it is there; without it the server does not start
    # $env:MC_WATCH_TOKEN = Get-Secret -Name MindcraftWatchToken -AsPlainText -ErrorAction SilentlyContinue
    if ($Log) {
        $dir = New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Mindcraft\logs"
        $file = Join-Path $dir ("claude-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
        Write-Host "Session log: $file"
        node main.js --profiles ./profiles/claude.json 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $file
    }
    else {
        node main.js --profiles ./profiles/claude.json
    }
}
finally {
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    # Remove-Item Env:MC_WATCH_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    Pop-Location
}
