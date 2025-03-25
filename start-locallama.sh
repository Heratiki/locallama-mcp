#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Activate Python virtual environment
echo "Activating Python virtual environment..."
source .venv/bin/activate

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
