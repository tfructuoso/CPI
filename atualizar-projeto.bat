@echo off
cd /d %~dp0

REM === Gera data e hora formatada ===
for /f %%a in ('wmic os get localdatetime ^| find "."') do set dt=%%a
set YYYY=%dt:~0,4%
set MM=%dt:~4,2%
set DD=%dt:~6,2%
set HH=%dt:~8,2%
set MN=%dt:~10,2%

set DATA=%YYYY%-%MM%-%DD%
set HORA=%HH%:%MN%

echo.
echo 🔄 Atualizando projeto do GitHub...

git pull origin main

REM === Grava log local ===
echo [%DATA% %HORA%] Atualização local com git pull>> logs-de-commits.txt

echo.
echo ✅ Projeto atualizado com sucesso!
echo 🕒 %DATA% %HORA%
echo 📝 Log atualizado em logs-de-commits.txt

pause
