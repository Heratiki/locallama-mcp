#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "Starting LocaLLama MCP Server..."

# Check if dist directory exists
if [ ! -d "$SCRIPT_DIR/dist" ] || [ ! -f "$SCRIPT_DIR/dist/index.js" ]; then
    echo "Compiled JavaScript not found. Building the project..."
    npm run build
fi

# Start the server
npm start