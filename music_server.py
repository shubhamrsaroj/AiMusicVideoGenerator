from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import torch
import torchaudio
from audiocraft.models import MusicGen
import os
from pathlib import Path
import uvicorn
import gc

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create temp directory
temp_dir = Path("temp")
temp_dir.mkdir(exist_ok=True)

# Global variables for model and device
model = None
device = None

def initialize_model():
    global model, device
    try:
        print("Loading MusicGen model...")
        model = MusicGen.get_pretrained('facebook/musicgen-small')
        
        # Set device
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model.to(device)
        
        # Set minimal generation parameters
        model.set_generation_params(
            use_sampling=True,
            top_k=50,
            top_p=0.7,
            temperature=0.7,
            duration=5,
            cfg_coef=3.0
        )
        print(f"Model loaded successfully on {device}!")
    except Exception as e:
        print(f"Error loading model: {e}")
        raise

# Initialize model at startup
initialize_model()

class MusicRequest(BaseModel):
    prompt: str
    duration: int

@app.post("/generate-music")
async def generate_music(request: MusicRequest):
    global model
    try:
        # Validate and limit duration
        duration = min(max(request.duration, 5), 30)
        print(f"Generating {duration}s music for: {request.prompt}")
        
        # Optimize prompt
        short_prompt = f"background music: {request.prompt[:100]}, instrumental"
        
        # Update duration
        model.set_generation_params(duration=duration)
        
        # Generate music
        print("Starting generation...")
        with torch.inference_mode():
            wav = model.generate([short_prompt])
        
        # Process output
        if device == "cuda":
            wav = wav.cpu()
        
        # Save file
        output_path = temp_dir / f"music_{os.urandom(4).hex()}.wav"
        torchaudio.save(str(output_path), wav[0], sample_rate=32000)
        print(f"Music saved to: {output_path}")
        
        # Cleanup
        del wav
        if device == "cuda":
            torch.cuda.empty_cache()
        gc.collect()
        
        return FileResponse(
            output_path,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename={output_path.name}"}
        )
    except Exception as e:
        print(f"Error generating music: {str(e)}")
        # Try to reinitialize model on error
        try:
            initialize_model()
        except:
            pass
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model": "musicgen-small",
        "device": device,
        "model_loaded": model is not None
    }

if __name__ == "__main__":
    print(f"Starting server on device: {device}")
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=5001,
        timeout_keep_alive=300
    ) 