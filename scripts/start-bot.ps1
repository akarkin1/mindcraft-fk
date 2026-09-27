<#
.SYNOPSIS
Starts the bot with the API key taken from a PowerShell SecretManagement vault.

.DESCRIPTION
Reads the secret with Get-Secret, hands it to the bot as an environment variable
and removes it again when the bot stops. The key is never written to a file.
A value for the same key in keys.json wins over the environment variable, so
remove the entry from keys.json, or the file itself.

.PARAMETER SecretName
Name of the secret that holds the API key.

.PARAMETER Vault
Vault to read from. Without it the registered vaults are searched.

.PARAMETER KeyName
Environment variable the bot reads the key from. Default: ANTHROPIC_API_KEY.

.PARAMETER NodeVersion
Node version to select when fnm is installed. Default: 20.

.EXAMPLE
.\scripts\start-bot.ps1 -SecretName MyAnthropicKey

.EXAMPLE
.\scripts\start-bot.ps1 -SecretName MyAnthropicKey -Vault MyVault --profiles ./profiles/claude.json
#>

#Requires -Modules Microsoft.PowerShell.SecretManagement

param(
    [Parameter(Mandatory, Position = 0)] [string] $SecretName,
    [string] $Vault,
    [string] $KeyName = 'ANTHROPIC_API_KEY',
    [string] $NodeVersion = '20',
    [Parameter(ValueFromRemainingArguments)] [string[]] $BotArgs = @()
)
$ErrorActionPreference = 'Stop'

$query = @{ Name = $SecretName; AsPlainText = $true }
if ($Vault) { $query.Vault = $Vault }

if (Get-Command fnm -ErrorAction SilentlyContinue) {
    fnm env --shell powershell | Out-String | Invoke-Expression
    fnm use $NodeVersion
}

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    Set-Item "Env:$KeyName" (Get-Secret @query)
    node main.js @BotArgs
}
finally {
    Remove-Item "Env:$KeyName" -ErrorAction SilentlyContinue
    Pop-Location
}
exit $LASTEXITCODE
