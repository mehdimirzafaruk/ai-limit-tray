const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AiLimitNativeWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
}
'@

function Test-CodexDesktopProcess($process) {
  if (-not $process -or $process.MainWindowHandle -eq 0) { return $false }
  $name = [string]$process.ProcessName
  $exePath = ''
  try { $exePath = [string]$process.Path } catch {}
  $description = ''
  try { $description = [string]$process.MainModule.FileVersionInfo.FileDescription } catch {}
  if ($name -ieq 'Codex') { return $true }
  return $name -ieq 'ChatGPT' -and ($exePath -match 'OpenAI[.]Codex_' -or $exePath -match '[\\/]Codex[\\/]' -or $description -match 'Codex')
}

function Test-ClaudeDesktopProcess($process) {
  if (-not $process -or $process.MainWindowHandle -eq 0) { return $false }
  if ([string]$process.ProcessName -ine 'Claude') { return $false }
  $exePath = ''
  try { $exePath = [string]$process.Path } catch {}
  $description = ''
  try { $description = [string]$process.MainModule.FileVersionInfo.FileDescription } catch {}
  return $exePath -match 'WindowsApps[\\/]Claude_' -or $description -match '(?i)Claude'
}

function Test-ClaudeCodeProcessInfo($processInfo) {
  if (-not $processInfo) { return $false }
  $name = [IO.Path]::GetFileNameWithoutExtension([string]$processInfo.Name)
  if ($name -ieq 'claude') {
    $exePath = [string]$processInfo.ExecutablePath
    if ($exePath -match 'WindowsApps[\\/]Claude_') { return $false }
    return $true
  }
  if ($name -notmatch '^(node|nodejs|bun|deno)$') { return $false }
  $commandLine = [string]$processInfo.CommandLine
  return $commandLine -match '(?i)(@anthropic-ai[\\/]claude-code|[\\/]claude-code[\\/].*cli[.](js|cjs|mjs)|[\\/][.]claude[\\/].*claude.*[.](js|cjs|mjs))'
}

function Find-ForegroundClaudeProcesses($foregroundId, $foregroundName, $processes, $claudeIds) {
  if (-not $foregroundId -or -not $claudeIds.Count) { return @() }
  $byId = @{}
  $children = @{}
  foreach ($item in $processes) {
    $id = [int]$item.ProcessId
    $parentId = [int]$item.ParentProcessId
    $byId[$id] = $item
    if (-not $children.ContainsKey($parentId)) { $children[$parentId] = New-Object System.Collections.ArrayList }
    [void]$children[$parentId].Add($id)
  }
  $roots = New-Object System.Collections.ArrayList
  [void]$roots.Add([int]$foregroundId)
  # Klasik konsolda görünür pencere conhost'a aittir; gerçek kabuk onun ebeveynidir.
  if ($foregroundName -match '^(conhost|OpenConsole)$' -and $byId.ContainsKey([int]$foregroundId)) {
    $parentId = [int]$byId[[int]$foregroundId].ParentProcessId
    if ($parentId -gt 0) { [void]$roots.Add($parentId) }
  }
  $queue = New-Object System.Collections.Queue
  foreach ($root in $roots) { $queue.Enqueue([int]$root) }
  $visited = @{}
  while ($queue.Count -gt 0) {
    $id = [int]$queue.Dequeue()
    if ($visited.ContainsKey($id)) { continue }
    $visited[$id] = $true
    if ($children.ContainsKey($id)) {
      foreach ($childId in $children[$id]) { $queue.Enqueue([int]$childId) }
    }
  }
  return @($claudeIds | Where-Object { $visited.ContainsKey([int]$_) })
}

