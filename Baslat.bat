@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Bagimliliklar kuruluyor, ilk seferde birkac dakika surebilir...
  call npm install
  if errorlevel 1 (
    echo.
    echo KURULUM HATASI. Node.js kurulu oldugundan emin ol: https://nodejs.org/
    pause
    exit /b 1
  )
)
echo AI Limit Tray baslatiliyor...
call npm start
if errorlevel 1 pause
