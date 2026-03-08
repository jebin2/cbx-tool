#!/bin/sh
set -e

APP_ID="com.cbxtool.app"
LAUNCHER="$HOME/.local/share/$APP_ID/stable/app/bin/launcher"
BIN_LINK="$HOME/.local/bin/cbx-tool"
DESKTOP="$HOME/.local/share/applications/cbx-tool.desktop"

INSTALLER_TMP=$(mktemp /tmp/cbx-installer-XXXXXX)
tail -n +__LINES__ "$0" | base64 -d > "$INSTALLER_TMP"
chmod +x "$INSTALLER_TMP"
echo "Running CBX Tool installer..."
"$INSTALLER_TMP"
rm -f "$INSTALLER_TMP"

mkdir -p "$HOME/.local/bin"
ln -sf "$LAUNCHER" "$BIN_LINK"
echo "Created command: cbx-tool"

mkdir -p "$HOME/.local/share/applications"
printf '[Desktop Entry]\nName=CBX Tool\nExec=%s\nType=Application\nCategories=Graphics;\n' "$LAUNCHER" > "$DESKTOP"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Created app menu entry"

echo ""
echo "Done! Run 'cbx-tool' or find 'CBX Tool' in your app menu."
exit 0
