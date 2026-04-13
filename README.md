# The Bit-Brain Deployment Instructions

This repository contains the smart contracts, Python FastAPI backend, and React/Vite frontend for The Bit-Brain. 

## 1. Smart Contract
Deploy `contracts/BitBrainVault.sol` to the Citrea Testnet (Chain ID 5115) using Hardhat or Foundry. 
Keep track of the `CONTRACT_ADDRESS`.

## 2. Backend Service (FastAPI)

Ensure your local AI provider (Ollama) is running with Llama 3:
```bash
ollama run llama3
```

Navigate to the `backend/` directory and install the requirements. Then start the uvicorn server:
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Option 1: Basic
uvicorn main:app --host 0.0.0.0 --port 8000

# Option 2: With environment variables
CONTRACT_ADDRESS=0xYourContract uvicorn main:app --host 0.0.0.0 --port 8000
```

To expose the backend publically with cross-origin access, run the ngrok command:
```bash
ngrok http 8000
```
Update any `.env` file referencing your backend URL with the resulting Ngrok tunnel URL.

## 3. Frontend Configuration (React / Vite)

The frontend uses Privy + Viem. It requires strict configuration for the custom Citrea Chain to work in injected wallets and Privy embedded wallets.

In `frontend/src/main.jsx`, the Vite configuration for the custom Citrea chain is defined as:

```javascript
const citreaTestnet = {
  id: 5115,
  network: 'citrea-testnet',
  name: 'Citrea Testnet',
  nativeCurrency: { name: 'cBTC', symbol: 'cBTC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.citrea.xyz'] },
    public: { http: ['https://rpc.testnet.citrea.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Citrea Explorer', url: 'https://explorer.testnet.citrea.xyz' },
  },
};
```

To run the frontend dashboard:
```bash
cd frontend
npm run dev
```

Enjoy your decentralized AI cypherpunk gateway!
