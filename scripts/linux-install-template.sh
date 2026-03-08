#!/bin/sh
set -e

APP_ID="com.cbxtool.app"
APP_DIR="$HOME/.local/share/$APP_ID"
LAUNCHER="$APP_DIR/stable/app/bin/launcher"
BIN_LINK="$HOME/.local/bin/cbx-tool"
DESKTOP="$HOME/.local/share/applications/cbx-tool.desktop"
UNINSTALL="$HOME/.local/bin/cbx-tool-uninstall"

# Handle uninstall — triggered either by --uninstall flag or if invoked as cbx-tool-uninstall
if [ "$1" = "--uninstall" ] || [ "$(basename "$0")" = "cbx-tool-uninstall" ]; then
  echo "Uninstalling CBX Tool..."
  rm -rf "$APP_DIR"
  rm -f "$BIN_LINK"
  rm -f "$DESKTOP"
  rm -f "$UNINSTALL"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "CBX Tool uninstalled."
  exit 0
fi

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

# Install uninstall command
cp "$0" "$UNINSTALL"
chmod +x "$UNINSTALL"
echo "Created command: cbx-tool-uninstall"

echo ""
echo "Done! Run 'cbx-tool' or find 'CBX Tool' in your app menu."
echo "To uninstall: cbx-tool-uninstall"
exit 0
