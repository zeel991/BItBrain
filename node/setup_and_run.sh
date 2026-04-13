#!/bin/bash

echo "=========================================="
echo "    BIT-BRAIN NODE SETUP & RUNNER"
echo "=========================================="

# 1. Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "[-] Ollama is not installed. Installing it now..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "[+] Ollama is already installed."
fi

# 2. Try starting ollama serve in background (in case it's not running as a daemon)
echo "[*] Checking Ollama daemon..."
# It will fail gracefully if the port is already bound
ollama serve > /dev/null 2>&1 &
OLLAMA_PID=$!

sleep 2

# 3. Ask the user for their configuration
read -p "Enter your wallet address to receive payments: " WALLET_ADDRESS
read -p "Enter the model you want to host (default: llama3): " OLLAMA_MODEL

OLLAMA_MODEL=${OLLAMA_MODEL:-llama3}

# 4. Pull the model ensuring it exists locally
echo "[*] Ensuring model '$OLLAMA_MODEL' is pulled locally. This may take a few minutes..."
ollama pull $OLLAMA_MODEL

# 5. Setup Python environment and requirements
echo "[*] Setting up Python environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt -q

# 6. Run the node bridge script
echo "[+] Starting decentralized node bridge..."
export WALLET_ADDRESS=$WALLET_ADDRESS
export OLLAMA_MODEL=$OLLAMA_MODEL

# If you host your backend externally, you'd change this URL.
export BACKEND_WS_URL="wss://bitbrain-api.onrender.com/ws/provider"

# Run the python script. When we Ctrl-C, it will trap and close.
python3 run_node.py

# Cleanup
kill $OLLAMA_PID 2>/dev/null
