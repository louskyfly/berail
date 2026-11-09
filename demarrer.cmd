@echo off
cd /d "%~dp0"
title BeRail
echo.
echo   BeRail - serveur local
echo   ======================
echo   Garde cette fenetre ouverte pendant le cours.
echo.
node server.js
echo.
echo Serveur arrete.
pause
