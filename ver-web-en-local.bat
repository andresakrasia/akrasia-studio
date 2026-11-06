@echo off
chcp 65001 >nul
title Akrasia Studio - web en local (demo)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encuentra Node.js en este ordenador.
  echo  Instala la version 24 LTS desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo  Preparando dependencias (la primera vez tarda un poco)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo  No se pudieron instalar las dependencias. Copia el mensaje de arriba y pasaselo a Claude.
  pause
  exit /b 1
)

echo.
echo  Arrancando la web en modo demostracion (datos ficticios, sin servicios reales)...
echo  Se abrira en el navegador: http://localhost:4322
echo  Para pararla, cierra esta ventana.
echo.
start "" cmd /c "timeout /t 12 >nul & start http://localhost:4322"
call npm run dev:hub-demo
pause
