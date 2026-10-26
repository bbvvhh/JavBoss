# 构建 Windows x86_64 发布包（可直接运行的目录 + zip）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 v2.3.0
#   powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Version v2.3.0 -SkipWebBuild
#
# 构建依赖（缺失时直接报错，不自动下载）：
#   go          Go 工具链（CGO_ENABLED=1）
#   gcc         64 位 MinGW-w64 gcc（或设置 CC；x86_64-w64-mingw32-gcc 亦可）
#   node/npm    构建 web 与 web-mobile（-SkipWebBuild 时可省略）
#
# 如果仓库内存在 .tools\goenv.ps1，脚本会自动加载 .tools 下的 Go 与 w64devkit，
# 不依赖系统 PATH；否则再回退到系统 PATH 中的 go / gcc。
#
# 运行时资源需提前放在 bin/windows-x86_64/：
#   ffprobe.exe、mpv/mpv.exe
#   （可执行：bash scripts/cli.sh download-dependencies windows-x86_64）
#
# 产物：
#   release/javboss-<VERSION>-windows-x86_64/          可直接运行的目录
#   release/javboss-<VERSION>-windows-x86_64.zip        发布包（顶层含同名目录）
#   release/javboss-<VERSION>-windows-x86_64.zip.sha256
param(
  [Parameter(Position = 0)]
  [string]$Version,

  # 复用现有 web/dist、web-mobile/dist，跳过 npm 构建
  [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ScriptDir = $PSScriptRoot
$RootDir = Split-Path -Parent $ScriptDir
$ReleaseDir = Join-Path $RootDir "release"
$PlatformLabel = "windows-x86_64"
$BinDir = Join-Path $RootDir (Join-Path "bin" $PlatformLabel)
$ToolsDir = Join-Path $RootDir ".tools"

function Say([string]$Message) {
  Write-Host "[windows] $Message"
}

function Fail([string]$Message) {
  throw $Message
}

function Resolve-Version([string]$Value) {
  if ($Value) {
    return $Value.Trim()
  }
  $installPs1 = Join-Path $ScriptDir "install.ps1"
  if (Test-Path -LiteralPath $installPs1) {
    $match = Select-String -LiteralPath $installPs1 -Pattern '^\s*\$Version\s*=\s*"([^"]+)"' |
      Select-Object -First 1
    if ($match) {
      return $match.Matches[0].Groups[1].Value
    }
  }
  Fail "无法从 scripts/install.ps1 推断版本号，请显式传入，如 v2.3.0"
}

function Require-Command([string]$Name, [string]$Hint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    Fail "缺少命令 $Name。$Hint"
  }
  return $command.Source
}

# 优先使用仓库内的 .tools（goenv.ps1 会配置 GOROOT、模块缓存、gcc 等），
# 没有 .tools 时再回退到系统 PATH。
function Import-LocalToolsEnvironment {
  $goEnvScript = Join-Path $ToolsDir "goenv.ps1"
  if (-not (Test-Path -LiteralPath $goEnvScript)) {
    return
  }
  Say "加载本地 Go 环境：$goEnvScript"
  . $goEnvScript
}

function Resolve-Go {
  $command = Get-Command "go" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $localGo = Join-Path $ToolsDir "go\bin\go.exe"
  if (Test-Path -LiteralPath $localGo) {
    $env:GOROOT = Join-Path $ToolsDir "go"
    $env:PATH = "$(Join-Path $ToolsDir 'go\bin');$env:PATH"
    return $localGo
  }
  Fail "缺少 go。请确认 .tools\goenv.ps1 或 .tools\go\bin\go.exe 存在，或将 Go 加入 PATH。"
}

function Resolve-Npm {
  $command = Get-Command "npm" -ErrorAction SilentlyContinue
  if (-not $command) {
    Fail "缺少 npm。请安装 Node.js 并加入 PATH。"
  }
  # PowerShell 的 npm.ps1 受执行策略限制，优先使用同目录下的 npm.cmd。
  if ($command.Source -like "*.ps1") {
    $cmdPath = Join-Path (Split-Path -Parent $command.Source) "npm.cmd"
    if (Test-Path -LiteralPath $cmdPath) {
      return $cmdPath
    }
  }
  return $command.Source
}

function Resolve-CCompiler {
  if ($env:CC) {
    return $env:CC
  }
  $localGcc = Join-Path $ToolsDir "w64devkit\bin\gcc.exe"
  if (Test-Path -LiteralPath $localGcc) {
    return $localGcc
  }
  foreach ($name in @("x86_64-w64-mingw32-gcc", "gcc")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }
  Fail "缺少 64 位 MinGW-w64 gcc。请确认 .tools\w64devkit\bin\gcc.exe 存在，安装 MinGW-w64 并加入 PATH，或设置 CC 环境变量。"
}

function Invoke-Npm([string]$Npm, [string]$WorkingDirectory, [string[]]$Arguments) {
  Push-Location $WorkingDirectory
  try {
    & $Npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      Fail "npm $($Arguments -join ' ') 失败（退出码 $LASTEXITCODE）：$WorkingDirectory"
    }
  } finally {
    Pop-Location
  }
}

