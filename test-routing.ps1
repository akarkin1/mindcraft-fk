# Checks whether plain sentences of the player lead the bot to the right command.
# Sends one request per sentence of tests/routing/sentences.json to the chat model of
# profiles/claude.json, with all parts of v0.1.4.6 switched on, and prints the result
# and the cost of the run. The API key comes from the PowerShell secret vault and is
# passed to the script as an environment variable, so no keys.json is needed.
#
#   .\test-routing.ps1          run the check
#
# To only see the prompt sizes and the estimated cost, without a key and without requests:
#   node scripts/routing_check.js --dry-run --all-parts

if (Get-Command fnm -ErrorAction SilentlyContinue) {
    fnm env --shell powershell | Out-String | Invoke-Expression
    fnm use 20
}

Push-Location $PSScriptRoot
try {
    $env:ANTHROPIC_API_KEY = Get-Secret -Name AnthropicsApiKey -AsPlainText -ErrorAction Stop
    node scripts/routing_check.js --all-parts
}
finally {
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    Pop-Location
}
