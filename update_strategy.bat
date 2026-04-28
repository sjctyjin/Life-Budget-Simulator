@echo off
chcp 65001 >nul 2>nul
echo ============================================================
echo   Strategy Auto Screener
echo ============================================================
echo.

cd /d "%~dp0quant_research"
"%~dp0quant_research\venv310\Scripts\python.exe" auto_screener.py

echo.
pause
