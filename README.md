# The Bit-Brain Deployment Instructions

This repository contains the smart contracts, Python FastAPI backend, React/Vite frontend, and Decentralized Node scripts for **The Bit-Brain Network**. 

## 1. Smart Contract
Deploy `contracts/BitBrainVault.sol` to the Citrea Testnet (Chain ID 5115) using Hardhat or Foundry. 
Keep track of the `CONTRACT_ADDRESS`.

## 2. Backend Hub (FastAPI)

The FastAPI backend serves as the central switchboard. It no longer requires a local LLM! Instead, it relays AI generation requests to decentralized providers over secure WebSockets.

Deploy the backend manually or automatically using natively compatible platforms like Render (see `render.yaml`).
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start the Hub
uvicorn main:app --host 0.0.0.0 --port 8000
```

## 3. Decentralized Node Providers

Anyone can join the network to provide AI inference and earn cBTC! As a GPU provider, you connect directly to the central backend. You do **not** need to port forward or expose your local network.

To start serving your local LLMs (powered by Ollama), simply run the node setup script:

```bash
cd node
./setup_and_run.sh
```

**What the script does:**
1. Installs Ollama if it is not present on your machine.
2. Prompts you for your **Wallet Address** (to receive payments) and your preferred **Model** (e.g. `llama3`).
3. Automatically downloads your chosen model.
4. Opens an outbound WebSocket connection (`run_node.py`) to the central BitBrain backend and registers your active hardware availability.
5. Begins processing AI requests dynamically. If you pull a new model on your machine, it will automatically register it to the network!

## 4. Frontend Configuration (React / Vite)

The frontend uses Privy + Viem. It requires strict configuration for the custom Citrea Chain to work in injected wallets and Privy embedded wallets.

The frontend is fully compatible with Vercel and can be deployed directly via `vercel.json`. Set the `VITE_API_URL` environment variable to your deployed backend URL.

To run the frontend dashboard locally:
```bash
cd frontend
npm install
npm run dev
```

Enjoy your decentralized AI cypherpunk gateway!
