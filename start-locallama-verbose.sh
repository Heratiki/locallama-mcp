#!/bin/bash

# Colors for better output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

print_status "Starting LocaLLama MCP Server setup..."
print_status "Working directory: $SCRIPT_DIR"

print_status "Detecting Python virtual environment..."

# Check for different possible virtual environment paths
if [ -f ".venv/bin/activate" ]; then
    print_success "Found virtual environment at .venv"
    print_status "Activating virtual environment..."
    source .venv/bin/activate
    print_success "Virtual environment activated"
elif [ -f "venv/bin/activate" ]; then
    print_success "Found virtual environment at venv"
    print_status "Activating virtual environment..."
    source venv/bin/activate
    print_success "Virtual environment activated"
elif [ -f "env/bin/activate" ]; then
    print_success "Found virtual environment at env"
    print_status "Activating virtual environment..."
    source env/bin/activate
    print_success "Virtual environment activated"
else
    print_warning "No Python virtual environment found"
    print_status "Attempting to create one..."
    python3 -m venv .venv
    if [ -f ".venv/bin/activate" ]; then
        print_success "Virtual environment created successfully"
        print_status "Activating new virtual environment..."
        source .venv/bin/activate
        print_success "Virtual environment activated"
    else
        print_error "Failed to create virtual environment"
        print_warning "Continuing without virtual environment..."
    fi
fi

print_status "Python version: $(python --version)"
print_status "Virtual environment: $VIRTUAL_ENV"

# Check if retriv is installed in the virtual environment
print_status "Checking for 'retriv' package..."
if ! python -c "import retriv" &> /dev/null; then
    print_warning "'retriv' package not found in virtual environment"
    print_status "Installing 'retriv' package (this may take several minutes)..."
    print_status "Installing dependencies including PyTorch, transformers, and ML libraries..."
    
    # Show pip install with progress
    pip install retriv --progress-bar on
    
    if [ $? -eq 0 ]; then
        print_success "'retriv' package installed successfully"
    else
        print_error "Failed to install 'retriv' package"
        exit 1
    fi
else
    print_success "'retriv' package is already installed"
fi

# Set any environment variables if needed
print_status "Setting up environment variables..."
# Uncomment and modify these as needed
# export PORT=3000
# export HOST=0.0.0.0
# export API_PREFIX=/api
print_status "Environment variables configured"

# Check if dist directory exists
print_status "Checking for compiled JavaScript files..."
if [ ! -d "$SCRIPT_DIR/dist" ] || [ ! -f "$SCRIPT_DIR/dist/index.js" ]; then
    print_warning "Compiled JavaScript not found"
    print_status "Building the TypeScript project (this may take a minute)..."
    
    if npm run build; then
        print_success "Project built successfully"
    else
        print_error "Failed to build project"
        exit 1
    fi
else
    print_success "Compiled JavaScript files found"
fi

# Final check before starting
if [ ! -f "$SCRIPT_DIR/dist/index.js" ]; then
    print_error "Main entry file dist/index.js not found after build"
    print_error "Please check the build process"
    exit 1
fi

# Start the MCP server
print_success "All checks passed!"
print_status "Starting LocaLLama MCP Server..."
print_status "Press Ctrl+C to stop the server"
echo "----------------------------------------"

node "$SCRIPT_DIR/dist/index.js"