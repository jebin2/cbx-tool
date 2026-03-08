!include "MUI2.nsh"

Name "CBX Tool"
OutFile "CBX-Tool-Windows.exe"
InstallDir "$LOCALAPPDATA\CBX Tool"
RequestExecutionLevel user
ShowInstDetails show

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; Extract electrobun setup files (preserves .installer/ subfolder)
  SetOutPath "$INSTDIR"
  File /r "setup_extracted\*"

  ; Run electrobun setup — keep original filename so it finds CBX Tool-Setup.tar.zst
  ExecWait '"$INSTDIR\CBX Tool-Setup.exe"'

  ; Create Start Menu and Desktop shortcuts
  Var /GLOBAL launcher
  StrCpy $launcher "$LOCALAPPDATA\com.cbxtool.app\stable\app\bin\launcher.exe"

  CreateDirectory "$SMPROGRAMS\CBX Tool"
  CreateShortcut "$SMPROGRAMS\CBX Tool\CBX Tool.lnk" "$launcher"
  CreateShortcut "$DESKTOP\CBX Tool.lnk" "$launcher"

  ; Launch the app
  Exec '"$launcher"'
SectionEnd
