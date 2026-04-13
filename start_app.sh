#!/bin/bash

# Base directory
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to handle shutdown gracefully
cleanup() {
    echo -e "\n[Bit-Brain] Shutting down services..."
    kill $BACKEND_PID
    kill $FRONTEND_PID
    exit 0
}

# Trap CTRL+C to call cleanup function
trap cleanup SIGINT SIGTERM

echo "=========================================="
echo "    INITIALIZING THE BIT-BRAIN NODE       "
echo "=========================================="

echo -e "\n[*] Starting FastAPI Backend..."
cd "$BASE_DIR/backend"
# Set up venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "    Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt -q
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo -e "\n[*] Starting React Frontend..."
cd "$BASE_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo -e "\n[+] Services are running!"
echo "    - Backend: http://127.0.0.1:8000"
echo "    - Frontend: http://localhost:5173"
echo "    (AI Inference holds off until UI verification is complete)"
echo -e "\nPress CTRL+C to stop all services.\n"

# Keep script running indefinitely until user presses CTRL+C
wait
