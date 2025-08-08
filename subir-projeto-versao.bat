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

REM === Solicita mensagem de descrição opcional ===
set /p msg="Digite o que foi alterado: "

REM === Prepara commit automático com data/hora ===
set COMMIT_MSG=Versão %DATA% %HORA% - %msg%

git add .
git commit -m "%COMMIT_MSG%"
git push origin main

REM === Grava log local ===
echo [%DATA% %HORA%] %msg%>> logs-de-commits.txt

echo.
echo ✅ Projeto enviado para o GitHub com sucesso!
echo 🕒 %COMMIT_MSG%
echo 📝 Log atualizado em logs-de-commits.txt

pause
	