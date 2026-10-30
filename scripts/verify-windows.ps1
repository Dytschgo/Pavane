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
$previousEvidenceOverride = $env:PAVANE_EVIDENCE_DIR
$previousPrebuiltOverride = $env:PAVANE_PREBUILT_VERIFICATION
$packageManagerEnvironment = @{}
$nodeVersion = $null
$pnpmVersion = $null
$prebuilt = Test-Path -LiteralPath (Join-Path $repository 'verification-input/manifest.json') -PathType Leaf
$mode = if ($prebuilt) { 'prebuilt-ui' } else { 'source-build' }
$sourceEvidence = Join-Path ([IO.Path]::GetTempPath()) ('pavane-fixture-evidence-' + [Guid]::NewGuid().ToString('N'))
$env:PAVANE_EVIDENCE_DIR = $sourceEvidence

function Invoke-Check {
    param([string]$Name, [scriptblock]$Action)
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
    $checks.Add($Name)
}

try {
    $tools = if ($prebuilt) { @('node', 'pnpm') } else { @('node', 'pnpm', 'cargo', 'rustc') }
    foreach ($tool in $tools) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing guest prerequisite: $tool. No host installation was attempted." }
    }
    $nodeVersion = (& node --version).Trim()
    $minimumNode = if ($prebuilt) { [version]'22.16.0' } else { [version]'24.0.0' }
    if ([version]$nodeVersion.TrimStart('v') -lt $minimumNode) { throw "Node.js $minimumNode or newer is required for $mode; observed $nodeVersion." }
    if ($prebuilt) {
        if ($LiveCodex) { throw 'Prebuilt UI verification does not enable live Codex inference.' }
        $env:PAVANE_PREBUILT_VERIFICATION = '1'
        # Use the already-installed pnpm. Do not let Corepack/pnpm download a
        # different package manager or persist an automatic packageManager pin.
        foreach ($setting in @{
            COREPACK_ENABLE_NETWORK = '0'
            COREPACK_ENABLE_AUTO_PIN = '0'
            COREPACK_ENABLE_PROJECT_SPEC = '0'
            pnpm_config_pm_on_fail = 'ignore'
            npm_config_manage_package_manager_versions = 'false'
        }.GetEnumerator()) {
            $packageManagerEnvironment[$setting.Key] = [Environment]::GetEnvironmentVariable($setting.Key, 'Process')
            [Environment]::SetEnvironmentVariable($setting.Key, $setting.Value, 'Process')
        }
        Invoke-Check 'verify transported prebuilt executable and source hashes' { node scripts/prepare-prebuilt.mjs --verify-only }
    } else { $env:PAVANE_PREBUILT_VERIFICATION = $null }
    $pnpmVersion = (& pnpm --version).Trim()
    Invoke-Check 'restore locked renderer dependencies' {
        if ($prebuilt) { pnpm install --frozen-lockfile --ignore-scripts }
        else { pnpm install --frozen-lockfile }
    }
    if (-not $prebuilt) {
        Invoke-Check 'renderer format, lint, types and regressions' { pnpm check }
        Invoke-Check 'Rust formatting' { cargo fmt --all --check }
        Invoke-Check 'Rust lint' { cargo clippy --workspace --all-targets --locked -- -D warnings }
        Invoke-Check 'storage and native regressions' { cargo test --workspace --locked }
        Invoke-Check 'debug native build' { cargo build -p pavane --locked }
        $vite = Join-Path $repository 'node_modules/vite/bin/vite.js'
        $devServer = Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"{0}" --host 127.0.0.1 --port 1420 --strictPort' -f $vite) -WorkingDirectory $repository -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $evidence 'vite.stdout.log') -RedirectStandardError (Join-Path $evidence 'vite.stderr.log')
    }
    Invoke-Check 'native mock-provider workflows' { node scripts/native-smoke.mjs }
    if (-not $prebuilt) { Invoke-Check 'optimized standalone build' { pnpm desktop:build } }
    if ($LiveCodex) {
        # Uses only the guest's existing Codex login. Never transfer a host auth file.
        Invoke-Check 'optimized Codex model picker, streaming, interrupt and job containment' { node scripts/codex-smoke.mjs --release }
    }
    Invoke-Check 'bundled release workflows and owned process-tree measurements' { node scripts/release-smoke.mjs }
    Invoke-Check 'long Markdown typing and native history reading position' { node scripts/performance-smoke.mjs --label candidate }
    $binaryPath = if ($prebuilt) { 'verification-input/pavane.exe' } else { 'target/release/pavane.exe' }
    $binary = Get-Item -LiteralPath (Join-Path $repository $binaryPath)
    $report = [ordered]@{
        result = 'passed'
        mode = $mode
        platform = [Environment]::OSVersion.VersionString
        node = $nodeVersion
        pnpm = $pnpmVersion
        rust = $(if ($prebuilt) { $null } else { & rustc --version })
        checks = @($checks)
        liveCodex = [bool]$LiveCodex
        excluded = $(if ($prebuilt) { @('guest Rust build/tests', 'renderer static/unit checks', 'live Codex inference') } else { @() })
        binaryBytes = $binary.Length
        binarySha256 = (Get-FileHash -LiteralPath $binary.FullName -Algorithm SHA256).Hash
        note = 'Native smoke uses synthetic data. Live Codex requires an existing guest login. Source/test success does not establish installer signing, RAM targets or a published release.'
    }
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'verification.json') -Encoding UTF8
} catch {
    [ordered]@{result='failed'; mode=$mode; node=$nodeVersion; pnpm=$pnpmVersion; checks=@($checks); error=$_.Exception.Message} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'verification.json') -Encoding UTF8
    throw
} finally {
    if ($devServer -and -not $devServer.HasExited) { Stop-Process -Id $devServer.Id -ErrorAction SilentlyContinue }
    $env:PAVANE_EVIDENCE_DIR = $previousEvidenceOverride
    $env:PAVANE_PREBUILT_VERIFICATION = $previousPrebuiltOverride
    foreach ($setting in $packageManagerEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($setting.Key, $setting.Value, 'Process')
    }
    $artifacts = @('verification.json', 'native-smoke.json', 'native-empty.png', 'native-chat.png', 'native-final.png', 'native-narrow.png', 'native-composer-focused.png', 'native-composer-multiline.png', 'native-unicode-limit.png', 'native-failure.png', 'codex-smoke.json', 'codex-picker.png', 'codex-picker-options.png', 'codex-chat.png', 'codex-connections.png', 'codex-failure.png', 'release-smoke.json', 'release-empty.png', 'release-draft.png', 'performance-candidate.json', 'performance-candidate-long.png', 'performance-candidate-history.png')
    $artifacts += 'performance-candidate-reading.png'
    $exportErrors = [System.Collections.Generic.List[string]]::new()
    $collected = [System.Collections.Generic.List[string]]::new()
    $collected.Add('verification.json')
    foreach ($name in $artifacts | Where-Object { $_ -ne 'verification.json' }) {
        $source = Join-Path $sourceEvidence $name
        try {
            if (Test-Path -LiteralPath $source) {
                Copy-Item -LiteralPath $source -Destination (Join-Path $evidence $name) -Force
                $collected.Add($name)
            }
        } catch { $exportErrors.Add("Could not collect $name.") }
    }
    # SSH collects lab-evidence; the retained Windows runner collects this
    # guest-provided directory. Publish only the same allowlisted synthetic data,
    # even when a check failed. Never copy auth, databases, binaries or raw logs.
    $runnerEvidence = $env:AGENTLAB_EVIDENCE_DIR
    if (-not [string]::IsNullOrWhiteSpace($runnerEvidence)) {
        try { New-Item -ItemType Directory -Path $runnerEvidence -Force | Out-Null }
        catch { $exportErrors.Add('Could not create the guest runner evidence directory.') }
        foreach ($name in $collected) {
            $source = Join-Path $evidence $name
            try {
                if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $runnerEvidence $name) -Force }
            } catch { $exportErrors.Add("Could not export $name to the guest runner.") }
        }
    }
    if ($exportErrors.Count -gt 0) {
        $reportPath = Join-Path $evidence 'verification.json'
        $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
        $report.result = 'failed'
        $report | Add-Member -NotePropertyName evidenceErrors -NotePropertyValue @($exportErrors) -Force
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($runnerEvidence)) {
            try { Copy-Item -LiteralPath $reportPath -Destination (Join-Path $runnerEvidence 'verification.json') -Force }
            catch { Write-Warning 'Could not export the evidence failure report.' }
        }
        throw 'Synthetic verification evidence could not be fully collected/exported.'
    }
}
