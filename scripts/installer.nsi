!include "MUI2.nsh"

Name "CBX Tool"
OutFile "CBX-Tool-Windows-Installer.exe"
InstallDir "$LOCALAPPDATA\CBX Tool"
RequestExecutionLevel user
ShowInstDetails show

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; Extract electrobun setup files
  SetOutPath "$INSTDIR"
  File /r "setup_extracted\*"

  ; Run electrobun setup (installs app to %APPDATA%\com.cbxtool.app)
  ExecWait '"$INSTDIR\CBXToolSetup.exe"'

  ; Create Start Menu shortcut pointing to installed launcher
  CreateDirectory "$SMPROGRAMS\CBX Tool"
  CreateShortcut "$SMPROGRAMS\CBX Tool\CBX Tool.lnk" \
    "$APPDATA\com.cbxtool.app\stable\app\bin\launcher.exe"
  CreateShortcut "$DESKTOP\CBX Tool.lnk" \
    "$APPDATA\com.cbxtool.app\stable\app\bin\launcher.exe"

  ; Launch the app
  Exec '"$APPDATA\com.cbxtool.app\stable\app\bin\launcher.exe"'
SectionEnd
