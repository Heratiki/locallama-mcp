@echo off
setlocal enabledelayedexpansion

rem Get the directory where the script is located
set "SCRIPT_DIR=%~dp0"
cd "%SCRIPT_DIR%"

echo Starting LocaLLama MCP Server...

rem Check if dist directory exists
if not exist "%SCRIPT_DIR%dist" (
    echo Compiled JavaScript not found. Building the project...
    call npm run build
)

rem Start the server
call npm start

endlocal