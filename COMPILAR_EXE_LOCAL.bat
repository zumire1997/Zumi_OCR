@echo off
setlocal
cd /d "%~dp0"
where cargo >nul 2>&1
if errorlevel 1 (
  echo No se encontro Rust/Cargo instalado.
  echo Instala Rust desde https://rustup.rs o usa la Opcion A gratis en GitHub Actions (ver LEEME_COMPILAR_EXE.txt).
  pause
  exit /b 1
)
cargo tauri --version >nul 2>&1
if errorlevel 1 (
  echo Instalando Tauri CLI v2...
  cargo install tauri-cli --version "^2" --locked
)
echo Compilando Zumi OCR para Windows...
cargo tauri build
if errorlevel 1 (
  echo Hubo un error al compilar.
  pause
  exit /b 1
)
echo.
echo LISTO! Tu instalador .exe esta en: src-tauri\target\release\bundle\nsis\
echo Y el ejecutable directo esta en: src-tauri\target\release\zumi-ocr.exe
pause
