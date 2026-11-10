# ============================================================
# Stalk Windows Agent
# 监听前台应用并上报到服务器
#
# 使用方法:
#   1. 按需修改下方配置区的 $SERVER_CANDIDATES / $AUTH_KEY
#   2. 双击同目录的 start-windows-agent.bat 启动（推荐）
#   3. (可选) 把该 bat 的快捷方式放进 shell:startup 实现开机自启
# ============================================================

# ============ 配置区 ============
# 后端地址候选：启动时自动探测第一个能连上的（GET /api/health 返回 200）。
#   127.0.0.1:8080       —— 本机自己跑着 stalk 服务端时（本地开发 / 同机部署）
#   服务器公网IP:8080    —— 服务端在别的机器 / 已反代到域名时
# 探测都失败时会用第一个候选并每隔一段时间重试，服务端上线后会自动接上。
$SERVER_CANDIDATES = @(
    "https://stalk.minecraftglz.top",       # 域名走 Cloudflare + Caddy 反代（无需开 8080 端口）
    "http://106.55.151.184:8080",           # 公网 IP 直连（需开放 8080）
    "http://127.0.0.1:8080"                 # 本地兜底
)
$AUTH_KEY    = "aa4fe6712d5dd3f9341788e9039a5b61806e1d86ace9b937f42cc444e8ef0b93"  # 与 server/.env 的 SECRET_KEY 一致
$DEVICE_ID   = "pc-" + $env:USERNAME      # 设备唯一ID
$DEVICE_NAME = $env:COMPUTERNAME          # 显示名称
$DEVICE_TYPE = "computer"                 # computer | phone | pad
$INTERVAL    = 2                          # 轮询间隔（秒）
$HEARTBEAT   = 15                         # 心跳间隔（秒，即使应用没变化也上报一次）
$IDLE_GAMING = 600                        # 空闲超过该秒数判定为「挂机」（默认 10 分钟）
$DESKTOP_GAMING = 600                     # 连续停留在桌面超过该秒数也判定为「挂机」（默认 10 分钟）
# ================================

