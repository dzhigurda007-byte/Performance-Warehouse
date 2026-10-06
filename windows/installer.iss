; Установщик Performance Warehouse — сервер склада для Windows (Inno Setup 6)
#define AppVersion GetEnv("PW_VERSION")
#if AppVersion == ""
  #define AppVersion "2.0.0"
#endif

[Setup]
AppId=PerformanceWarehouseServer
AppName=Performance Warehouse — сервер склада
AppVersion={#AppVersion}
AppPublisher=Performance Warehouse
DefaultDirName=C:\PerformanceWarehouse
DisableDirPage=no
DefaultGroupName=Performance Warehouse
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=PerformanceWarehouse-Setup
SetupIconFile=app.ico
UninstallDisplayIcon={app}\app.ico
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
WizardStyle=modern

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Ярлыки на рабочем столе"; GroupDescription: "Ярлыки:"
Name: "autostart"; Description: "Запускать сервер склада при входе в Windows"; GroupDescription: "Запуск:"
Name: "firewall"; Description: "Разрешить подключение терминалов по Wi-Fi (брандмауэр, порт 8080)"; GroupDescription: "Сеть:"

[Dirs]
Name: "{app}\data"; Permissions: users-modify

[Files]
Source: "pkg\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "app.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Сервер склада"; Filename: "{app}\start.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\Рабочее место (браузер)"; Filename: "http://localhost:8080"; IconFilename: "{app}\app.ico"
Name: "{group}\Инструкция"; Filename: "{app}\README.txt"
Name: "{group}\Папка с данными и резервными копиями"; Filename: "{app}\data"
Name: "{group}\Удалить"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Сервер склада"; Filename: "{app}\start.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon
Name: "{autodesktop}\Рабочее место склада"; Filename: "http://localhost:8080"; IconFilename: "{app}\app.ico"; Tasks: desktopicon
Name: "{commonstartup}\Сервер склада"; Filename: "{app}\start.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: autostart

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Performance Warehouse"""; Flags: runhidden; Tasks: firewall
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Performance Warehouse"" dir=in action=allow protocol=TCP localport=8080 profile=private,domain"; Flags: runhidden; Tasks: firewall
Filename: "{app}\start.cmd"; WorkingDir: "{app}"; Description: "Запустить сервер склада сейчас"; Flags: postinstall nowait shellexec skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Performance Warehouse"""; Flags: runhidden; RunOnceId: "fw"

[Messages]
ru.FinishedLabel=Установка завершена. Сервер склада запустится и откроет рабочее место в браузере.%n%nБаза данных хранится в папке data — при удалении программы она сохраняется.
