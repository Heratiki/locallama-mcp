@echo off
setlocal enabledelayedexpansion

rem Get the directory where the script is located
set "SCRIPT_DIR=%~dp0"
cd "%SCRIPT_DIR%"

echo Detecting Python virtual environment...

rem Check for different possible virtual environment paths
if exist "%SCRIPT_DIR%.venv\Scripts\activate.bat" (
    echo Found virtual environment at .venv
    call "%SCRIPT_DIR%.venv\Scripts\activate.bat"
) else if exist "%SCRIPT_DIR%venv\Scripts\activate.bat" (
    echo Found virtual environment at venv
    call "%SCRIPT_DIR%venv\Scripts\activate.bat"
) else if exist "%SCRIPT_DIR%env\Scripts\activate.bat" (
    echo Found virtual environment at env
    call "%SCRIPT_DIR%env\Scripts\activate.bat"
) else (
    echo Warning: No Python virtual environment found
    echo Attempting to create one...
    python -m venv .venv
    if exist "%SCRIPT_DIR%.venv\Scripts\activate.bat" (
        echo Virtual environment created successfully
        call "%SCRIPT_DIR%.venv\Scripts\activate.bat"
    ) else (
        echo Failed to create virtual environment
        echo Continuing without virtual environment...
    )
)

rem Check if retriv is installed in the virtual environment
python -c "import retriv" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Warning: 'retriv' package not found in virtual environment.
    echo Installing 'retriv' package...
    pip install retriv
)

rem Set any environment variables if needed
rem Uncomment and modify these as needed
rem set PORT=3000
rem set HOST=0.0.0.0
rem set API_PREFIX=/api

rem Check if dist directory exists
if not exist "%SCRIPT_DIR%dist" (
    echo Compiled JavaScript not found. Building the project...
    call npm run build
) else if not exist "%SCRIPT_DIR%dist\index.js" (
    echo Compiled JavaScript not found. Building the project...
    call npm run build
)

rem Start the MCP server
echo Starting LocaLLama MCP Server...
node "%SCRIPT_DIR%dist\index.js"

endlocal