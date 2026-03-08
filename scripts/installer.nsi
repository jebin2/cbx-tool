!include "MUI2.nsh"

Name "CBX Tool"
OutFile "CBX-Tool-Windows-Installer.exe"
InstallDir "$LOCALAPPDATA\CBX Tool"
RequestExecutionLevel user
ShowInstDetails show

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "setup_extracted\*"
  ExecWait '"$INSTDIR\CBXToolSetup.exe"'
SectionEnd
