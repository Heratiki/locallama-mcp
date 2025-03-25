#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "Detecting Python virtual environment..."

# Check for different possible virtual environment paths
if [ -f ".venv/bin/activate" ]; then
    echo "Found virtual environment at .venv"
    source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
    echo "Found virtual environment at venv"
    source venv/bin/activate
elif [ -f "env/bin/activate" ]; then
    echo "Found virtual environment at env"
    source env/bin/activate
else
    echo "Warning: No Python virtual environment found"
    echo "Attempting to create one..."
    python3 -m venv .venv
    if [ -f ".venv/bin/activate" ]; then
        echo "Virtual environment created successfully"
        source .venv/bin/activate
    else
        echo "Failed to create virtual environment"
        echo "Continuing without virtual environment..."
    fi
fi

# Check if retriv is installed in the virtual environment
if ! python -c "import retriv" &> /dev/null; then
    echo "Warning: 'retriv' package not found in virtual environment."
    echo "Installing 'retriv' package..."
    pip install retriv
fi

# Set any environment variables if needed
# Uncomment and modify these as needed
# export PORT=3000
# export HOST=0.0.0.0
# export API_PREFIX=/api

# Check if dist directory exists
if [ ! -d "$SCRIPT_DIR/dist" ] || [ ! -f "$SCRIPT_DIR/dist/index.js" ]; then
    echo "Compiled JavaScript not found. Building the project..."
    npm run build
fi

# Start the MCP server
echo "Starting LocaLLama MCP Server..."
node "$SCRIPT_DIR/dist/index.js"
