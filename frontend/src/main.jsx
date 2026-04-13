import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import App from './App.jsx'
import './index.css'

// Define Custom Chain: Citrea Testnet
const citreaTestnet = {
  id: 5115,
  network: 'citrea-testnet',
  name: 'Citrea Testnet',
  nativeCurrency: {
    name: 'cBTC',
    symbol: 'cBTC',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.citrea.xyz'] },
    public: { http: ['https://rpc.testnet.citrea.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Citrea Explorer', url: 'https://explorer.testnet.citrea.xyz' },
  },
};

// Define Alternative Testnet (Sepolia) since it's easy to get testnet tokens
const alternativeTestnet = {
  id: 11155111,
  network: 'sepolia',
  name: 'Sepolia Testnet',
  nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.sepolia.org'] },
    public: { http: ['https://rpc.sepolia.org'] },
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' },
  },
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID || "insert_privy_app_id"}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'dark',
          accentColor: '#00FF00',
        },
        // Change defaultChain to citreaTestnet once you have testnet tokens
        defaultChain: alternativeTestnet,
        supportedChains: [alternativeTestnet, citreaTestnet]
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
)