# ============ 应用识别表 ============
# 按「进程名」匹配。注意 Get-Process 的 ProcessName 是全小写且不带 .exe
# （Edge 是 msedge、微信是 weixin、Trae 是 "trae solo cn"），
# 之前用 *xxx.exe* 的模式一个都匹配不上。
# Name   = 面板显示的应用名
# Phrase = 语气短语，面板会拼成「正在使用 Edge 浏览器 冲浪」
$APP_MAP = @{
    'msedge'            = @{ Name = 'Edge 浏览器';    Phrase = '冲浪' }
    'chrome'            = @{ Name = 'Chrome 浏览器';  Phrase = '冲浪' }
    'firefox'           = @{ Name = 'Firefox 浏览器'; Phrase = '冲浪' }
    'trae'              = @{ Name = 'Trae';           Phrase = '码代码' }
    'trae solo cn'      = @{ Name = 'Trae';           Phrase = '码代码' }
    'code'              = @{ Name = 'VS Code';        Phrase = '写代码' }
    'weixin'            = @{ Name = '微信';           Phrase = '聊天' }
    'wechat'            = @{ Name = '微信';           Phrase = '聊天' }
    'wechatappex'       = @{ Name = '微信';           Phrase = '聊天' }
    'qq'                = @{ Name = 'QQ';             Phrase = '聊天' }
    'wxwork'            = @{ Name = '企业微信';       Phrase = '办公' }
    'dingtalk'          = @{ Name = '钉钉';           Phrase = '办公' }
    'wemeetapp'         = @{ Name = '腾讯会议';       Phrase = '开会' }
    'zoom'              = @{ Name = 'Zoom';           Phrase = '开会' }
    'neteasecloudmusic' = @{ Name = '网易云音乐';     Phrase = '听歌' }
    'cloudmusic'        = @{ Name = '网易云音乐';     Phrase = '听歌' }
    'qqmusic'           = @{ Name = 'QQ 音乐';        Phrase = '听歌' }
    'bilibili'          = @{ Name = '哔哩哔哩';       Phrase = '刷视频' }
    'potplayer'         = @{ Name = 'PotPlayer';      Phrase = '看视频' }
    'potplayermini64'   = @{ Name = 'PotPlayer';      Phrase = '看视频' }
    'vlc'               = @{ Name = 'VLC 播放器';     Phrase = '看视频' }
    'obs64'             = @{ Name = 'OBS';            Phrase = '录屏' }
    'explorer'          = @{ Name = '资源管理器';     Phrase = '翻文件' }
    'winword'           = @{ Name = 'Word';           Phrase = '写文档' }
    'excel'             = @{ Name = 'Excel';          Phrase = '做表格' }
    'powerpnt'          = @{ Name = 'PowerPoint';     Phrase = '做演示' }
    'onenote'           = @{ Name = 'OneNote';        Phrase = '记笔记' }
    'outlook'           = @{ Name = 'Outlook';        Phrase = '收发邮件' }
    'wps'               = @{ Name = 'WPS 文字';       Phrase = '写文档' }
    'et'                = @{ Name = 'WPS 表格';       Phrase = '做表格' }
    'wpp'               = @{ Name = 'WPS 演示';       Phrase = '做演示' }
    'feishu'            = @{ Name = '飞书';           Phrase = '办公' }
    'lark'              = @{ Name = '飞书';           Phrase = '办公' }
    'illustrator'       = @{ Name = 'Illustrator';    Phrase = '画设计稿' }
    'idea64'            = @{ Name = 'IntelliJ IDEA';  Phrase = '码代码' }
    'pycharm64'         = @{ Name = 'PyCharm';        Phrase = '码代码' }
    'webstorm64'        = @{ Name = 'WebStorm';       Phrase = '码代码' }
    'goland64'          = @{ Name = 'GoLand';         Phrase = '码代码' }
    'sublime_text'      = @{ Name = 'Sublime Text';   Phrase = '码代码' }
    'figma'             = @{ Name = 'Figma';          Phrase = '画设计稿' }
    'photoshop'         = @{ Name = 'Photoshop';      Phrase = '修图' }
    'notepad++'         = @{ Name = 'Notepad++';      Phrase = '记东西' }
    'notepad'           = @{ Name = '记事本';         Phrase = '记东西' }
    'cmd'               = @{ Name = '命令提示符';     Phrase = '敲命令' }
    'powershell'        = @{ Name = 'PowerShell';     Phrase = '敲命令' }
    'pwsh'              = @{ Name = 'PowerShell';     Phrase = '敲命令' }
    'windowsterminal'   = @{ Name = 'Windows Terminal'; Phrase = '敲命令' }
    'taskmgr'           = @{ Name = '任务管理器';     Phrase = '看性能' }
    'calc'              = @{ Name = '计算器';         Phrase = '算数' }
    'mspaint'           = @{ Name = '画图';           Phrase = '画画' }
    'photos'            = @{ Name = '照片';           Phrase = '看图' }
    'settings'          = @{ Name = '设置';           Phrase = '调设置' }
    'steam'             = @{ Name = 'Steam';          Phrase = '逛商店' }
    'discord'           = @{ Name = 'Discord';        Phrase = '聊天' }
    'telegram'          = @{ Name = 'Telegram';       Phrase = '聊天' }
}

# 系统浮层 / 输入法候选框，前台出现时不代表"在用某个应用"，直接忽略
$IGNORE_PROCS = @(
    'textinputhost', 'nvidia share', 'shellexperiencehost',
    'startmenuexperiencehost', 'searchhost', 'applicationframehost',
    'lockapp', 'msedgewebview2'
)

