!include "MUI2.nsh"

!ifdef ICON_PATH
  !define MUI_ICON "${ICON_PATH}"
  !define MUI_UNICON "${ICON_PATH}"
!endif

Name "CBX Tool"
OutFile "CBX-Tool-Windows.exe"
InstallDir "$LOCALAPPDATA\CBX Tool"
RequestExecutionLevel user
ShowInstDetails show

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "setup_extracted\*"
  !ifdef ICON_PATH
    File "${ICON_PATH}"
  !endif

  ; Run electrobun setup (hidden console — avoids stuck terminal)
  nsExec::ExecToLog '"$INSTDIR\CBX Tool-Setup.exe"'

  ; Override shortcuts with explicit icon so all view sizes show correctly
  CreateShortcut "$DESKTOP\CBX Tool.lnk" \
    "$LOCALAPPDATA\com.cbxtool.app\stable\app\bin\launcher.exe" \
    "" "$INSTDIR\installer-icon.ico" 0
  CreateShortcut "$SMPROGRAMS\CBX Tool.lnk" \
    "$LOCALAPPDATA\com.cbxtool.app\stable\app\bin\launcher.exe" \
    "" "$INSTDIR\installer-icon.ico" 0
SectionEnd
