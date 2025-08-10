@echo off
chcp 65001 >nul
echo ==== Atualizar projeto (pull --rebase --autostash) ====
git rev-parse --is-inside-work-tree >nul 2>&1 || (
  echo [ERRO] Nao parece ser um repo Git aqui.
  exit /b 1
)

REM Garante upstream correto
git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>&1 || (
  echo Configurando upstream para origin/main...
  git branch --set-upstream-to=origin/main main
)

echo.
git fetch --all --prune
echo.
git pull --rebase --autostash origin main
if errorlevel 1 (
  echo.
  echo [ERRO] Pull/rebase falhou. Se houver conflitos, resolva-os:
  echo   - edite os arquivos marcados
  echo   - git add .
  echo   - git rebase --continue
  echo   - rode de novo este script
  exit /b 1
)

echo.
echo [OK] Projeto atualizado com sucesso.
exit /b 0
