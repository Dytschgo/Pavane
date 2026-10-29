[CmdletBinding()]
param([switch]$LiveCodex)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repository
$evidence = Join-Path $repository 'lab-evidence'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$checks = [System.Collections.Generic.List[string]]::new()
$devServer = $null

function Invoke-Check {
    param([string]$Name, [scriptblock]$Action)
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
    $checks.Add($Name)
}

try {
    foreach ($tool in @('node', 'pnpm', 'cargo')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing guest prerequisite: $tool. No host installation was attempted." }
    }
    Invoke-Check 'install locked renderer dependencies' { pnpm install --frozen-lockfile }
    Invoke-Check 'renderer format, lint, types and regressions' { pnpm check }
    Invoke-Check 'Rust formatting' { cargo fmt --all --check }
    Invoke-Check 'Rust lint' { cargo clippy --workspace --all-targets --locked -- -D warnings }
    Invoke-Check 'storage and native regressions' { cargo test --workspace --locked }
    Invoke-Check 'debug native build' { cargo build -p pavane --locked }
    $vite = Join-Path $repository 'node_modules/vite/bin/vite.js'
    $devServer = Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"{0}" --host 127.0.0.1 --port 1420 --strictPort' -f $vite) -WorkingDirectory $repository -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $evidence 'vite.stdout.log') -RedirectStandardError (Join-Path $evidence 'vite.stderr.log')
    Invoke-Check 'native mock-provider workflows' { node scripts/native-smoke.mjs }
    if ($LiveCodex) {
        # Uses only the guest's existing Codex login. Never transfer a host auth file.
        Invoke-Check 'real Codex model picker, streaming, interrupt and job containment' { node scripts/codex-smoke.mjs }
    }
    Invoke-Check 'optimized standalone build' { pnpm desktop:build }
    $binary = Get-Item -LiteralPath (Join-Path $repository 'target/release/pavane.exe')
    $report = [ordered]@{
        result = 'passed'
        platform = [Environment]::OSVersion.VersionString
        node = (& node --version)
        rust = (& rustc --version)
        checks = @($checks)
        liveCodex = [bool]$LiveCodex
        binaryBytes = $binary.Length
        binarySha256 = (Get-FileHash -LiteralPath $binary.FullName -Algorithm SHA256).Hash
        note = 'Native smoke uses synthetic data. Live Codex requires an existing guest login. Source/test success does not establish installer signing, RAM targets or a published release.'
    }
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'verification.json') -Encoding UTF8
} catch {
    [ordered]@{result='failed'; checks=@($checks); error=$_.Exception.Message} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'verification.json') -Encoding UTF8
    throw
} finally {
    if ($devServer -and -not $devServer.HasExited) { Stop-Process -Id $devServer.Id -ErrorAction SilentlyContinue }
    $sourceEvidence = Join-Path $repository 'evidence'
    foreach ($name in @('native-smoke.json', 'native-empty.png', 'native-chat.png', 'native-narrow.png', 'native-composer-focused.png', 'native-composer-multiline.png', 'codex-smoke.json', 'codex-picker.png', 'codex-picker-options.png', 'codex-chat.png', 'codex-connections.png', 'codex-failure.png')) {
        $source = Join-Path $sourceEvidence $name
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $evidence $name) }
    }
}
