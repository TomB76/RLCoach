@echo off
rem ===========================================================================
rem  RL Coach - mode DEVELOPPEMENT (API + interface Vite avec hot reload)
rem  Interface : http://localhost:5317   /   API : http://localhost:4317
rem  Usage : start-dev.bat [nobrowser]
rem  Pour un simple usage quotidien, prefere start-server.bat (plus rapide).
rem ===========================================================================
setlocal EnableExtensions
cd /d "%~dp0"
title RL Coach - developpement

rem --- port de l'API : lu dans .env si present -----------------------------
set "PORT=4317"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /i /c:"PORT=" ".env" 2^>nul`) do set "PORT=%%B"
)
if "%PORT%"=="" set "PORT=4317"
set "PORT=%PORT: =%"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable dans le PATH.
  echo Installe Node 20 ou superieur depuis https://nodejs.org puis relance.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installation des dependances ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERREUR] npm install a echoue.
    pause
    exit /b 1
  )
  echo.
)

echo ==================================================
echo    RL Coach - developpement
echo ==================================================
echo.
echo    Interface (Vite) : http://localhost:5317
echo    API              : http://localhost:%PORT%
echo.
echo    Hot reload actif : les modifications de web\src sont visibles
echo    immediatement. La fenetre "RL Coach - dev" affiche les logs.
echo.

start "RL Coach - dev" cmd /k "set PORT=%PORT% && title RL Coach - dev & npm run dev"

if /i not "%~1"=="nobrowser" (
  timeout /t 6 /nobreak >nul
  start "" "http://localhost:5317"
)

exit /b 0
