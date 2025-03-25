# PowerShell script for starting LocaLLama MCP Server on Windows

# Get the directory where the script is located
$SCRIPT_DIR = $PSScriptRoot
Set-Location -Path $SCRIPT_DIR

Write-Host "Detecting Python virtual environment..."

# Check for different possible virtual environment paths
if (Test-Path -Path "$SCRIPT_DIR\.venv\Scripts\Activate.ps1") {
    Write-Host "Found virtual environment at .venv"
    & "$SCRIPT_DIR\.venv\Scripts\Activate.ps1"
} elseif (Test-Path -Path "$SCRIPT_DIR\venv\Scripts\Activate.ps1") {
    Write-Host "Found virtual environment at venv"
    & "$SCRIPT_DIR\venv\Scripts\Activate.ps1"
} elseif (Test-Path -Path "$SCRIPT_DIR\env\Scripts\Activate.ps1") {
    Write-Host "Found virtual environment at env"
    & "$SCRIPT_DIR\env\Scripts\Activate.ps1"
} else {
    Write-Host "Warning: No Python virtual environment found"
    Write-Host "Attempting to create one..."
    & python -m venv .venv
    if (Test-Path -Path "$SCRIPT_DIR\.venv\Scripts\Activate.ps1") {
        Write-Host "Virtual environment created successfully"
        & "$SCRIPT_DIR\.venv\Scripts\Activate.ps1"
    } else {
        Write-Host "Failed to create virtual environment"
        Write-Host "Continuing without virtual environment..."
    }
}

# Check if retriv is installed in the virtual environment
try {
    $null = & python -c "import retriv"
    Write-Host "Retriv package is already installed"
} catch {
    Write-Host "Warning: 'retriv' package not found in virtual environment."
    Write-Host "Installing 'retriv' package..."
    & pip install retriv
}

# Set any environment variables if needed
# Uncomment and modify these as needed
# $env:PORT = "3000"
# $env:HOST = "0.0.0.0"
# $env:API_PREFIX = "/api"

# Check if dist directory exists
if (-not (Test-Path -Path "$SCRIPT_DIR\dist") -or -not (Test-Path -Path "$SCRIPT_DIR\dist\index.js")) {
    Write-Host "Compiled JavaScript not found. Building the project..."
    & npm run build
}

# Start the MCP server
Write-Host "Starting LocaLLama MCP Server..."
& node "$SCRIPT_DIR\dist\index.js"