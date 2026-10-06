@echo off
chcp 65001 >nul
rem Запускать сервер автоматически при входе в Windows.
schtasks /Create /TN "PerformanceWarehouse" /TR "cmd /c start \"\" /min \"%~dp0start.cmd\"" /SC ONLOGON /F
if errorlevel 1 (echo Не удалось создать задачу автозапуска.) else (echo Автозапуск включён.)
pause