# 需要提取「应用内二级信息（detail）」的进程：从窗口标题解析出视频名 / 项目名 / 歌名 / 网页标题 / 文档名。
# 其它应用不提取，避免把无意义的标题（如"此电脑"）当内容上报。
$DETAIL_PROCS = @(
    'bilibili', 'code', 'code - insiders', 'trae', 'trae solo cn',
    'idea64', 'pycharm64', 'webstorm64', 'goland64', 'sublime_text', 'notepad++',
    'neteasecloudmusic', 'cloudmusic', 'qqmusic', 'potplayer', 'potplayermini64', 'vlc',
    'msedge', 'chrome', 'firefox',
    'winword', 'excel', 'powerpnt', 'onenote', 'outlook',
    'wps', 'et', 'wpp',
    'explorer', 'wechat', 'weixin', 'dingtalk', 'feishu', 'lark',
    'photoshop', 'illustrator', 'figma'
)

# 从窗口标题里解析应用内二级信息
function Get-AppDetail {
    param([string]$proc, [string]$title)
    if (-not $title -or -not ($DETAIL_PROCS -contains $proc)) { return '' }
    $d = $title

    if ($proc -in @('msedge', 'chrome', 'firefox')) {
        # 某些浏览器扩展会在标签页标题里追加内存占用（如 " - 内存使用率 - 98.6 MB"），先去掉
        $d = $d -replace '\s*[-–—]\s*内存使用率\s*[-–—]\s*[\d.]+\s*(MB|GB|KB)\s*', ''
        # 再去掉结尾的 " - Microsoft Edge / Google Chrome / Mozilla Firefox"
        $d = $d -replace '\s*[-–—]\s*(Microsoft\s*Edge|Google\s*Chrome|Mozilla\s*Firefox|Firefox|Chromium)\s*$', ''
    }
    elseif ($proc -eq 'bilibili') {
        # "视频名_哔哩哔哩_bilibili" / "视频名 - 哔哩哔哩"
        $d = $d -replace '_哔哩哔哩_bilibili\s*$', ''
        $d = $d -replace '\s*[-–—]\s*哔哩哔哩.*$', ''
    }
    elseif ($proc -in @('code', 'code - insiders', 'trae', 'trae solo cn', 'idea64', 'pycharm64', 'webstorm64', 'goland64', 'sublime_text', 'notepad++')) {
        # "文件 - 项目 - 编辑器名" → 取中间的项目段；只开了项目没开文件时标题即项目名，原样保留
        $parts = $d -split '\s+[-–—]\s+'
        if ($parts.Count -ge 3) { $d = ($parts[1..($parts.Count - 2)] -join ' - ') }
        elseif ($parts.Count -eq 2) { $d = $parts[0] }
        $d = "$($APP_MAP[$proc].Name) - $d"
    }
    elseif ($proc -in @('neteasecloudmusic', 'cloudmusic', 'qqmusic', 'potplayer', 'potplayermini64', 'vlc')) {
        # "歌名 - 歌手" / "视频名 - PotPlayer"，去掉结尾的播放器名
        $d = $d -replace '\s*[-–—]\s*(网易云音乐|CloudMusic|QQ音乐|PotPlayer|VLC.*|mpc-hc.*)\s*$', ''
    }
    elseif ($proc -in @('winword', 'excel', 'powerpnt', 'onenote', 'outlook')) {
        # Office 365: "文件名.docx - Word"；老版本: "Microsoft Word - 文件名"
        $d = $d -replace '\s*[-–—]\s*(Word|Excel|PowerPoint|OneNote|Outlook)\s*$', ''
        $d = $d -replace '^(Microsoft\s+)?(Word|Excel|PowerPoint|OneNote|Outlook)\s+[-–—]\s*', ''
        $d = "$($APP_MAP[$proc].Name) - $d"
    }
    elseif ($proc -in @('wps', 'et', 'wpp')) {
        # WPS: "文件名.docx - WPS Office" / "文件名 - WPS 表格"
        $d = $d -replace '\s*[-–—]\s*(WPS\s*Office|WPS\s*文字|WPS\s*表格|WPS\s*演示|WPS\s+Office.*)\s*$', ''
        $d = "$($APP_MAP[$proc].Name) - $d"
    }
    elseif ($proc -in @('wechat', 'weixin', 'dingtalk', 'feishu', 'lark')) {
        # 聊天窗口："联系人/群聊 - 微信/钉钉/飞书"
        $d = $d -replace '\s*[-–—]\s*(微信|WeChat|钉钉|DingTalk|飞书|Lark)\s*$', ''
    }
    elseif ($proc -eq 'explorer') {
        # 资源管理器：标题通常是当前文件夹名或完整路径
        # 「Program Manager」是桌面窗口（点击桌面时前台窗口），不计入详情
        if ($d -eq 'Program Manager') { return '' }
        # 取最后一段作为文件夹名，并组合成「文件资源管理器 - 文件夹名」
        if ($d -match '[\\/]') { $d = ($d -split '[\\/]')[-1] }
        $d = "文件资源管理器 - $d"
    }
    elseif ($proc -in @('photoshop', 'illustrator', 'figma')) {
        # 设计软件："文件名.psd @ 100% (RGB/8)" → 取文件名
        $d = $d -replace '\s*@.*$', ''
        $d = $d -replace '\s+[-–—]\s+(Adobe\s+Photoshop|Adobe\s+Illustrator|Figma).*$', ''
        $d = "$($APP_MAP[$proc].Name) - $d"
    }

    return $d.Trim()
}

