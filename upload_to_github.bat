@echo off
title PackFlow Mobile - Upload ke GitHub
cls
echo ========================================================
echo        PackFlow Mobile - Auto Deploy ke GitHub
echo ========================================================
echo.
echo Repository Target: https://github.com/AkmalSeptiana/packflow-mobile.git
echo.

cd /d "%~dp0"

echo [1/4] Memeriksa status Git...
git init
git remote remove origin 2>nul
git remote add origin https://github.com/AkmalSeptiana/packflow-mobile.git

echo [2/4] Menambahkan semua file...
git add .

echo [3/4] Membuat Commit...
git commit -m "Update PackFlow Mobile PWA - %date% %time%"

echo [4/4] Mengunggah (Push) ke GitHub (Branch main)...
git branch -M main
git push -u origin main

echo.
if %ERRORLEVEL% EQU 0 (
    echo ========================================================
    echo   BERHASIL! Semua file telah terunggah ke GitHub!
    echo   Web Anda akan aktif di:
    echo   https://akmalseptiana.github.io/packflow-mobile/
    echo ========================================================
) else (
    echo ========================================================
    echo   [PERHATIAN] Terjadi kendala saat push.
    echo   Jika ini push pertama kali, pastikan Anda sudah login
    echo   atau gunakan token akses GitHub.
    echo ========================================================
)

echo.
pause
