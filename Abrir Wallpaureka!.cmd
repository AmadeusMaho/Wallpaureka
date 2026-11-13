@echo off
title Wallpaureka!
rem Doble clic para abrir Wallpaureka! en el navegador. Se cierra cerrando esta ventana.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo No encuentro Node.js. Instalalo desde https://nodejs.org ^(version 18 o mas nueva^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node server.mjs
if errorlevel 1 pause