$lastJson = ''
$processSnapshotAt = 0
$processSnapshot = @()
$claudeProcessIds = @()
while ($true) {
  $handle = [AiLimitNativeWindow]::GetForegroundWindow()
  [uint32]$foregroundProcessId = 0
  [void][AiLimitNativeWindow]::GetWindowThreadProcessId($handle, [ref]$foregroundProcessId)
  $rect = New-Object AiLimitNativeWindow+RECT
  $dwmResult = [AiLimitNativeWindow]::DwmGetWindowAttribute($handle, 9, [ref]$rect, [Runtime.InteropServices.Marshal]::SizeOf($rect))
  if ($dwmResult -ne 0) { [void][AiLimitNativeWindow]::GetWindowRect($handle, [ref]$rect) }
  $titleBuffer = New-Object System.Text.StringBuilder 1024
  [void][AiLimitNativeWindow]::GetWindowText($handle, $titleBuffer, $titleBuffer.Capacity)
  $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
  $foregroundPath = ''
  try { $foregroundPath = [string]$foregroundProcess.Path } catch {}
  $productName = ''
  $fileDescription = ''
  try {
    $versionInfo = $foregroundProcess.MainModule.FileVersionInfo
    $productName = [string]$versionInfo.ProductName
    $fileDescription = [string]$versionInfo.FileDescription
  } catch {}
  $codexProcesses = @(
    Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue |
      Where-Object { Test-CodexDesktopProcess $_ }
  )
  $codexOpen = $codexProcesses.Count -gt 0
  $claudeDesktopProcesses = @(
    Get-Process -Name Claude -ErrorAction SilentlyContinue |
      Where-Object { Test-ClaudeDesktopProcess $_ }
  )
  $tick = [Environment]::TickCount64
  if (-not $processSnapshot.Count -or $tick - $processSnapshotAt -ge 1200) {
    $processSnapshotAt = $tick
    $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $claudeProcessIds = @(
      $processSnapshot |
        Where-Object { Test-ClaudeCodeProcessInfo $_ } |
        ForEach-Object { [int]$_.ProcessId }
    )
  }
  $foregroundClaudeProcessIds = @(
    Find-ForegroundClaudeProcesses ([int]$foregroundProcessId) ([string]$foregroundProcess.ProcessName) $processSnapshot $claudeProcessIds
  )
  $terminalLike = [string]$foregroundProcess.ProcessName -match '^(WindowsTerminal|OpenConsole|conhost|cmd|powershell|pwsh|bash|mintty|wezterm|alacritty|code|cursor|orca)$'
  $titleSuggestsClaude = $titleBuffer.ToString() -match '(?i)(^|[^a-z])Claude( Code)?([^a-z]|$)'
  $claudeCodeForeground = $foregroundClaudeProcessIds.Count -gt 0 -or ($claudeProcessIds.Count -gt 0 -and $terminalLike -and $titleSuggestsClaude)
  $snapshot = [ordered]@{
    handle = $handle.ToInt64()
    processId = [int]$foregroundProcessId
    processName = [string]$foregroundProcess.ProcessName
    executablePath = $foregroundPath
    productName = $productName
    fileDescription = $fileDescription
    title = $titleBuffer.ToString()
    minimized = [AiLimitNativeWindow]::IsIconic($handle)
    codexOpen = $codexOpen
    codexProcessIds = @($codexProcesses | ForEach-Object { [int]$_.Id })
    claudeDesktopOpen = $claudeDesktopProcesses.Count -gt 0
    claudeDesktopProcessIds = @($claudeDesktopProcesses | ForEach-Object { [int]$_.Id })
    claudeCodeOpen = $claudeProcessIds.Count -gt 0
    claudeCodeForeground = $claudeCodeForeground
    claudeCodeProcessIds = @($claudeProcessIds)
    foregroundClaudeProcessIds = @($foregroundClaudeProcessIds)
    bounds = [ordered]@{
      x = $rect.Left
      y = $rect.Top
      width = [Math]::Max(0, $rect.Right - $rect.Left)
      height = [Math]::Max(0, $rect.Bottom - $rect.Top)
    }
  }
  $json = $snapshot | ConvertTo-Json -Compress -Depth 4
  if ($json -ne $lastJson) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $lastJson = $json
  }
  Start-Sleep -Milliseconds 400
}
`;

function isCodexWindow(state) {
  if (!state || state.minimized) return false;
  const name = String(state.processName || '').replace(/\.exe$/i, '').toLowerCase();
  const executable = String(state.executablePath || '').toLowerCase();
  const description = `${state.productName || ''} ${state.fileDescription || ''}`.toLowerCase();
  if (name === 'codex') return true;
  if (name !== 'chatgpt') return false;
  return executable.includes('openai.codex_') || /[\\/]codex[\\/]/.test(executable) || description.includes('codex');
}

function isClaudeCodeWindow(state) {
  if (!state || state.minimized) return false;
  if (state.claudeCodeForeground === true) return true;
  const name = String(state.processName || '').replace(/\.exe$/i, '').toLowerCase();
  const terminalLike = /^(windowsterminal|openconsole|conhost|cmd|powershell|pwsh|bash|mintty|wezterm|alacritty|code|cursor|orca)$/.test(name);
  return state.claudeCodeOpen === true && terminalLike && /(^|[^a-z])claude( code)?([^a-z]|$)/i.test(String(state.title || ''));
}

function isClaudeDesktopWindow(state) {
  if (!state || state.minimized) return false;
  const name = String(state.processName || '').replace(/\.exe$/i, '').toLowerCase();
  if (name !== 'claude') return false;
  const executable = String(state.executablePath || '').toLowerCase();
  const description = `${state.productName || ''} ${state.fileDescription || ''}`.toLowerCase();
  return executable.includes('windowsapps\\claude_') || executable.includes('windowsapps/claude_') || description.includes('claude');
}

function overlayBounds(target, size, workArea) {
  if (!target || target.width < 280 || target.height < 140) return null;
  const margin = 16;
  const width = Math.max(250, Math.min(size.width, target.width - margin * 2));
  const height = Math.min(size.height, Math.max(64, target.height - margin * 2));
  let x = target.x + target.width - width - margin;
  // Codex tam ekranda olsa bile Windows kontrol düğmelerinin üstünü kapatma.
  let y = target.y + 46;
  x = Math.min(Math.max(x, workArea.x + 8), workArea.x + workArea.width - width - 8);
  y = Math.min(Math.max(y, workArea.y + 8), workArea.y + workArea.height - height - 8);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

class ForegroundWindowWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.platform = options.platform || process.platform;
    this.stopped = true;
    this.restartTimer = null;
  }

  start() {
    if (this.platform !== 'win32' || !this.stopped) return;
    this.stopped = false;
    this.spawnWatcher();
  }

  spawnWatcher() {
    if (this.stopped || this.child) return;
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const encoded = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    this.child = child;
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.state = JSON.parse(line);
          this.emit('change', this.state);
        } catch { /* PowerShell başlangıç çıktısını yok say. */ }
      }
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      if (!this.stopped) this.restartTimer = setTimeout(() => this.spawnWatcher(), 1500);
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}

module.exports = { ForegroundWindowWatcher, isClaudeCodeWindow, isClaudeDesktopWindow, isCodexWindow, overlayBounds };
