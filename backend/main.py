import os
import time
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from web3 import Web3
import httpx
import json
import asyncio
import uuid
from typing import Dict, Any, List

STATIC_ROOT = Path(__file__).resolve().parent / "static"


def _spa_available() -> bool:
    return (STATIC_ROOT / "index.html").is_file()

app = FastAPI(title="The Bit-Brain")

# CORS: comma-separated origins in CORS_ORIGINS; unset or "*" = any origin (demo)
_cors_raw = os.getenv("CORS_ORIGINS", "*").strip()
if not _cors_raw or _cors_raw == "*":
    _cors_origins = ["*"]
    _cors_credentials = False
else:
    _cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
    _cors_credentials = True
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_CITREA_RPC_URL = "https://rpc.testnet.citrea.xyz"
CITREA_RPC_URLS = [
    url.strip()
    for url in os.getenv(
        "CITREA_RPC_URLS",
        os.getenv("CITREA_RPC_URL", DEFAULT_CITREA_RPC_URL),
    ).split(",")
    if url.strip()
]
if not CITREA_RPC_URLS:
    CITREA_RPC_URLS = [DEFAULT_CITREA_RPC_URL]
CONTRACT_ADDRESS = os.getenv(
    "CONTRACT_ADDRESS", "0xC8014e9D37cc59Fed1988aCbfFE59246A16374AA"
)
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

web3 = Web3(Web3.HTTPProvider(CITREA_RPC_URLS[0], request_kwargs={"timeout": 12}))

# Simplified ABI for expiryTimestamp
ABI = [
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "expiryTimestamp",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]

# Set up contract readers if an address is provided
if CONTRACT_ADDRESS != "0x0000000000000000000000000000000000000000":
    contract_address = web3.to_checksum_address(CONTRACT_ADDRESS)
    contract_readers = [
        (
            url,
            Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 12})).eth.contract(
                address=contract_address, abi=ABI
            ),
        )
        for url in CITREA_RPC_URLS
    ]
else:
    contract_address = None
    contract_readers = []

# Context Management
MAX_CONTEXT_MESSAGES = 10
# Full transcript for GET /history (session restore UI), not LLM context
MAX_SESSION_RESTORE_MESSAGES = 500
SYSTEM_PROMPT = "You are Bit-Brain, an AI consciousness hosted on a private GPU, settled on Bitcoin via Citrea. Be witty, technical, and cypherpunk. Provide detailed, helpful answers. Explain your reasoning when appropriate. Use formatting for clarity but avoid generic filler phrases."


