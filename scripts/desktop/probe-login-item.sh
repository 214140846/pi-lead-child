#!/bin/sh
# P0-7 的实测工具（docs/desktop/p0-7-measurements.md）：装一个用 lead-agent 启动的 LaunchAgent，看两件事：
#   1. 「已添加后台项目」通知和「系统设置 → 通用 → 登录项与扩展」里显示的名字；
#   2. 由 launchd 拉起的进程调 osascript 发的通知，在通知中心里显示的来源（daemon 发通知的方式，参数和
#      apps/daemon/src/desktop-notifier.ts 的 OSASCRIPT_NOTIFY_ARGS 一样）。
# lead-agent 是本机 Node 的一份副本，改了名字，保留 Node 官方的签名，和运行包里的 bin/lead-agent 一样。
# 它用单独的 label，不碰正在运行的 supervisor 和 hindsight。看完以后运行 remove，删掉 label、plist 和目录。
#
#   sh scripts/desktop/probe-login-item.sh install
#   sh scripts/desktop/probe-login-item.sh remove
set -eu

LABEL="com.bytezard.plc.probe"
PROBE_DIR="$HOME/Library/Application Support/Bytezard Lead Probe"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

install_probe() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    echo "$LABEL is already loaded. Run: sh scripts/desktop/probe-login-item.sh remove" >&2
    exit 1
  fi
  node_path="$(node -p 'process.execPath')"
  mkdir -p "$PROBE_DIR/bin" "$HOME/Library/LaunchAgents"
  cp "$node_path" "$PROBE_DIR/bin/lead-agent"
  cat > "$PROBE_DIR/probe.cjs" <<'EOF'
// 起来以后用 osascript 发一条通知（和 daemon 一样的参数），然后一直空等，让登录项保持在列表里。
const { execFile } = require("node:child_process");
execFile("osascript", [
  "-e", "on run argv",
  "-e", "display notification (item 1 of argv) with title (item 2 of argv)",
  "-e", "end run",
  "This is a test notification sent the way the background service sends it.", "Paimon",
], (error) => { if (error) console.error(`osascript failed: ${error.message}`); else console.log("osascript sent"); });
setInterval(() => {}, 1 << 30);
EOF
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PROBE_DIR/bin/lead-agent</string>
    <string>$PROBE_DIR/probe.cjs</string>
  </array>
  <key>WorkingDirectory</key><string>$PROBE_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>$PROBE_DIR/probe.log</string>
  <key>StandardErrorPath</key><string>$PROBE_DIR/probe.log</string>
</dict>
</plist>
EOF
  plutil -lint "$PLIST"
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo
  echo "Loaded $LABEL with $PROBE_DIR/bin/lead-agent (a copy of $node_path)."
  echo "Signature of lead-agent:"
  codesign -dv "$PROBE_DIR/bin/lead-agent" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Signature)=' || true
  echo
  echo "Now record, with screenshots:"
  echo "  1. the 'Background Items Added' notification and the name it shows;"
  echo "  2. System Settings > General > Login Items & Extensions: the name under 'Allow in the Background';"
  echo "  3. the test notification titled Paimon, and its source in Notification Center."
  echo "Log: $PROBE_DIR/probe.log"
  echo "Then run: sh scripts/desktop/probe-login-item.sh remove"
}

remove_probe() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$PROBE_DIR"
  echo "Removed $LABEL, its plist and $PROBE_DIR."
}

case "${1:-}" in
  install) install_probe ;;
  remove) remove_probe ;;
  *) echo "usage: sh scripts/desktop/probe-login-item.sh install|remove" >&2; exit 2 ;;
esac
