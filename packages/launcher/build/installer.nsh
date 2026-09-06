; Picked up by electron-builder (nsis.include). customInit runs in .onInit
; right after electron-builder has chosen $INSTDIR: the folder recorded in
; the registry by an earlier install, else its own default under
; %LOCALAPPDATA%\Programs. It is skipped in the uninstaller-build pass, and
; it writes nothing itself; the install section records $INSTDIR as usual.
;
; Fresh installs follow the publisher convention from CONTEXT.md:
; <system drive>\Hyped Games\Yufa Launcher, next to the game's default
; <system drive>\Hyped Games\ToS Classic. A machine that already has the
; launcher keeps its folder: self-update runs this installer silently, and
; the old uninstaller must find the files where it left them. Moving such an
; install is a one-time uninstall + reinstall (see GOLIVE.md). An explicit
; /D=<dir> on the command line still wins, as it does for electron-builder.
!macro customInit
  ${If} $PerUserInstallationFolder == ""
    !insertmacro GetDParameter $R0
    ${If} $R0 == ""
      StrCpy $1 $WINDIR 2
      StrCpy $INSTDIR "$1\Hyped Games\Yufa Launcher"
    ${EndIf}
  ${EndIf}
!macroend
