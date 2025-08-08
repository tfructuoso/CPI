@echo off
cd /d %~dp0

echo ================================================
echo 🔄 Restaurando projeto a partir do GitHub...
echo ================================================

REM Garante que está no branch main
git checkout main

REM Baixa última versão do GitHub
git fetch origin

REM Reseta todos os arquivos para o estado remoto
git reset --hard origin/main

REM (Opcional) Apaga arquivos não rastreados
git clean -fd

echo.
echo ✅ Projeto restaurado com sucesso!
echo 🕒 Agora o código está igual ao do GitHub.
echo ================================================

pause
