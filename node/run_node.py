import asyncio
import json
import os
import aiohttp
import websockets

BACKEND_WS_URL = os.getenv("BACKEND_WS_URL", "ws://localhost:8000/ws/provider")
OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
WALLET_ADDRESS = os.getenv("WALLET_ADDRESS", "0xTestProviderWallet")

async def test_ollama():
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{OLLAMA_API_URL}/api/tags") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    models = [m.get("name") for m in data.get("models", [])]
                    print(f"[Ollama] Models found: {models}")
                    # Prioritize exact match, else return the listed ones
                    if OLLAMA_MODEL in models:
                        return [OLLAMA_MODEL]
                    return models
    except Exception as e:
        print(f"[Ollama Error] Could not connect to local Ollama API at {OLLAMA_API_URL}.")
    return []

async def process_chat_task(ws, task_payload):
    request_id = task_payload.get("request_id")
    messages = task_payload.get("messages", [])
    model = task_payload.get("model", OLLAMA_MODEL)
    
    print(f"\\n[Task] Processing task {request_id} for model {model}...")
    
    req_data = {
        "model": model, 
        "messages": messages, 
        "stream": True
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{OLLAMA_API_URL}/api/chat", json=req_data) as response:
                if response.status != 200:
                    await ws.send(json.dumps({
                        "type": "chat_chunk",
                        "request_id": request_id, 
                        "error": f"Ollama HTTP {response.status}",
                        "done": True
                    }))
                    return
                
                async for chunk in response.content.iter_any():
                    if chunk:
                        lines = chunk.decode('utf-8').strip().split('\\n')
                        for line in lines:
                            if not line.strip(): continue
                            try:
                                data = json.loads(line)
                                content = data.get("message", {}).get("content", "")
                                done = data.get("done", False)
                                
                                await ws.send(json.dumps({
                                    "type": "chat_chunk",
                                    "request_id": request_id,
                                    "content": content,
                                    "done": done
                                }))
                            except json.JSONDecodeError:
                                pass # partial chunk handling
    except Exception as e:
        print(f"[Task Error] {e}")
        await ws.send(json.dumps({
            "type": "chat_chunk",
            "request_id": request_id,
            "error": str(e),
            "done": True
        }))

async def model_updater(ws):
    current_models = []
    while True:
        try:
            models = await test_ollama()
            if models != current_models:
                current_models = models
                print(f"\\n[Node] Dynamic Update - Current Models: {models}")
                await ws.send(json.dumps({
                    "type": "register",
                    "models": models
                }))
        except Exception:
            pass
        await asyncio.sleep(10)

async def run_node():
    print("==========================================")
    print("      BIT-BRAIN DECENTRALIZED NODE        ")
    print("==========================================")
    print(f"Wallet        : {WALLET_ADDRESS}")
    print(f"Backend       : {BACKEND_WS_URL}")
    print(f"Ollama API    : {OLLAMA_API_URL}")
    print("------------------------------------------")
    
    ws_url = f"{BACKEND_WS_URL}/{WALLET_ADDRESS}"
    
    while True:
        try:
            print(f"\\n[Node] Connecting to backend at {ws_url}...")
            async with websockets.connect(ws_url) as ws:
                print(f"[Node] Connected to backend! Waiting for models and tasks...")
                
                updater_task = asyncio.create_task(model_updater(ws))
                
                # Listen for tasks
                while True:
                    try:
                        msg = await ws.recv()
                        payload = json.loads(msg)
                        if payload.get("type") == "chat_task":
                            # Process task in background
                            asyncio.create_task(process_chat_task(ws, payload))
                    except websockets.exceptions.ConnectionClosed:
                        updater_task.cancel()
                        break
                        
        except (websockets.exceptions.ConnectionClosedError, ConnectionRefusedError) as e:
            print(f"[Node] Connection failed or closed: {e}. Retrying in 5 seconds...")
            await asyncio.sleep(5)
        except Exception as e:
            print(f"[Node] Unexpected error: {e}")
            await asyncio.sleep(5)

if __name__ == "__main__":
    asyncio.run(run_node())