function Build-Frontend([string]$Npm, [string]$Directory, [string]$Label, [string]$ViteVersion) {
  if (-not (Test-Path -LiteralPath (Join-Path $Directory "node_modules"))) {
    $installArgs = if (Test-Path -LiteralPath (Join-Path $Directory "package-lock.json")) {
      @("ci")
    } else {
      @("install")
    }
    Say "安装依赖：$Directory"
    Invoke-Npm -Npm $Npm -WorkingDirectory $Directory -Arguments $installArgs
  }

  Say "构建$Label"
  $previous = $env:VITE_APP_VERSION
  try {
    if ($ViteVersion) {
      $env:VITE_APP_VERSION = $ViteVersion
    } else {
      Remove-Item Env:VITE_APP_VERSION -ErrorAction SilentlyContinue
    }
    Invoke-Npm -Npm $Npm -WorkingDirectory $Directory -Arguments @("run", "build")
  } finally {
    if ($null -eq $previous) {
      Remove-Item Env:VITE_APP_VERSION -ErrorAction SilentlyContinue
    } else {
      $env:VITE_APP_VERSION = $previous
    }
  }
}

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) {
    Fail "缺少 $Source"
  }
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Write-ReleaseConfig([string]$Directory) {
  $content = @(
    "# JavBoss release config",
    "# This file uses TOML format.",
    "# The default browser URL is http://localhost:8655.",
    "# Set server_url to run as a client connected to another JavBoss server.",
    "# You can override server_url at startup with --server-url <URL>.",
    "# Leave server_url empty to run in server mode.",
    "# You can override port at startup with --port <PORT>.",
    'server_url = ""',
    "port = 8655",
    ""
  ) -join "`r`n"
  $ascii = New-Object System.Text.ASCIIEncoding
  [System.IO.File]::WriteAllText((Join-Path $Directory "config.toml"), $content, $ascii)
}