# ============ Win32 API ============
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    // 窗口类名：用来识别桌面（Progman / WorkerW）
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@

# ============ 空闲检测（判断是否长时间不动 = 挂机）============
# GetLastInputInfo 返回最后一次键鼠输入的系统 tick，与当前 tick 相减即空闲毫秒数。
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IdleTime {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [DllImport("kernel32.dll")] public static extern uint GetTickCount();
    public static uint Seconds() {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(lii);
        if (!GetLastInputInfo(ref lii)) return 0;
        return (GetTickCount() - lii.dwTime) / 1000;
    }
}
"@

# ============ Core Audio API（读默认录音设备静音状态）============
# 用来实现「麦克风 未静音 / 已静音」。COM 调用失败时函数返回 -1，上层回落为「未静音」。
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class StalkAudio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        int NotImpl1();
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
        int NotImpl01(); int NotImpl02(); int NotImpl03(); int NotImpl04();
        int NotImpl05(); int NotImpl06(); int NotImpl07(); int NotImpl08();
        int NotImpl09(); int NotImpl10(); int NotImpl11(); int NotImpl12();
        int GetMute(out bool pbMute);
    }

    // dataFlow: 0 = eCapture（录音设备）; role: 0 = eConsole
    public static int GetCaptureMute() {
        try {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice dev;
            int hr = enumerator.GetDefaultAudioEndpoint(0, 0, out dev);
            if (hr != 0 || dev == null) return -1;
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            hr = dev.Activate(ref iid, 23, IntPtr.Zero, out o);
            if (hr != 0 || o == null) return -1;
            bool muted;
            hr = ((IAudioEndpointVolume)o).GetMute(out muted);
            if (hr != 0) return -1;
            return muted ? 1 : 0;
        } catch { return -1; }
    }
}
"@ -ErrorAction SilentlyContinue

# 加载 UI Automation（仅首次）
try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop } catch {}
try { Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop } catch {}

# 通过 UI Automation 获取浏览器「当前激活标签页」的标题。
# 多标签时窗口标题会变成「X 和另外 N 个页面 - 浏览器」，
# 这里直接读选中 TabItem 的 Name，拿到真正的页面标题（如「视频名_哔哩哔哩_bilibili - Google Chrome」）。
function Get-ActiveBrowserTab {
    param([IntPtr]$hwnd)
    if ($hwnd -eq [IntPtr]::Zero) { return '' }
    try {
        $win = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if (-not $win) { return '' }
        $tabCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem)
        $tabs = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
        foreach ($t in $tabs) {
            try {
                $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                if ($sel.Current.IsSelected) { return $t.Current.Name }
            } catch {}
        }
    } catch {}
    return ''
}

