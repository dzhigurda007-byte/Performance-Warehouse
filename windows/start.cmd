@echo off
chcp 65001 >nul
title Performance Warehouse - server
cd /d "%~dp0"
echo.
echo   Performance Warehouse - локальный сервер склада
echo   Рабочее место откроется в браузере: http://localhost:8080
echo   Не закрывайте это окно, пока работает склад.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080"
"%~dp0node\node.exe" --disable-warning=ExperimentalWarning "%~dp0pw-server.cjs" --port 8080 --data "%~dp0data" --web "%~dp0web"
echo.
echo   Сервер остановлен.
pause
