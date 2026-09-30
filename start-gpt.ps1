# Starts the bot with the gpt profile.
# The API keys come from the PowerShell secret vault and are passed to the bot as
# environment variables, so no keys.json is needed.
#
#   .\start-gpt.ps1          start the bot
#   .\start-gpt.ps1 -Log     also save the output under %LOCALAPPDATA%\Mindcraft\logs
param([switch] $Log)

if (Get-Command fnm -ErrorAction SilentlyContinue) {
    fnm env --shell powershell | Out-String | Invoke-Expression
    fnm use 20
}

Push-Location $PSScriptRoot
try {
    $env:OPENAI_API_KEY = Get-Secret -Name OpenaiApiKey -AsPlainText -ErrorAction Stop
    # The code model of profiles/gpt.json is a Claude model (claude-sonnet-5): the bot makes it
    # at the start and does not start without the Anthropic key.
    $env:ANTHROPIC_API_KEY = Get-Secret -Name AnthropicsApiKey -AsPlainText -ErrorAction Stop
    if ($Log) {
        $dir = New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Mindcraft\logs"
        $file = Join-Path $dir ("gpt-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
        Write-Host "Session log: $file"
        node main.js --profiles ./profiles/gpt.json 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $file
    }
    else {
        node main.js --profiles ./profiles/gpt.json
    }
}
finally {
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    Pop-Location
}