# 获取前台窗口标题
function Get-ForegroundApp {
    $hwnd = [Win32]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return @{ Name = "未知"; Process = ""; Path = ""; WindowTitle = ""; Detail = ""; Phrase = ""; Ignore = $false } }
    $sb = New-Object System.Text.StringBuilder 256
    $len = [Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $title = if ($len -gt 0) { $sb.ToString() } else { "" }

    # 尝试获取进程名（注意：不要用 $pid，它是 PowerShell 自动变量）
    $procName = ""
    $procPath = ""
    $procId = 0
    [void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -gt 0) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                $procName = $proc.ProcessName
                # 前台进程 exe 完整路径（面板展示「路径」用）
                try { $procPath = $proc.Path } catch {}
            }
        } catch {}
    }

    # 浏览器：多标签时窗口标题是「X 和另外 N 个页面 - 浏览器」，
    # 改用 UI Automation 读当前激活标签页的真实标题（如「视频名_哔哩哔哩_bilibili - Google Chrome」）
    $key = $procName.ToLower()
    if ($key -in @('msedge', 'chrome', 'firefox')) {
        $tabTitle = Get-ActiveBrowserTab -hwnd $hwnd
        if ($tabTitle) { $title = $tabTitle }
    }

    # 桌面检测：点击桌面时前台窗口是 explorer 的 Progman / WorkerW 窗口，
    # 直接判定为「桌面」，不再误报成「资源管理器 - Program Manager」
    if ($key -eq 'explorer') {
        $clsSb = New-Object System.Text.StringBuilder 256
        [void][Win32]::GetClassName($hwnd, $clsSb, $clsSb.Capacity)
        $cls = $clsSb.ToString()
        if ($cls -eq 'Progman' -or $cls -eq 'WorkerW') {
            return @{
                Name        = '桌面'
                Phrase      = '发呆'
                Process     = 'explorer'
                Path        = $procPath
                Detail      = ''
                WindowTitle = '桌面'
                Ignore      = $false
            }
        }
    }

    # 按进程名查表 → 友好名称 + 语气短语
    $entry = $APP_MAP[$key]
    if ($entry) {
        $friendly = $entry.Name
        $phrase   = $entry.Phrase
    } elseif ($title) {
        # 没命中表时退回窗口标题（信息量更大，例如「某视频 - 某某浏览器」）
        $friendly = $title
        $phrase   = ''
    } else {
        $friendly = $procName
        $phrase   = ''
    }

    return @{
        Name        = $friendly
        Phrase      = $phrase
        Process     = $procName
        Path        = $procPath
        Detail      = (Get-AppDetail -proc $key -title $title)
        WindowTitle = $title
        Ignore      = ($IGNORE_PROCS -contains $key)
    }
}

# 获取系统负载：CPU 占用率(%) + 内存占用率(%)
function Get-SystemStats {
    $cpu = $null
    $mem = $null
    try {
        $p = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -ErrorAction Stop |
             Where-Object { $_.Name -eq '_Total' }
        if ($p) { $cpu = [int]$p.PercentProcessorTime }
    } catch {}
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        if ($os) {
            $total = [double]$os.TotalVisibleMemorySize
            $free  = [double]$os.FreePhysicalMemory
            if ($total -gt 0) { $mem = [math]::Round((($total - $free) / $total) * 100, 1) }
        }
    } catch {}
    return @{ Cpu = $cpu; Mem = $mem }
}

# 麦克风静音状态：读默认录音设备（Core Audio / WASAPI）的 Mute 标志
# 失败时回落为「未静音」（默认状态），保证面板总有值可显示
function Get-MicStatus {
    try {
        $m = [StalkAudio]::GetCaptureMute()
        if ($m -eq 1) { return '已静音' }
        if ($m -eq 0) { return '未静音' }
    } catch {}
    return '未静音'
}

# 获取电池状态（笔记本）
function Get-BatteryInfo {
    try {
        $batt = Get-CimInstance Win32_Battery -ErrorAction Stop
        if ($batt) {
            return @{
                Level = [int]$batt.EstimatedChargeRemaining
                Charging = ($batt.BatteryStatus -eq 2)
            }
        }
    } catch {}
    return @{ Level = $null; Charging = $null }
}

