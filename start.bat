@echo off
echo WhatsApp Account Warmer baslatiliyor...
echo.

REM Proje dizinine git
cd /d "C:\Users\monster\projects\whatsapp-account-warmer"

REM Node.js ve npm'in yuklu olup olmadigini kontrol et
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo HATA: Node.js bulunamadi! Lutfen Node.js yukleyip yeniden deneyin.
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo HATA: npm bulunamadi! Lutfen Node.js yukleyip yeniden deneyin.
    pause
    exit /b 1
)

REM node_modules yoksa npm install calistir
if not exist "node_modules" (
    echo node_modules bulunamadi. npm install calistiriliyor...
    npm install
    if %errorlevel% neq 0 (
        echo HATA: npm install basarisiz oldu!
        pause
        exit /b 1
    )
)

REM Uygulamayi baslat
echo Uygulama baslatiliyor...
echo.
node index.js

REM Uygulama kapandiginda bekle
echo.
echo Uygulama sonlandi.
pause