import { useState, useRef, useEffect, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { HardwareWidget } from "./HardwareWidget";
import { Send, Terminal, Lock, Unlock } from "lucide-react";
import { createPublicClient, http, defineChain } from "viem";

const citreaTestnet = defineChain({
  id: 5115,
  name: "Citrea Testnet",
  nativeCurrency: { decimals: 18, name: "cBTC", symbol: "cBTC" },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.citrea.xyz"] },
  },
  blockExplorers: {
    default: { name: "Citrea Explorer", url: "https://explorer.testnet.citrea.xyz" },
  },
  testnet: true,
});
import ReactMarkdown from "react-markdown";

// Constants
const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0xC8014e9D37cc59Fed1988aCbfFE59246A16374AA";
// Read access contract on Citrea Testnet regardless of wallet chain (wallet RPC was returning 0x when chain mismatched).
const ACCESS_READ_RPC =
  import.meta.env.VITE_ACCESS_READ_RPC ||
  "https://rpc.testnet.citrea.xyz";
const accessReadClient = createPublicClient({
  chain: citreaTestnet,
  transport: http(ACCESS_READ_RPC),
});
// Empty VITE_API_URL → same-origin (FastAPI + static bundle behind one tunnel).
const _viteApi = import.meta.env.VITE_API_URL;
const API_BASE =
  _viteApi === undefined || _viteApi === null
    ? "http://localhost:8000"
    : String(_viteApi).replace(/\/$/, "");

function parseJsonResponse(raw, status) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw.slice(0, 120) || `HTTP ${status}`);
  }
}

async function fetchChatHistory(walletAddress) {
  const res = await fetch(
    `${API_BASE}/history/${encodeURIComponent(walletAddress)}`,
  );
  const raw = await res.text();
  const body = parseJsonResponse(raw, res.status);
  if (!res.ok) {
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : `HTTP ${res.status}`);
  }
  return body.history || [];
}

function findFirstNodeWithModel(nodes) {
  return nodes.find((node) => node.models?.length > 0) || nodes[0] || null;
}

function formatStreamError(message) {
  return `\n[ERROR: ${message}]`;
}

// SESSION_PRICE is 0.0001 ether = 100000000000000 wei = 0x5af3107a4000
const SESSION_PRICE_HEX = "0x5af3107a4000";