# 检测屏幕是否锁定
function Is-ScreenLocked {
    try {
        $locked = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds -eq $null
    } catch {}
    # 简单方式：检查锁屏进程
    $lockProc = Get-Process -Name "LockApp" -ErrorAction SilentlyContinue
    return ($null -ne $lockProc)
}

# HTTP POST 工具
# 服务端自动探测：依次试候选地址的 /api/health，返回第一个可用的
function Resolve-Server {
    foreach ($u in $SERVER_CANDIDATES) {
        try {
            $r = Invoke-WebRequest -Uri "$u/api/health" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            if ($r.StatusCode -eq 200) { return $u }
        } catch {}
    }
    return $null
}

# 上报失败时隔一会儿再重新探测（节流，避免每次失败都打接口）
$script:Server = $null
$script:LastResolve = 0
function Reset-Server {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if (($now - $script:LastResolve) -lt 30) { return }
    $script:LastResolve = $now
    $s = Resolve-Server
    if ($s -and $s -ne $script:Server) {
        $script:Server = $s
        Write-Host "🔀 切换服务端: $s" -ForegroundColor Magenta
    }
}

function Invoke-PostJson {
    param($Url, $Body)
    try {
        $json = $Body | ConvertTo-Json -Compress -Depth 5
        # 关键：必须显式转成 UTF-8 字节数组发送。
        # PowerShell 5.1 的 Invoke-WebRequest 默认按 ASCII 编码 body，
        # 直接传字符串会把中文（如"微信""网易云音乐"）变成 "?"。
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $headers = @{
            "X-Auth-Key"   = $AUTH_KEY
            "Content-Type" = "application/json; charset=utf-8"
        }
        $resp = Invoke-WebRequest -Uri $Url -Method Post -Headers $headers -Body $bytes -TimeoutSec 5 -ErrorAction Stop
        return $resp.StatusCode -eq 200 -or $resp.StatusCode -eq 201
    } catch {
        Write-Host "  [错误] 上报失败: $($_.Exception.Message)" -ForegroundColor Yellow
        Reset-Server
        return $false
    }
}

# ============ 启动：先探测可用服务端 ============
# 注意：必须放在函数定义之后（PowerShell 自上而下解析），否则 Resolve-Server 还不存在
$script:Server = Resolve-Server
if (-not $script:Server) {
    $script:Server = $SERVER_CANDIDATES[0]
    Write-Host "⚠️  暂未探测到可用服务端，先指向 $($script:Server)，服务端上线后会自动接上" -ForegroundColor Yellow
}

Write-Host "`n👁️  Stalk Windows Agent 启动" -ForegroundColor Cyan
Write-Host "   服务器:   $($script:Server)"
Write-Host "   设备ID:   $DEVICE_ID"
Write-Host "   设备名:   $DEVICE_NAME"
Write-Host "   轮询间隔: $INTERVAL 秒"
Write-Host "   心跳间隔: $HEARTBEAT 秒`n"

# ============ 主循环 ============
Add-Type -AssemblyName System.Windows.Forms

$lastApp = ""
$lastDetail = ""
$lastLock = $false
$lastHeartbeat = 0
$desktopSince = 0   # 连续停留在桌面的起始时间戳（秒），离开桌面时清零

Write-Host "✅ Agent 就绪，开始监听... (Ctrl+C 退出)`n"

