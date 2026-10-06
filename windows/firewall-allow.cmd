@echo off
chcp 65001 >nul
rem Разрешить терминалам подключаться к серверу по Wi-Fi (запускать от имени администратора).
net session >nul 2>&1
if errorlevel 1 (
  echo Запустите этот файл правой кнопкой мыши: "Запуск от имени администратора".
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Performance Warehouse" >nul 2>&1
netsh advfirewall firewall add rule name="Performance Warehouse" dir=in action=allow protocol=TCP localport=8080 profile=private,domain
echo Готово: порт 8080 открыт для локальной сети.
pause
