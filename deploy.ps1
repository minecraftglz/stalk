# stalk 一键部署：把本地改动的文件推到服务器并重启服务
# 用法（在项目根目录 PowerShell 里执行）：
#     .\deploy.ps1              推送 server.js + web/index.html 并重启
#     .\deploy.ps1 -All         连同 package.json 一起推送
#     .\deploy.ps1 -Server root@你的IP -Remote /root/stalk
#
# 前置条件：Windows 10/11 自带的 ssh / scp（首次连接会让你确认指纹并可能需要密码）
param(
    [string]$Server = "root@106.55.151.184",
    [string]$Remote = "/root/stalk",
    [switch]$All
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "→ 上传前端 / 服务端 / AI 知识库到 $Server ..." -ForegroundColor Cyan
scp -r "$root\web"        "${Server}:$Remote/"
scp -r "$root\server\ai"  "${Server}:$Remote/server/"
scp "$root\server\server.js" "${Server}:$Remote/server/server.js"

if ($All) {
    scp "$root\server\package.json" "${Server}:$Remote/server/package.json"
}

Write-Host "→ 重启 stalk 容器 ..." -ForegroundColor Cyan
ssh $Server "docker restart stalk && echo '服务已重启'"

Write-Host "✅ 完成，刷新 https://stalk.minecraftglz.top 查看" -ForegroundColor Green
