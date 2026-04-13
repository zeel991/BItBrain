#!/bin/bash
echo "[Bit-Brain] Building unified demo bundle..."

# 1. Build frontend and copy to backend/static
cd frontend
npm run demo:sync
cd ..

echo "[Bit-Brain] Starting unified server on port 8000..."

# 2. Start the FastAPI backend which will now serve BOTH the api and the UI
cd backend
source venv/bin/activate

echo "=========================================================="
echo " HOSTING INSTRUCTIONS:"
echo " 1. Your app is now running entirely on port 8000"
echo " 2. To expose this to the internet, open a new terminal"
echo "    and run one of these tools:"
echo "      - Using ngrok:       ngrok http 8000"
echo "      - Using localtunnel: npx localtunnel --port 8000"
echo "      - Using cloudflare:  cloudflared tunnel --url http://localhost:8000"
echo " 3. Share the generated link with anyone!"
echo "=========================================================="

uvicorn main:app --host 0.0.0.0 --port 8000
