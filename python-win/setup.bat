@echo off
setlocal

echo ========================================
echo Smartklick Wake Word Setup
echo ========================================
echo.

cd /d "%~dp0"

:: Check if already installed
if exist "Lib\site-packages\openwakeword" (
    echo Wake Word bereits installiert.
    exit /b 0
)

echo Installiere pip...
python.exe get-pip.py --no-warn-script-location 2>nul
if errorlevel 1 (
    echo FEHLER: pip Installation fehlgeschlagen!
    pause
    exit /b 1
)

echo.
echo Installiere Wake Word Pakete...
echo Dies kann einige Minuten dauern...
echo.

python.exe -m pip install --no-warn-script-location numpy scipy scikit-learn sounddevice aiohttp requests tqdm onnxruntime colorlog python-dotenv 2>nul
if errorlevel 1 (
    echo WARNUNG: Einige Pakete konnten nicht installiert werden.
)

:: Install openwakeword without dependencies (we installed them above)
python.exe -m pip install --no-warn-script-location --no-deps openwakeword 2>nul

:: Download wake word models
echo.
echo Lade Wake Word Modelle herunter...
python.exe -c "import openwakeword; openwakeword.utils.download_models(['hey_jarvis'])" 2>nul

echo.
echo ========================================
echo Installation abgeschlossen!
echo ========================================
echo.

exit /b 0
