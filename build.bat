@echo off
echo ========================================================
echo Compiling Besta Bot to .exe using PyInstaller...
echo ========================================================

REM Clean previous builds
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"

REM Run PyInstaller
REM --noconsole prevents the black terminal from opening behind the GUI
REM --onefile creates a single .exe
REM --hidden-import ensures dependencies are correctly bundled
python -m PyInstaller --noconsole --onefile ^
    --name "BestaBot" ^
    --hidden-import "customtkinter" ^
    --hidden-import "getmac" ^
    --hidden-import "supabase" ^
    --hidden-import "iqoptionapi" ^
    --hidden-import "websocket" ^
    src\main.py

echo.
echo ========================================================
echo Compilation Complete!
echo You can find BestaBot.exe inside the "dist" folder.
echo ========================================================