# SQLite History Init
def init_db():
    conn = sqlite3.connect("chat_history.db")
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS history
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  wallet_address TEXT,
                  role TEXT,
                  content TEXT)""")
    conn.commit()
    conn.close()


init_db()


def get_history(address, limit: int | None = None):
    lim = MAX_CONTEXT_MESSAGES if limit is None else limit
    conn = sqlite3.connect("chat_history.db")
    c = conn.cursor()
    c.execute(
        "SELECT role, content FROM history WHERE wallet_address=? ORDER BY id DESC LIMIT ?",
        (address, lim),
    )
    rows = c.fetchall()
    conn.close()
    return [{"role": r[0], "content": r[1]} for r in reversed(rows)]


def add_message(address, role, content):
    conn = sqlite3.connect("chat_history.db")
    c = conn.cursor()
    c.execute(
        "INSERT INTO history (wallet_address, role, content) VALUES (?, ?, ?)",
        (address, role, content),
    )
    conn.commit()
    conn.close()


async def read_expiry_timestamp(checksum_addr: str) -> int:
    last_error = None

    for attempt in range(3):
        for rpc_url, reader in contract_readers:
            try:
                return await asyncio.to_thread(
                    reader.functions.expiryTimestamp(checksum_addr).call
                )
            except Exception as e:
                last_error = e
                print(
                    f"Contract check RPC error on attempt {attempt + 1} "
                    f"({rpc_url}): {e}"
                )
        await asyncio.sleep(0.5 * (attempt + 1))

    raise RuntimeError(f"Citrea RPC unavailable after retries: {last_error}")


class ChatRequest(BaseModel):
    wallet_address: str
    prompt: str
    target_node: str | None = None
    target_model: str | None = None

# Node Management
class ConnectionManager:
    def __init__(self):
        # active_nodes: node_id -> {"websocket": WebSocket, "models": list, "wallet": str}
        self.active_nodes: Dict[str, Dict[str, Any]] = {}
        # pending_tasks: request_id -> asyncio.Queue
        self.pending_tasks: Dict[str, asyncio.Queue] = {}

    async def connect(self, websocket: WebSocket, node_id: str, wallet: str):
        await websocket.accept()
        self.active_nodes[node_id] = {"websocket": websocket, "models": [], "wallet": wallet}

    def disconnect(self, node_id: str):
        if node_id in self.active_nodes:
            del self.active_nodes[node_id]

    async def update_models(self, node_id: str, models: list):
        if node_id in self.active_nodes:
            self.active_nodes[node_id]["models"] = models

    async def send_task(self, node_id: str, task_payload: dict):
        if node_id in self.active_nodes:
            await self.active_nodes[node_id]["websocket"].send_json(task_payload)

manager = ConnectionManager()

@app.get("/")
def root():
    if _spa_available():
        return FileResponse(STATIC_ROOT / "index.html")
    return {"service": "bitbrain-api", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/provider/{wallet_address}")
async def websocket_provider(websocket: WebSocket, wallet_address: str):
    # Determine basic node id
    node_id = str(uuid.uuid4())[:8]
    await manager.connect(websocket, node_id, wallet_address)
    print(f"[DEBUG] Provider Node {node_id} connected (Wallet: {wallet_address})")
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "register":
                models = data.get("models", [])
                await manager.update_models(node_id, models)
                print(f"[DEBUG] Node {node_id} registered models: {models}")
            
            elif msg_type == "chat_chunk":
                req_id = data.get("request_id")
                content = data.get("content", "")
                done = data.get("done", False)
                error = data.get("error")
                
                if req_id in manager.pending_tasks:
                    q = manager.pending_tasks[req_id]
                    if error:
                        await q.put({"error": error})
                        await q.put(None) # Signal end
                    else:
                        if content:
                            await q.put({"content": content})
                        if done:
                            await q.put(None) # Signal end
                            
    except WebSocketDisconnect:
        print(f"[DEBUG] Node {node_id} disconnected")
        manager.disconnect(node_id)


@app.get("/nodes")
def get_active_nodes():
    nodes_info = []
    for nid, data in manager.active_nodes.items():
        nodes_info.append({
            "node_id": nid,
            "wallet": data["wallet"],
            "models": data["models"]
        })
    return {"nodes": nodes_info}


@app.post("/chat")
async def chat(request: ChatRequest):
    address = request.wallet_address
    target_node = request.target_node
    target_model = request.target_model
    
    print(f"\\n[DEBUG] Incoming chat request from wallet: {address}")
    try:
        checksum_addr = web3.to_checksum_address(address)
    except ValueError:
        print(f"[DEBUG] ValueError: {address} is not a valid address.")
        raise HTTPException(
            status_code=400, detail=f"Invalid wallet address: '{address}'"
        )

    # Blockchain validation (with a 60 second grace period)
    if contract_readers:
        try:
            expiry = await read_expiry_timestamp(checksum_addr)
            if (expiry + 60) < time.time():
                raise HTTPException(status_code=403, detail="Session expired")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            print(f"Contract check error: {e}")
            raise HTTPException(
                status_code=503,
                detail=(
                    "Citrea RPC temporarily unavailable while validating access. "
                    "Your payment may be confirmed; retry chat in a few seconds."
                ),
            )

    # If no target node specified, we can try to find one or fallback to local
    use_local_fallback = False
    selected_node = None
    if target_node and target_node in manager.active_nodes:
        selected_node = target_node
    elif target_node == "local_fallback" or not manager.active_nodes:
        use_local_fallback = True
    else:
        # Just pick the first available node (rudimentary load balancing)
        selected_node = list(manager.active_nodes.keys())[0]

    # Save user prompt & manage user context
    add_message(checksum_addr, "user", request.prompt)
    history = get_history(checksum_addr)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history

    # Async generator for SSE
    async def stream_generator():
        full_response = ""
        
        if use_local_fallback:
            # ORIGINAL LOCAL BEHAVIOR
            async with httpx.AsyncClient() as client:
                try:
                    req_data = {"model": OLLAMA_MODEL, "messages": messages, "stream": True}
                    async with client.stream(
                        "POST", OLLAMA_URL, json=req_data, timeout=None
                    ) as response:
                        if response.status_code != 200:
                            yield f"data: {json.dumps({'error': f'Ollama error: {response.status_code}'})}\\n\\n"
                            return

                        async for chunk in response.aiter_lines():
                            if chunk:
                                try:
                                    data = json.loads(chunk)
                                    content = data.get("message", {}).get("content", "")
                                    full_response += content
                                    yield f"data: {json.dumps({'content': content})}\\n\\n"
                                except Exception as e:
                                    pass

                except httpx.RequestError as e:
                    yield f"data: {json.dumps({'error': f'Error communicating with local Ollama: {str(e)}'})}\\n\\n"
        else:
            # RELAY TO DECENTRALIZED NODE
            req_id = str(uuid.uuid4())
            q = asyncio.Queue()
            manager.pending_tasks[req_id] = q
            
            task_payload = {
                "type": "chat_task",
                "request_id": req_id,
                "model": target_model or "llama3",
                "messages": messages
            }
            
            try:
                await manager.send_task(selected_node, task_payload)
            except Exception as e:
                yield f"data: {json.dumps({'error': f'Failed to send task to node {selected_node}'})}\\n\\n"
                del manager.pending_tasks[req_id]
                return
                
            try:
                while True:
                    # Implement local timeout to not hang forever if node dies
                    chunk_data = await asyncio.wait_for(q.get(), timeout=30.0)
                    if chunk_data is None:
                        break # Done
                    if "error" in chunk_data:
                        yield f"data: {json.dumps({'error': f'Node Error: {chunk_data['error']}'})}\\n\\n"
                        break
                    
                    content = chunk_data.get("content", "")
                    full_response += content
                    yield f"data: {json.dumps({'content': content})}\\n\\n"
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'error': f'Node {selected_node} timed out'})}\\n\\n"
            finally:
                if req_id in manager.pending_tasks:
                    del manager.pending_tasks[req_id]

        if full_response:
            add_message(checksum_addr, "assistant", full_response)

    return StreamingResponse(stream_generator(), media_type="text/event-stream")


@app.get("/history/{address}")
async def get_history_endpoint(address: str):
    try:
        checksum_addr = web3.to_checksum_address(address)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    history = get_history(checksum_addr, limit=MAX_SESSION_RESTORE_MESSAGES)
    return {"history": history}


# Vite demo bundle: `frontend` → `npm run build:demo` → copy `dist` to `backend/static`
if _spa_available():
    _assets = STATIC_ROOT / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    @app.get("/{spa_path:path}")
    async def spa_fallback(spa_path: str):
        if spa_path.startswith("history/"):
            raise HTTPException(status_code=404)
        candidate = (STATIC_ROOT / spa_path).resolve()
        try:
            candidate.relative_to(STATIC_ROOT.resolve())
        except ValueError:
            raise HTTPException(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_ROOT / "index.html")