# ZipFile.CreateFromDirectory 在 Windows PowerShell 5.1（.NET Framework）下会把
# 条目分隔符写成反斜杠，不符合 zip 规范，跨平台解压会出问题。这里手动写入
# 正斜杠路径，并保留顶层目录名，与官方发布包结构一致。
function New-ReleaseZip([string]$SourceDirectory, [string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path.TrimEnd('\', '/')
  $baseName = Split-Path -Leaf $sourceRoot
  $stream = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::Create)
  try {
    $archive = [System.IO.Compression.ZipArchive]::new(
      $stream,
      [System.IO.Compression.ZipArchiveMode]::Create,
      $true
    )
    try {
      foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force) {
        $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart('\', '/') -replace '\\', '/'
        $entry = $archive.CreateEntry(
          $baseName + "/" + $relative,
          [System.IO.Compression.CompressionLevel]::Optimal
        )
        $entryStream = $entry.Open()
        try {
          $input = [System.IO.File]::OpenRead($file.FullName)
          try {
            $input.CopyTo($entryStream)
          } finally {
            $input.Dispose()
          }
        } finally {
          $entryStream.Dispose()
        }
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Invoke-Build {
  $resolvedVersion = Resolve-Version $Version
  if ($resolvedVersion -notmatch '^v?\d+\.\d+\.\d+') {
    Fail "版本号格式不合法：$resolvedVersion"
  }

  Say "版本：$resolvedVersion"
  Say "仓库：$RootDir"

  Import-LocalToolsEnvironment
  $go = Resolve-Go
  $cc = Resolve-CCompiler
  $npm = $null
  if (-not $SkipWebBuild) {
    Require-Command "node" "请安装 Node.js 并加入 PATH。" | Out-Null
    $npm = Resolve-Npm
  }

  $webDir = Join-Path $RootDir "web"
  $mobileDir = Join-Path $RootDir "web-mobile"
  $webDist = Join-Path $webDir "dist"
  $mobileDist = Join-Path $mobileDir "dist"
  $hasMobile = Test-Path -LiteralPath (Join-Path $mobileDir "package.json")

  if ($SkipWebBuild) {
    Say "已指定 -SkipWebBuild，复用现有前端产物"
  } else {
    Build-Frontend -Npm $npm -Directory $webDir -Label " PC 前端"
    if ($hasMobile) {
      Build-Frontend -Npm $npm -Directory $mobileDir -Label "移动端前端" -ViteVersion $resolvedVersion
    } else {
      Say "未找到 web-mobile，跳过移动端构建"
    }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $webDist "index.html"))) {
    Fail "缺少 web/dist/index.html，请去掉 -SkipWebBuild 或先执行 cd web && npm install && npm run build"
  }
  if ($hasMobile -and -not (Test-Path -LiteralPath (Join-Path $mobileDist "index.html"))) {
    Fail "缺少 web-mobile/dist/index.html，请去掉 -SkipWebBuild 或先构建移动端"
  }

  $ffprobe = Join-Path $BinDir "ffprobe.exe"
  $mpvDir = Join-Path $BinDir "mpv"
  if (-not (Test-Path -LiteralPath $ffprobe)) {
    Fail "缺少 $ffprobe，请先执行：bash scripts/cli.sh download-dependencies windows-x86_64"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $mpvDir "mpv.exe"))) {
    Fail "缺少 $mpvDir\mpv.exe，请先执行：bash scripts/cli.sh download-dependencies windows-x86_64"
  }
  # 与 scripts/cli 的依赖校验保持一致，避免把旧版本 ffprobe 打进包。
  $ffprobeExpected = "fc37ca23d31ee08bb8f7e108edf3822f6ef3efc1a8d306bbe0b779190230710b"
  $ffprobeActual = (Get-FileHash -LiteralPath $ffprobe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ffprobeActual -ne $ffprobeExpected) {
    Fail "ffprobe.exe 校验失败（版本不匹配），请重新执行：bash scripts/cli.sh download-dependencies windows-x86_64"
  }

  New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
  $outDir = Join-Path $ReleaseDir ("javboss-" + $resolvedVersion + "-" + $PlatformLabel)
  $dataDir = Join-Path $outDir "data"
  $dataBackup = $null
  if (Test-Path -LiteralPath $dataDir) {
    # 输出目录里可能放着运行数据，先移出，打包完成后放回。
    $dataBackup = $outDir + ".data.bak"
    if (Test-Path -LiteralPath $dataBackup) {
      Remove-Item -LiteralPath $dataBackup -Recurse -Force
    }
    Say "检测到 $dataDir，先临时移出，打包完成后放回（data 不进 zip）"
    Move-Item -LiteralPath $dataDir -Destination $dataBackup
  }

  try {
    if (Test-Path -LiteralPath $outDir) {
      Remove-Item -LiteralPath $outDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Join-Path $outDir "internal\bin") -Force | Out-Null

    $exePath = Join-Path $outDir "javboss.exe"
    Say "构建后端 (windows/amd64)"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $env:CGO_ENABLED = "1"
    $env:CC = $cc
    Push-Location $RootDir
    try {
      & $go build "-ldflags" "-s -w -X main.buildMode=release" "-o" $exePath "./cmd/server"
      if ($LASTEXITCODE -ne 0) {
        Fail "go build 失败（退出码 $LASTEXITCODE）"
      }
    } finally {
      Pop-Location
    }
    if (-not (Test-Path -LiteralPath $exePath)) {
      Fail "构建结束但未生成 $exePath"
    }

    Say "复制前端资源"
    Copy-Tree -Source $webDist -Destination (Join-Path $outDir "web\dist")
    if ($hasMobile) {
      Copy-Tree -Source $mobileDist -Destination (Join-Path $outDir "web-mobile\dist")
    }

    Say "复制 ffprobe 与 mpv"
    Copy-Item -LiteralPath $ffprobe -Destination (Join-Path $outDir "internal\bin\ffprobe.exe") -Force
    Copy-Tree -Source $mpvDir -Destination (Join-Path $outDir "internal\bin\mpv")

    $modernzDir = Join-Path $RootDir "modernz"
    if (Test-Path -LiteralPath $modernzDir) {
      Say "复制 ModernZ OSC"
      Copy-Tree -Source $modernzDir -Destination (Join-Path $outDir "modernz")
    } else {
      Say "未找到 modernz，跳过 ModernZ OSC"
    }

    Say "生成默认配置文件"
    Write-ReleaseConfig $outDir

    $zipPath = Join-Path $ReleaseDir ("javboss-" + $resolvedVersion + "-" + $PlatformLabel + ".zip")
    Say "打包 zip"
    if (Test-Path -LiteralPath $zipPath) {
      Remove-Item -LiteralPath $zipPath -Force
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    New-ReleaseZip -SourceDirectory $outDir -ZipPath $zipPath

    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($zipPath + ".sha256", $hash, $utf8NoBom)

    Say "完成："
    Say "  目录：$outDir"
    Say "  包体：$zipPath"
    Say "  校验：$zipPath.sha256"
  } finally {
    if ($dataBackup -and (Test-Path -LiteralPath $dataBackup)) {
      Move-Item -LiteralPath $dataBackup -Destination $dataDir
      Say "已把原有 data 放回 $dataDir（未打进 zip）"
    }
  }
}

try {
  Invoke-Build
} catch {
  [Console]::Error.WriteLine("[windows] 错误：$($_.Exception.Message)")
  exit 1
}
