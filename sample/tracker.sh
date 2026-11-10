#!/system/bin/sh

# HarmonyOS / 受限环境：AutoTask 调起的 sh 往往 PATH 很窄，
# 先补齐常见可执行目录，否则 command -v 找不到 curl/wget/busybox
export PATH="/data/local/tmp:/system/bin:/system/xbin:/vendor/bin:/su/bin:/sbin:/usr/bin:/usr/sbin:$PATH"

# stalk 移动端上报脚本（供 AutoTask 调用）
# 放置路径：/sdcard/TimeTracker/tracker.sh
# AutoTask 调用方式：
#   sh tracker.sh app_name %s        (当前应用名称)
#   sh tracker.sh batteryLevel %s    (当前电量)
#   sh tracker.sh isCharging true|false
#   sh tracker.sh running true|false
#   sh tracker.sh screen off|on      (屏幕状态：熄屏/亮屏）—— 熄屏时面板显示「熄屏」而非离线
#   sh tracker.sh report             (按本地状态发起一次上报；需要脚本自己能联网)
#   sh tracker.sh url                (只打印完整上报 URL，不发起请求)
#
# 【Pad / 无法联网的 shell】此设备的 sh 里没有任何 HTTP 客户端时会报
#   "no http tool found"。两种解法任选其一（或都做）：
#   路线A（推荐）：让 AutoTask 自己联网。所有 sh 调用加前缀 NO_HTTP=1，
#     脚本只维护本地状态不再尝试联网；再给任务加一个「网络 → HTTP 请求」动作，
#     URL 用 `sh tracker.sh url` 的输出（或直接拼原生变量）。
#   路线B（兜底）：往 /data/local/tmp 丢一个静态 busybox 并 chmod 755，
#     脚本的 find_http_tool 会自动优先使用它，无需改动。

# ===== 只改这几行 =====
URL="https://stalk.minecraftglz.top/api/heartbeat"
DEVICE="phone"          # 设备唯一 ID，多台手机不要重复
NAME="花母鸡的手机"            # 面板上显示的名字
DEVTYPE="android"       # 手机填 android，平板填 pad
# 兜底 dex：pad 上没有 curl/wget 时，用 Android 自带的 app_process 跑 Java 发 HTTPS
APP_PROCESS_DEX="/data/local/tmp/HttpsGet.dex"
# 强制指定 HTTP 工具：留空则自动探测。pad 上若 busybox 有 wget 但无 HTTPS，填 app_process
HTTP_TOOL=""
# =====================

FILE="/sdcard/TimeTracker/tracker.txt"

# 创建目录和状态文件（第 5 段是屏幕状态）
mkdir -p "$(dirname "$FILE")"
if [ ! -f "$FILE" ]; then
    echo "系统桌面,100,false,true,亮屏" > "$FILE"
fi

TYPE="$1"
shift
VALUE="$*"    # 应用名可能带空格，用 $* 收完整

CONTENT=$(cat "$FILE")
APP_NAME=$(echo "$CONTENT" | cut -d',' -f1)
BATTERY_LEVEL=$(echo "$CONTENT" | cut -d',' -f2)
IS_CHARGING=$(echo "$CONTENT" | cut -d',' -f3)
RUNNING=$(echo "$CONTENT" | cut -d',' -f4)
SCREEN=$(echo "$CONTENT" | cut -d',' -f5)
[ -z "$SCREEN" ] && SCREEN="亮屏"

# URL 编码：用 od 把每个字节转成 %XX，兼容没有 read -n1 的精简 shell（如 HarmonyOS）
urlencode() {
    printf '%s' "$1" | od -An -tx1 | tr -d ' \n' | sed 's/\(..\)/%\1/g'
}

# 查找可用的 HTTP 工具，返回一段「请求命令模板」（word-split 后可执行）：
#   curl / wget / busybox wget / toybox wget / /data/local/tmp/busybox wget ...
# 说明：用户自备的静态 busybox 是可执行多路复用器，必须写成「busybox wget」而不是直接当 wget 用
find_http_tool() {
    command -v curl >/dev/null 2>&1 && { echo "curl"; return; }
    command -v wget >/dev/null 2>&1 && { echo "wget"; return; }
    # 系统原生 Java 兜底：放在自备 busybox 之前。
    # 很多静态 busybox 的 wget 不带 TLS，用它会直接 TLS handshake failure；
    # app_process 走系统 Java 的 HTTPS 栈，反而更可靠。
    if [ -f "$APP_PROCESS_DEX" ] && [ -x /system/bin/app_process ]; then echo "app_process"; return; fi
    # 自备静态二进制（下载的 busybox/curl 一般放 /data/local/tmp，需 chmod 755 且是静态链接）
    [ -x /data/local/tmp/curl ] && { echo "/data/local/tmp/curl"; return; }
    for b in /data/local/tmp/busybox /system/bin/busybox /system/xbin/busybox; do
        if [ -x "$b" ] && "$b" 2>/dev/null | grep -qw wget; then echo "$b wget"; return; fi
    done
    if command -v busybox >/dev/null 2>&1 && busybox 2>/dev/null | grep -qw wget; then echo "busybox wget"; return; fi
    if command -v toybox >/dev/null 2>&1 && toybox 2>/dev/null | grep -qw wget; then echo "toybox wget"; return; fi
}