export default function TerminalUI() {
  const { login, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();

  // UI states: 'locked', 'active', 'inference'
  const [sessionState, setSessionState] = useState("locked");
  const [hasCheckedAccess, setHasCheckedAccess] = useState(false);
  const [expiryTime, setExpiryTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);

  const [messages, setMessages] = useState([
    {
      role: "system",
      content:
        "INITIALIZING BIT-BRAIN LINK...\nESTABLISHING SECURE DEPIN CONNECTION...\nWAITING FOR PAYMENT...",
    },
  ]);
  const [input, setInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  
  // New state for Decentralized Node Selection
  const [availableNodes, setAvailableNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [nodeError, setNodeError] = useState("");
  
  const chatContainerRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Fetch available nodes periodically
  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const res = await fetch(`${API_BASE}/nodes`);
        const raw = await res.text();
        const data = parseJsonResponse(raw, res.status);

        if (!res.ok) {
          const detail = data?.detail;
          throw new Error(typeof detail === "string" ? detail : `HTTP ${res.status}`);
        }

        const nodes = Array.isArray(data.nodes) ? data.nodes : [];
        setAvailableNodes(nodes);
        setNodeError("");

        if (nodes.length === 0) {
          setSelectedNode("");
          setSelectedModel("");
          return;
        }

        const selected = nodes.find((node) => node.node_id === selectedNode);
        if (selected?.models?.includes(selectedModel)) {
          return;
        }

        const nextNode = selected?.models?.length ? selected : findFirstNodeWithModel(nodes);
        setSelectedNode(nextNode?.node_id || "");
        setSelectedModel(nextNode?.models?.[0] || "");
      } catch (err) {
        console.error("Failed to fetch nodes", err);
        setAvailableNodes([]);
        setSelectedNode("");
        setSelectedModel("");
        setNodeError(
          err.message.includes("<!doctype") || err.message.includes("<html")
            ? "Backend API is not connected. Set VITE_API_URL to your FastAPI URL."
            : `Node lookup failed: ${err.message}`,
        );
      }
    };
    fetchNodes();
    const intervalId = setInterval(fetchNodes, 10000);
    return () => clearInterval(intervalId);
  }, [selectedNode, selectedModel]);

  const appendToLastAssistant = (content) => {
    setMessages((prev) => {
      const newMsgs = [...prev];
      const lastIdx = newMsgs.length - 1;
      if (lastIdx < 0 || newMsgs[lastIdx].role !== "assistant") {
        return [...newMsgs, { role: "assistant", content }];
      }
      newMsgs[lastIdx] = {
        ...newMsgs[lastIdx],
        content: newMsgs[lastIdx].content + content,
      };
      return newMsgs;
    });
  };

  const handleStreamEvent = (eventText) => {
    const normalized = eventText.replace(/\r\n/g, "\n").trim();
    const dataStr = normalized
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (!dataStr) {
      console.warn("Ignoring non-SSE stream event", normalized);
      return;
    }

    try {
      const data = JSON.parse(dataStr);
      if (data.content !== undefined) {
        appendToLastAssistant(data.content);
      } else if (data.error) {
        appendToLastAssistant(formatStreamError(data.error));
      }
    } catch {
      console.warn("Ignoring malformed stream event", dataStr);
    }
  };
  useEffect(() => {
    if (authenticated && wallets && wallets.length > 0 && !hasCheckedAccess) {
      const walletAddress = wallets[0]?.address;
      if (!walletAddress) return;

      setHasCheckedAccess(true);

      const verifyAccess = async () => {
        try {
          const expiryVal = await accessReadClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: [
              {
                inputs: [
                  { internalType: "address", name: "", type: "address" },
                ],
                name: "expiryTimestamp",
                outputs: [
                  { internalType: "uint256", name: "", type: "uint256" },
                ],
                stateMutability: "view",
                type: "function",
              },
            ],
            functionName: "expiryTimestamp",
            args: [walletAddress],
          });

          const expTime = Number(expiryVal);
          const now = Math.floor(Date.now() / 1000);

          if (expTime > now) {
            setExpiryTime(expTime);
            setSessionState("active");
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `AUTHENTICATED: ${walletAddress.slice(0, 6)}...\nEXISTING ACCESS GRANTED. SESSION ACTIVE.`,
              },
            ]);
            try {
              const loadedHistory = await fetchChatHistory(walletAddress);
              if (loadedHistory.length > 0) {
                setMessages((prev) => [
                  ...prev,
                  { role: "system", content: "SESSION RESTORED." },
                  ...loadedHistory.map((m) => ({
                    role: m.role,
                    content: m.content,
                  })),
                ]);
              }
            } catch (e) {
              console.error("Failed to load history", e);
              setMessages((prev) => [
                ...prev,
                { role: "system", content: "[ERROR: FAILED TO LOAD HISTORY]" },
              ]);
            }
          } else {
            setSessionState("locked");
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `AUTHENTICATED: ${walletAddress.slice(0, 6)}...\nAWAITING ACCESS PAYMENT.`,
              },
            ]);
          }
        } catch (e) {
          console.error("Error reading contract access", e);
          setSessionState("locked");
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: "AUTHENTICATED. AWAITING ACCESS PAYMENT.",
            },
          ]);
        }
      };

      verifyAccess();
    }

    // Reset state if disconnected
    if (!authenticated) {
      setHasCheckedAccess(false);
      setExpiryTime(0);
      setSessionState("locked");
      if (
        messages.length > 1 &&
        !messages[messages.length - 1].content.includes("DISCONNECTED")
      ) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "NODE DISCONNECTED. WAITING FOR PAYMENT...",
          },
        ]);
      }
    }
  }, [authenticated, wallets, hasCheckedAccess, messages]);

  // Countdown clock effect
  useEffect(() => {
    if (sessionState === "locked" || expiryTime === 0) {
      setTimeLeft(0);
      return;
    }
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = expiryTime - now;
      if (remaining <= 0) {
        setTimeLeft(0);
        // Important: check if not already locked so we only append message once
        setSessionState((prev) => {
          if (prev !== "locked") {
            setMessages((m) => [
              ...m,
              {
                role: "system",
                content: "SESSION EXPIRED. AWAITING PAYMENT TO CONTINUE.",
              },
            ]);
            return "locked";
          }
          return prev;
        });
        clearInterval(interval);
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionState, expiryTime]);

  const scrollToBottom = useCallback(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [autoScroll]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  };

  const handlePay = async () => {
    if (!wallets || wallets.length === 0) return;
    try {
      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();

      const targetChainIdHex = "0x13fb"; // 5115
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainIdHex }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: targetChainIdHex,
                chainName: "Citrea Testnet",
                nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
                rpcUrls: ["https://rpc.testnet.citrea.xyz"],
                blockExplorerUrls: ["https://explorer.testnet.citrea.xyz"],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }

      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: CONTRACT_ADDRESS,
            value: SESSION_PRICE_HEX,
            data: "0xdfa7df8c",
          },
        ],
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `TRANSACTION SUBMITTED: ${hash}\nWAITING FOR BLOCK CONFIRMATION... (DO NOT REFRESH)`,
        },
      ]);
      setSessionState("inference"); // Use inference state to temporarily disable input

      await accessReadClient.waitForTransactionReceipt({ hash });

      // Fetch the real, newly updated expiry timestamp from the blockchain
      const newExpiry = await accessReadClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: [{ inputs: [{ internalType: "address", name: "", type: "address" }], name: "expiryTimestamp", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" }],
        functionName: "expiryTimestamp",
        args: [wallet.address],
      });

      setExpiryTime(Number(newExpiry));
      setSessionState("active");
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `PAYMENT CONFIRMED.\nACCESS GRANTED. SESSION ACTIVE.`,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `PAYMENT FAILED: ${err.message}` },
      ]);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || sessionState === "locked") return;

    const userWallet = wallets?.[0]?.address;
    if (!userWallet) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content:
            "[ERROR: WALLET DISCONNECTED OR NOT FOUND. PLEASE RECONNECT.]",
        },
      ]);
      setSessionState("locked");
      return;
    }

    const prompt = input;
    setInput("");
    setSessionState("inference");

    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const firstNode = findFirstNodeWithModel(availableNodes);
      const requestNode = selectedNode || firstNode?.node_id || "local_fallback";
      const requestModel = selectedModel || firstNode?.models?.[0] || "";
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          wallet_address: userWallet, 
          prompt,
          target_node: requestNode,
          target_model: requestModel
        }),
      });

      if (!res.ok) {
        const raw = await res.text();
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(raw.slice(0, 120) || `Server returned status ${res.status}`);
        }
        throw new Error(body?.detail || `Server returned status ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Server did not return a response stream");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n|\r\n\r\n/);
        buffer = events.pop() || "";

        for (const eventText of events) {
          handleStreamEvent(eventText);
        }
      }

      if (buffer.trim()) {
        handleStreamEvent(buffer);
      }
    } catch (err) {
      appendToLastAssistant(formatStreamError(`CONNECTION ERROR: ${err.message}`));
    } finally {
      // Restore appropriate state depending on whether expired during generation
      setSessionState((prev) => (prev === "locked" ? "locked" : "active"));
      setAutoScroll(true);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="flex h-[100%] font-mono text-terminal-green gap-4">
      {/* Main Terminal Column */}
      <div className="flex flex-col flex-1 h-full overflow-hidden p-4">
        <div className="flex items-center justify-between pb-2 border-b border-terminal-green mb-4 opacity-80 text-sm tracking-widest font-bold">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 uppercase"><Terminal size={18} /> THE BIT-BRAIN</span>
            
            {/* Model Selection Dropdown */}
            {sessionState !== "locked" && (
              <div className="flex flex-col ml-4">
                <select 
                  className="bg-transparent border border-terminal-green/50 text-terminal-green py-1 px-2 text-xs outline-none focus:border-terminal-green cursor-pointer disabled:opacity-50"
                  value={selectedNode && selectedModel ? `${selectedNode}|${selectedModel}` : ""}
                  onChange={(e) => {
                    const [nId, mod] = e.target.value.split("|");
                    setSelectedNode(nId);
                    setSelectedModel(mod);
                  }}
                  disabled={sessionState === "inference" || availableNodes.length === 0}
                >
                  {availableNodes.length === 0 ? (
                    <option value="" className="bg-black text-terminal-green">No Node Available</option>
                  ) : (
                    availableNodes.map(node => (
                      node.models?.length > 0 ? (
                        node.models.map(model => (
                          <option key={`${node.node_id}-${model}`} value={`${node.node_id}|${model}`} className="bg-black text-terminal-green">
                            {node.node_id.substring(0, 6)} - {model}
                          </option>
                        ))
                      ) : null
                    ))
                  )}
                </select>
              </div>
            )}
            
          </div>
          <div className="uppercase">
            {sessionState === "locked" ? (
              <span className="text-red-500">OFFLINE</span>
            ) : (
              <span className="text-terminal-green animate-pulse">
                ACTIVE [{formatTime(timeLeft)}]{" "}
                {sessionState === "inference" && "(INFERENCE)"}
              </span>
            )}
          </div>
        </div>

        {/* Chat Log */}
        <div
          className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2"
          onScroll={handleScroll}
          ref={chatContainerRef}
        >
          {!autoScroll && sessionState !== "inference" && (
            <button
              onClick={() => {
                setAutoScroll(true);
                scrollToBottom();
              }}
              className="sticky bottom-2 left-2 px-3 py-1 bg-terminal-green/20 border border-terminal-green/50 rounded text-xs hover:bg-terminal-green/30"
            >
              ↓ Scroll to bottom
            </button>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={
                msg.role === "user"
                  ? "text-blue-400"
                  : msg.role === "system"
                    ? "text-yellow-500/80 text-xs uppercase"
                    : "text-terminal-green"
              }
            >
              <span className="opacity-50 mr-2">
                {msg.role === "user"
                  ? ">"
                  : msg.role === "system"
                    ? "!"
                    : "AI:"}
              </span>
              {msg.role === "assistant" && msg.content ? (
                <div className="markdown-content prose prose-invert max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-2">{children}</p>,
                      ul: ({ children }) => (
                        <ul className="list-disc ml-4 mb-2">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal ml-4 mb-2">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="mb-1">{children}</li>
                      ),
                      h1: ({ children }) => (
                        <h1 className="text-lg font-bold mb-2">{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-base font-bold mb-2">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-sm font-bold mb-2">{children}</h3>
                      ),
                      code: ({ className, children, ...props }) => {
                        const isInline = !className;
                        return isInline ? (
                          <code
                            className="bg-terminal-green/20 px-1 rounded"
                            {...props}
                          >
                            {children}
                          </code>
                        ) : (
                          <code
                            className="block bg-terminal-green/20 p-2 rounded my-2 overflow-x-auto whitespace-pre"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                      pre: ({ children }) => (
                        <pre className="bg-terminal-green/10 p-2 rounded overflow-x-auto mb-2">
                          {children}
                        </pre>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-terminal-green/50 pl-2 italic">
                          {children}
                        </blockquote>
                      ),
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          className="underline hover:text-terminal-green/70"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </span>
              )}
              {msg.role === "assistant" &&
                idx === messages.length - 1 &&
                sessionState === "inference" && (
                  <span className="cursor-blink"></span>
                )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Controls */}
        <div className="pt-4 border-t border-terminal-green flex items-center gap-3">
          {sessionState === "locked" ? (
            <div className="flex items-center gap-4 w-full">
              {!authenticated ? (
                <button
                  onClick={login}
                  className="px-6 py-2 border border-terminal-green hover:bg-terminal-green hover:text-black transition-colors flex items-center gap-2 font-bold w-full justify-center"
                >
                  <Lock size={16} /> CONNECT SECURE WALLET
                </button>
              ) : (
                <div className="flex flex-col gap-2 w-full">
                  <button
                    onClick={handlePay}
                    className="px-6 py-2 border border-terminal-green bg-terminal-green/10 hover:bg-terminal-green hover:text-black transition-colors flex items-center gap-2 font-bold justify-center"
                  >
                    <Unlock size={16} /> PAY 0.0001 ETH TO UNLOCK
                  </button>
                  {wallets && wallets[0]?.address && (
                    <button
                      onClick={async () => {
                        try {
                          const loadedHistory = await fetchChatHistory(
                            wallets[0].address,
                          );
                          if (loadedHistory.length > 0) {
                            setMessages((prev) => [
                              ...prev,
                              { role: "system", content: "SESSION RESTORED." },
                              ...loadedHistory.map((m) => ({
                                role: m.role,
                                content: m.content,
                              })),
                            ]);
                          } else {
                            setMessages((prev) => [
                              ...prev,
                              {
                                role: "system",
                                content: "NO PREVIOUS SESSION FOUND.",
                              },
                            ]);
                          }
                        } catch (e) {
                          console.error("Failed to load history", e);
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: "system",
                              content: "[ERROR: FAILED TO LOAD HISTORY]",
                            },
                          ]);
                        }
                      }}
                      className="px-6 py-2 border border-terminal-green/30 text-terminal-green/70 hover:text-terminal-green hover:border-terminal-green/70 transition-colors flex items-center gap-2 font-bold justify-center text-sm"
                    >
                      LOAD PREVIOUS SESSION
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSend} className="flex flex-1 gap-2">
              <span className="opacity-50 flex items-start bg-transparent pt-2">
                {">"}
              </span>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={sessionState === "inference"}
                placeholder="Enter prompt... (Shift+Enter for new line)"
                rows={Math.min(5, Math.max(1, input.split("\n").length))}
                className="flex-1 bg-transparent border-none outline-none text-terminal-green placeholder-terminal-green/30 resize-none overflow-y-auto mt-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim()) handleSend(e);
                  }
                }}
              />
              <button
                disabled={sessionState === "inference" || !input.trim()}
                type="submit"
                className="opacity-70 hover:opacity-100 disabled:opacity-30 p-2 self-start"
              >
                <Send size={18} />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Sidebar Column */}
      <div className="w-64 max-w-xs hidden md:flex flex-col gap-4 p-4 border-l border-terminal-green/20">
        <HardwareWidget
          nodes={availableNodes}
          selectedNode={selectedNode}
          nodeError={nodeError}
        />
        {authenticated && (
          <button
            onClick={logout}
            className="mt-auto px-4 py-2 border border-terminal-green/30 text-xs hover:text-red-400 hover:border-red-400 opacity-60 flex justify-center uppercase uppercase"
          >
            Disconnect Link
          </button>
        )}
      </div>
    </div>
  );
}
