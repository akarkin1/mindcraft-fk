# Checks whether plain sentences of the player lead the bot to the right command.
# Sends one request per sentence of tests/routing/sentences.json to the chat model of
# the profile (profiles/claude.json unless -Profile names another; -Model replaces its
# chat model and keeps its params), with all parts switched on, and prints the result
# and the time of every answer, the accuracy, the time per answer and the cost of the
# run. The API key comes from the PowerShell secret vault and is passed to the script
# as an environment variable, so no keys.json is needed: OpenaiApiKey for an OpenAI
# chat model (a -Model that starts with gpt-, or a profile whose model is an OpenAI
# model), else AnthropicsApiKey.
#
#   .\test-routing.ps1                                  run the check with profiles/claude.json
#   .\test-routing.ps1 -Model gpt-6-luna                the same profile with GPT-6 Luna
#   .\test-routing.ps1 -Profile profiles/gpt.json       the gpt profile
#
# To only see the prompt sizes and the estimated cost, without a key and without requests:
#   node scripts/routing_check.js --dry-run --all-parts [--model gpt-6-luna] [--profile profiles/gpt.json]
param(
    [string] $Model = '',
    [Alias('Profile')] [string] $ProfilePath = ''
)

# The rules of apiOf in scripts/routing_check.js: true for a model of OpenAI.
function Test-OpenAiModel($entry) {
    if ($entry -is [string]) { $name = $entry; $api = '' }
    else { $name = [string] $entry.model; $api = [string] $entry.api }
    if ($api) { return $api -eq 'openai' }
    if ($name.Contains('/')) { return $name.StartsWith('openai/') }
    return $name.StartsWith('openai') -or $name.Contains('gpt') -or $name.Contains('o1') -or $name.Contains('o3')
}

if (Get-Command fnm -ErrorAction SilentlyContinue) {
    fnm env --shell powershell | Out-String | Invoke-Expression
    fnm use 20
}

# a profile path relative to the folder where the script was started
if ($ProfilePath) {
    $ProfilePath = (Resolve-Path -Path $ProfilePath -ErrorAction Stop).Path
}

Push-Location $PSScriptRoot
$keyName = ''
try {
    $checkArgs = @('scripts/routing_check.js', '--all-parts')
    if ($ProfilePath) { $checkArgs += @('--profile', $ProfilePath) }
    if ($Model) { $checkArgs += @('--model', $Model) }

    # the chat model: -Model when given, else the model of the profile
    if ($Model) {
        $openai = Test-OpenAiModel $Model
    }
    else {
        $path = if ($ProfilePath) { $ProfilePath } else { 'profiles/claude.json' }
        $openai = Test-OpenAiModel (Get-Content -Raw -Path $path | ConvertFrom-Json).model
    }

    # the secret by its name only; its value goes into the environment of the check and nowhere else
    if ($openai) {
        $keyName = 'OPENAI_API_KEY'
        $env:OPENAI_API_KEY = Get-Secret -Name OpenaiApiKey -AsPlainText -ErrorAction Stop
    }
    else {
        $keyName = 'ANTHROPIC_API_KEY'
        $env:ANTHROPIC_API_KEY = Get-Secret -Name AnthropicsApiKey -AsPlainText -ErrorAction Stop
    }
    node @checkArgs
}
finally {
    if ($keyName) { Remove-Item "Env:$keyName" -ErrorAction SilentlyContinue }
    Pop-Location
}