# 由本地状态拼出完整上报 URL（供 url 子命令 / AutoTask 的 HTTP 请求动作使用）
build_url() {
    if [ "$IS_CHARGING" = "true" ]; then CHG=1; else CHG=0; fi
    QS="device=$(urlencode "$DEVICE")"
    QS="$QS&name=$(urlencode "$NAME")"
    QS="$QS&type=$DEVTYPE"
    QS="$QS&pkg=$(urlencode "$APP_NAME")"
    QS="$QS&bat=$(urlencode "$BATTERY_LEVEL")"
    QS="$QS&chg=$CHG"
    QS="$QS&scr=$(urlencode "$SCREEN")"
    printf '%s?%s' "$URL" "$QS"
}

# stalk 的移动端接口是 GET。优先 curl（--data-urlencode 最稳），其余用 wget + 手动编码
do_report() {
    # NO_HTTP=1：本机 sh 没有可用的 HTTP 客户端，联网交给 AutoTask 的「HTTP 请求」动作
    if [ "$NO_HTTP" = "1" ]; then return 0; fi
    if [ "$IS_CHARGING" = "true" ]; then CHG=1; else CHG=0; fi
    TOOL="$HTTP_TOOL"
    [ -z "$TOOL" ] && TOOL=$(find_http_tool)
    QS="device=$(urlencode "$DEVICE")"
    QS="$QS&name=$(urlencode "$NAME")"
    QS="$QS&type=$DEVTYPE"
    QS="$QS&pkg=$(urlencode "$APP_NAME")"
    QS="$QS&bat=$(urlencode "$BATTERY_LEVEL")"
    QS="$QS&chg=$CHG"
    QS="$QS&scr=$(urlencode "$SCREEN")"
    case "$TOOL" in
        *curl)
            # TOOL 不加引号，交给 shell 拆分（兼容 "/data/local/tmp/curl"）
            $TOOL -s -G "$URL" \
                --data-urlencode "device=$DEVICE" \
                --data-urlencode "name=$NAME" \
                --data-urlencode "type=$DEVTYPE" \
                --data-urlencode "pkg=$APP_NAME" \
                --data-urlencode "bat=$BATTERY_LEVEL" \
                --data-urlencode "chg=$CHG" \
                --data-urlencode "scr=$SCREEN" >/dev/null 2>&1
            ;;
        *wget)
            # TOOL 可能是「busybox wget」/「toybox wget」，不加引号以拆成命令 + 子命令
            $TOOL -q -O - "$URL?$QS" >/dev/null 2>&1
            ;;
        app_process)
            # 用系统 Java 虚拟机发 HTTPS，兼容没有 curl/wget 的 HarmonyOS pad
            CLASSPATH="$APP_PROCESS_DEX" /system/bin/app_process /system/bin HttpsGet "$URL?$QS" >/dev/null 2>&1
            ;;
        *)
            echo "ERROR: no http tool found (tried curl/wget, busybox/toybox, /data/local/tmp, app_process)" >&2
            return 1
            ;;
    esac
}

case "$TYPE" in
    "app_name")
        APP_NAME="$VALUE"
        # 有前台应用通常意味着亮屏，但若刚刚上报过熄屏（xtsk 顺序：screen off → app_name → report），
        # 不要把熄屏标记覆盖掉，否则 report 会误报亮屏，导致「正在使用中」残留
        if [ "$SCREEN" != "已息屏" ]; then SCREEN="亮屏"; fi
        echo "$APP_NAME,$BATTERY_LEVEL,$IS_CHARGING,$RUNNING,$SCREEN" > "$FILE"
        # 应用切换时立即上报，不等 AutoTask 后续再调 report。
        # pad/手机若只配了 app_name 事件（没有 report），不加这一行就会「切了应用但面板不变」。
        # 熄屏时不发：熄屏已由 screen 分支上报，避免重复请求。
        if [ "$SCREEN" != "已息屏" ]; then do_report; fi
        ;;
    "batteryLevel")
        BATTERY_LEVEL="$VALUE"
        echo "$APP_NAME,$BATTERY_LEVEL,$IS_CHARGING,$RUNNING,$SCREEN" > "$FILE"
        ;;
    "isCharging")
        IS_CHARGING="$VALUE"
        echo "$APP_NAME,$BATTERY_LEVEL,$IS_CHARGING,$RUNNING,$SCREEN" > "$FILE"
        ;;
    "running")
        RUNNING="$VALUE"
        echo "$APP_NAME,$BATTERY_LEVEL,$IS_CHARGING,$RUNNING,$SCREEN" > "$FILE"
        ;;
    "screen")
        # 归一化：off/0/熄屏/息屏/锁屏 → 已息屏；其余 → 亮屏
        case "$VALUE" in
            off|0|熄屏|息屏|锁屏|已息屏|screen_off|false) SCREEN="已息屏" ;;
            *) SCREEN="亮屏" ;;
        esac
        echo "$APP_NAME,$BATTERY_LEVEL,$IS_CHARGING,$RUNNING,$SCREEN" > "$FILE"
        do_report   # 熄屏/亮屏立即上报一次，面板状态即时更新
        ;;
    "report")
        do_report
        ;;
    "url")
        # 只打印完整上报 URL，不发起任何请求。
        # 供 AutoTask「网络 → HTTP 请求」动作直接取用（shell 输出捕获到变量），
        # 这样即使 pad 的 sh 不能联网，也能由 AutoTask 代为上报。
        build_url
        echo
        ;;
    *)
        echo "未知类型: $TYPE"
        exit 1
        ;;
esac
