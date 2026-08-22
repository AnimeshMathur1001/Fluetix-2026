; Fluetix — Windows installer
; Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
; Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
;
; Requires the front end to already be built (npm run build -> ..\dist)
; before compiling. Auto-installs Python 3.10+ and the GTK3 runtime via
; winget if missing, then creates a private virtual environment for the
; backend — see scripts\install-prereqs.ps1.

#define MyAppName "Fluetix"
#define MyAppVersion "0.7.0"
#define MyAppPublisher "Animesh Mathur, Arihant Kumar Singh, Aviral Gupta"
#define MyAppURL "https://github.com/AnimeshMathur1001/Fluetix-2026"

[Setup]
AppId={{7CBED000-39FD-4F16-BED5-D5AE4CF38FD0}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
VersionInfoDescription={#MyAppName} Setup
VersionInfoCompany={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
InfoBeforeFile=ABOUT.txt
OutputDir=output
OutputBaseFilename=Fluetix-2026-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=assets\fluetix.ico
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\assets\fluetix.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "assets\fluetix.ico"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "..\dist\*"; DestDir: "{app}\dist"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\backend\app\*"; DestDir: "{app}\backend\app"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "__pycache__,*.pyc,data"
Source: "..\backend\requirements.txt"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "..\backend\requirements-desktop.txt"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\NOTICE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\launch.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\fluetix.ico"; Comment: "Launch {#MyAppName} — by Animesh Mathur, Arihant Kumar Singh, Aviral Gupta"
Name: "{group}\Stop {#MyAppName}"; Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\stop.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\fluetix.ico"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\launch.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\fluetix.ico"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-prereqs.ps1"" -AppDir ""{app}"""; StatusMsg: "Installing required components (Python, GTK3 runtime, Python packages) — needs an internet connection and may take several minutes…"; Flags: waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\scripts\launch.ps1"""; Description: "Launch {#MyAppName} now"; Flags: postinstall skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-cleanup.ps1"" -AppDir ""{app}"""; RunOnceId: "FluetixCleanup"; Flags: waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}\venv"
Type: filesandordirs; Name: "{app}\backend\app\data"

[Messages]
FinishedLabel=Setup has finished installing [name] on your computer.%n%nFluetix — Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.%nLicensed under the Apache License, Version 2.0.%n%nThe application may be launched by selecting the installed shortcuts.
