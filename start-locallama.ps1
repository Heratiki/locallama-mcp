# PowerShell script for starting LocaLLama MCP Server on Windows

# Get the directory where the script is located
$SCRIPT_DIR = $PSScriptRoot
Set-Location -Path $SCRIPT_DIR

Write-Host "Starting LocaLLama MCP Server..."

# Check if dist directory exists
if (-not (Test-Path -Path "$SCRIPT_DIR\dist") -or -not (Test-Path -Path "$SCRIPT_DIR\dist\index.js")) {
    Write-Host "Compiled JavaScript not found. Building the project..."
    & npm run build
}

# Start the server
Write-Host "Starting the server..."
& npm start