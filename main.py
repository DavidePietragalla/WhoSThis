from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import os
from typing import List

import torch
import torch.nn.functional as F

from student_model import StudentECAPA

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_FILE = "voice_profiles.json"
MODEL_PATH = "../best_model.pt"

# Limit websocket buffer to ~30 seconds of float32 audio at 16kHz (30 * 16000 * 4 bytes)
MAX_BUFFER_SIZE = 1920000 

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

try:
    model = StudentECAPA(scale_fraction=0.5).to(device)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device), strict=False)
    model.eval()
    print("Model loaded successfully.")
except Exception as e:
    print(f"Error loading model: {e}")

def load_profiles():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r") as f:
            return json.load(f)
    return {}

def save_profile(name: str, embedding: List[float]):
    profiles = load_profiles()
    profiles[name] = embedding
    with open(DB_FILE, "w") as f:
        json.dump(profiles, f, indent=4)

def extract_embedding(audio_bytes: bytes) -> torch.Tensor:
    # Convert raw bytes to float32 tensor directly in RAM
    waveform = torch.frombuffer(audio_bytes, dtype=torch.float32).clone()
    
    # Add batch dimension -> Shape: (1, Num_Samples)
    tensor_input = waveform.unsqueeze(0).to(device)
    rel_lengths = torch.ones(1).to(device)
    
    with torch.no_grad():
        # Updated to match the new forward method returning the tensor directly
        emb = model(tensor_input, rel_lengths)
        
    return emb.squeeze()

def get_best_match(current_emb: torch.Tensor, profiles: dict, threshold: float = 0.75) -> str:
    best_match = "Unknown"
    best_score = -1.0
    
    for name, saved_emb_list in profiles.items():
        saved_emb = torch.tensor(saved_emb_list).to(device)
        score = F.cosine_similarity(current_emb.unsqueeze(0), saved_emb.unsqueeze(0)).item()
        
        if score > best_score and score > threshold:
            best_score = score
            best_match = name
            
    return best_match

@app.post("/create_profile")
async def create_profile(name: str = Form(...), files: List[UploadFile] = File(...)):
    embeddings = []
    
    for file in files:
        audio_bytes = await file.read()
        # Ensure to only process files with actual data
        if len(audio_bytes) > 0:
            emb = extract_embedding(audio_bytes)
            embeddings.append(emb)
    
    if not embeddings:
         return {"error": "No valid audio data received."}
         
    avg_embedding = torch.stack(embeddings).mean(dim=0)
    normalized_embedding = F.normalize(avg_embedding, p=2, dim=0)
    
    save_profile(name, normalized_embedding.cpu().tolist())
    
    return {"status": "success", "message": f"Profile '{name}' saved with {len(embeddings)} samples."}

@app.get("/profiles")
def get_profiles():
    profiles = load_profiles()
    return {"profiles": list(profiles.keys())}

@app.delete("/profile/{name}")
def delete_profile(name: str):
    profiles = load_profiles()
    if name in profiles:
        del profiles[name]
        with open(DB_FILE, "w") as f:
            json.dump(profiles, f, indent=4)
        return {"status": "success", "message": f"Profile '{name}' deleted."}
    raise HTTPException(status_code=404, detail="Profile not found")

@app.websocket("/ws/listen")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    audio_buffer = bytearray()
    
    window_bytes = 16000 * 4 * 3
    
    try:
        while True:
            data = await websocket.receive_bytes()
            audio_buffer.extend(data)
            
            if len(audio_buffer) >= window_bytes:
                audio_buffer = audio_buffer[-window_bytes:]
                waveform = torch.frombuffer(audio_buffer, dtype=torch.float32).clone()
                
                recent_audio = waveform[-8192:]
                energy = torch.sqrt(torch.mean(recent_audio ** 2)).item()
                
                if energy < 0.005: 
                    await websocket.send_json({"speaker": "Nobody"})
                    continue
                
                tensor_input = waveform.unsqueeze(0).to(device)
                rel_lengths = torch.ones(1).to(device)
                
                with torch.no_grad():
                    current_embedding = model(tensor_input, rel_lengths).squeeze()
                    current_embedding = F.normalize(current_embedding, p=2, dim=0)
                
                profiles = load_profiles()
                best_match = get_best_match(current_embedding, profiles, threshold=0.40)
                
                await websocket.send_json({"speaker": best_match})
                
    except WebSocketDisconnect:
        print("Client disconnected.")
        
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)