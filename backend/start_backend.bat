@echo off
cd /d %~dp0
set "PYTHON_EXE=%~dp0venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"
echo Installing dependencies...
"%PYTHON_EXE%" -m pip install -r requirements.txt
echo Starting backend server...
"%PYTHON_EXE%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