while ($true) {
    try {
        $locked = Is-ScreenLocked
        $app = Get-ForegroundApp
        $batt = Get-BatteryInfo
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

        # 输入法候选框、开始菜单等系统浮层不算"在用某个应用"，跳过本轮
        if ($app.Ignore -and -not $locked) {
            Start-Sleep -Seconds $INTERVAL
            continue
        }

        if ($locked -or $app.Process -eq "LockApp") {
            # 锁屏
            if (-not $lastLock) {
                Write-Host "🔒 锁屏事件" -ForegroundColor Gray
                Invoke-PostJson -Url "$script:Server/api/screen-off" -Body @{
                    deviceId   = $DEVICE_ID
                    deviceName = $DEVICE_NAME
                    deviceType = $DEVICE_TYPE
                }
                $lastLock = $true
                $lastApp = "🔒"
            } elseif (($now - $lastHeartbeat) -ge $HEARTBEAT) {
                # 锁屏期间也按心跳保活，否则超过 45 秒会被服务端误判离线
                $result = Invoke-PostJson -Url "$script:Server/api/heartbeat" -Body @{
                    deviceId   = $DEVICE_ID
                    deviceName = $DEVICE_NAME
                    deviceType = $DEVICE_TYPE
                    status     = @{
                        screenState = '已息屏'
                        deviceTime  = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
                    }
                }
                if ($result) { $lastHeartbeat = $now }
            }
        } else {
            if ($lastLock) {
                Write-Host "🔓 解锁" -ForegroundColor Green
                $lastLock = $false
            }

            $idle = [IdleTime]::Seconds()
            # 桌面停留计时：连续停在桌面 ≥ DESKTOP_GAMING 也算挂机（人可能还在，只是发呆）
            if ($app.Name -eq '桌面') {
                if ($desktopSince -eq 0) { $desktopSince = $now }
            } else {
                $desktopSince = 0
            }
            $desktopIdle = ($desktopSince -gt 0) -and (($now - $desktopSince) -ge $DESKTOP_GAMING)
            $desktopSec = if ($desktopSince -gt 0) { $now - $desktopSince } else { 0 }
            # 上报给服务端的空闲秒数取两者较大值，桌面发呆也能显示「挂机 N 分钟」
            $reportedIdle = [Math]::Max([double]$idle, [double]$desktopSec)
            # 长时间无键鼠输入（≥ 阈值）判定为挂机，好处是无论前台停在哪，
            # 只要人离开了都会如实显示「挂机中 N 分钟」
            if ($idle -ge $IDLE_GAMING -or $desktopIdle) {
                $appName   = '💤 挂机中'
                $detail    = ''
                $appPhrase = ''
            } else {
                $appName   = $app.Name
                $detail    = $app.Detail
                $appPhrase = $app.Phrase
            }
            $changed  = ($appName -ne $lastApp)
            # 同一应用里内容变化（换视频 / 切歌 / 换项目）也要上报
            $detailChanged = ($detail -ne $lastDetail)
            $heartbeatDue = ($now - $lastHeartbeat) -ge $HEARTBEAT

            if ($changed -or $detailChanged -or $heartbeatDue) {
                if ($changed) {
                    $doing = if ($appPhrase) { "正在使用 $appName $appPhrase" } else { "正在使用 $appName" }
                    Write-Host "📌 $(Get-Date -Format 'HH:mm:ss') $doing" -ForegroundColor Cyan
                } elseif ($detailChanged -and $detail) {
                    Write-Host "🎬 $(Get-Date -Format 'HH:mm:ss') $detail" -ForegroundColor DarkCyan
                }
                # 富状态：CPU / 内存占用率、麦克风静音、前台 exe 路径、窗口标题
                $stats = Get-SystemStats
                $mic   = Get-MicStatus
                $result = Invoke-PostJson -Url "$script:Server/api/heartbeat" -Body @{
                    deviceId       = $DEVICE_ID
                    deviceName     = $DEVICE_NAME
                    deviceType     = $DEVICE_TYPE
                    appName        = $appName
                    activityPhrase = $appPhrase
                    detail         = $detail
                    packageName    = $app.Process
                    battery        = $batt.Level
                    isCharging     = $batt.Charging
                    idle           = $reportedIdle
                    status         = @{
                        cpu         = $stats.Cpu
                        mem         = $stats.Mem
                        mic         = $mic
                        path        = $app.Path
                        windowTitle = $app.WindowTitle
                        screenState = '正在使用'
                        idleSeconds = $reportedIdle
                        deviceTime  = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
                    }
                }
                if ($result) { $lastHeartbeat = $now }
                $lastApp = $appName
                $lastDetail = $detail
            }
        }
    } catch {
        Write-Host "  [异常] $($_.Exception.Message)" -ForegroundColor Red
    }
    Start-Sleep -Seconds $INTERVAL
}
