@echo off
rem ===========================================================================
rem  RL Coach - demarrage du serveur web (interface + API sur le meme port)
rem  Double-clic suffit. Le serveur tourne dans sa propre fenetre.
rem  Usage : start-server.bat [rebuild] [nobrowser]
rem    rebuild   = reconstruit l'interface avant de demarrer
rem    nobrowser = n'ouvre pas le navigateur
rem ===========================================================================
setlocal EnableExtensions
cd /d "%~dp0"
title RL Coach - serveur web

rem --- port : lu dans .env si le fichier existe, sinon 4317 -----------------
set "PORT=4317"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /i /c:"PORT=" ".env" 2^>nul`) do set "PORT=%%B"
)
if "%PORT%"=="" set "PORT=4317"
set "PORT=%PORT: =%"

rem --- options --------------------------------------------------------------
set "NEED_BUILD="
set "NOBROWSER="
for %%A in (%*) do (
  if /i "%%~A"=="rebuild" set "NEED_BUILD=1"
  if /i "%%~A"=="nobrowser" set "NOBROWSER=1"
)

rem --- verification de Node -------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable dans le PATH.
  echo Installe Node 20 ou superieur depuis https://nodejs.org puis relance.
  echo.
  pause
  exit /b 1
)

echo ==================================================
echo    RL Coach - serveur web
echo ==================================================
echo.

rem --- dependances ----------------------------------------------------------
if not exist "node_modules" (
  echo [1/3] Installation des dependances ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERREUR] npm install a echoue. Verifie ta connexion reseau.
    pause
    exit /b 1
  )
  echo.
)

rem --- interface : rebuild si dist absent, plus ancien que les sources, -----
rem --- ou si l'argument "rebuild" est passe -------------------------------
if not exist "dist\index.html" set "NEED_BUILD=1"
if not defined NEED_BUILD (
  rem PowerShell n'affiche "1" que si un fichier de web\src est plus recent
  rem que dist\index.html (sinon il n'affiche rien et NEED_BUILD reste vide).
  for /f %%T in ('powershell -NoProfile -Command "$a=(Get-ChildItem -Recurse -File 'web\src' | Measure-Object LastWriteTime -Maximum).Maximum; $b=(Get-Item 'dist\index.html').LastWriteTime; if($a -gt $b){'1'}" 2^>nul') do set "NEED_BUILD=1"
)

if defined NEED_BUILD (
  echo [2/3] Construction de l'interface ^(npm run build^)...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [ERREUR] La construction de l'interface a echoue.
    pause
    exit /b 1
  )
  echo.
) else (
  echo [2/3] Interface deja construite ^(dist^).
  echo.
)

rem --- lancement ------------------------------------------------------------
echo [3/3] Demarrage du serveur...
echo.
echo    Interface : http://localhost:%PORT%
echo    API       : http://localhost:%PORT%/api/status
echo.
echo    Le serveur tourne dans la fenetre "RL Coach - serveur".
echo    Pour tout arreter : ferme cette fenetre-la, ou Ctrl+C dedans.
echo.

start "RL Coach - serveur" cmd /k "title RL Coach - serveur & node server/src/index.js"

if not defined NOBROWSER (
  timeout /t 3 /nobreak >nul
  start "" "http://localhost:%PORT%"
)

exit /b 0
