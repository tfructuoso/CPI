@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==== Subir projeto (commit + push) ====
git rev-parse --is-inside-work-tree >nul 2>&1 || (
  echo [ERRO] Nao parece ser um repo Git aqui.
  exit /b 1
)

REM Atualiza antes de subir
call "%~dp0atualizar-projeto.bat"
if errorlevel 1 exit /b 1

REM Mensagem de commit
set MSG=%*
if "%MSG%"=="" (
  set /p MSG=Digite a mensagem de commit: 
)
if "%MSG%"=="" (
  for /f "tokens=1-5 delims=/:. " %%a in ("%date% %time%") do (
    set MSG=Atualizacao %date% %time%
  )
)

echo.
git add -A
git status --porcelain >nul
if errorlevel 1 (
  echo [ERRO] git status retornou um erro inesperado.
  exit /b 1
)

for /f %%c in ('git status --porcelain ^| find /c /v ""') do set COUNT=%%c
if "%COUNT%"=="0" (
  echo [INFO] Nao ha alteracoes para commitar.
) else (
  git commit -m "%MSG%"
  if errorlevel 1 (
    echo [ERRO] Commit falhou.
    exit /b 1
  )
)

echo.
git push origin main
if errorlevel 1 (
  echo [ERRO] Push falhou. Tente:
  echo   git pull --rebase --autostash origin main
  echo   git push origin main
  exit /b 1
)

echo.
echo [OK] Projeto enviado com sucesso.
endlocal
exit /b 0
