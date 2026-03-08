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
  ; Electrobun setup handles shortcuts, uninstall registry, and app launch
  ExecWait '"$INSTDIR\CBX Tool-Setup.exe"'
SectionEnd
