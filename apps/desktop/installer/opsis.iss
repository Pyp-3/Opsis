; Opsis per-user Windows installer. scripts/package-desktop.mjs compiles it with
; /DAppVersion, /DNumericVersion, /DStageDir, /DOutputDir and /DOutputName.
; Installing per user needs no administrator rights, so in-app updates can
; replace the application silently.

#define AppName "Opsis"

[Setup]
; Never change AppId: it links upgrades and the uninstaller to earlier installs.
AppId={{6B0F3C1E-5C1A-4F55-9E2B-0A7D9C3E4F21}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
VersionInfoVersion={#NumericVersion}
AppPublisher=Opsis
AppPublisherURL=https://github.com/Pyp-3/Opsis
AppSupportURL=https://github.com/Pyp-3/Opsis/issues
AppUpdatesURL=https://github.com/Pyp-3/Opsis/releases
DefaultDirName={localappdata}\Programs\Opsis
DisableDirPage=yes
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile=..\winres\icon.ico
UninstallDisplayIcon={app}\opsis.exe
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Updates run while Opsis is closing; let Restart Manager finish closing it.
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The same staged files as the portable zip: opsis.exe, README, notices, release.json.
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[INI]
; Marks this copy as installed so the app may update itself (see internal/updater).
Filename: "{app}\installed-by-setup"; Section: "Opsis"; Key: "Version"; String: "{#AppVersion}"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\opsis.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\opsis.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\opsis.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; In-app updates install silently with /relaunch=1 and reopen the application.
Filename: "{app}\opsis.exe"; Flags: nowait runasoriginaluser; Check: Relaunch

[UninstallDelete]
Type: files; Name: "{app}\installed-by-setup"

[Code]
function Relaunch: Boolean;
begin
  Result := WizardSilent and (ExpandConstant('{param:relaunch|0}') = '1');
end;
