from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import uvicorn 
from typing import List
import logging 

# --- Logging Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
MODEL_NAME = "nomic-ai/nomic-embed-text-v2-moe"
model = None 

# --- Pydantic Models for Request and Response ---
class EmbedRequest(BaseModel):
    text: str

class EmbedResponse(BaseModel):
    embedding: List[float]
    text: str

# --- FastAPI App ---
# Lifespan context manager for model loading/unloading
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the ML model
    global model
    logger.info(f"Loading model: {MODEL_NAME}...")
    try:
        model = SentenceTransformer(MODEL_NAME, trust_remote_code=True)
        logger.info("Model loaded successfully.")
    except Exception as e:
        logger.error(f"Error loading model: {e}")
        model = None 
    yield
    # Clean up the ML models and release the resources
    logger.info("Cleaning up model...")
    model = None


app = FastAPI(
    title="Embedding Service",
    description="A FastAPI server to generate text embeddings using Nomic.",
    version="0.1.0",
    lifespan=lifespan 
)

# --- CORS Middleware ---
# Define the origins that should be allowed to make cross-origin requests.
# For development, this includes your SvelteKit dev server and Windsurf preview.
# You might want to restrict this more in production.
allowed_origins = [
    "http://localhost:5173",    # Common SvelteKit dev port
    "http://127.0.0.1:5173",   # Common SvelteKit dev port
    # The Windsurf proxy URL can be dynamic. For local development, allowing all localhost origins
    # or a wildcard '*' is often done for convenience. Let's use '*' but with a strong warning.
    # For production, you MUST replace '*' with your specific frontend domain(s).
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins, 
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)


@app.post("/embed/", response_model=EmbedResponse)
async def get_embedding(request: EmbedRequest):
    if model is None:
        logger.error("Embedding request received but model is not loaded.")
        raise HTTPException(status_code=503, detail="Model not loaded or failed to load. Please check server logs.")

    logger.info(f"Received text for embedding: '{request.text}'")
    try:
        embedding_array = model.encode(request.text, prompt_name="query")
        embedding_list = embedding_array.tolist()
        logger.info(f"Generated embedding of dimension: {len(embedding_list)}")
        return EmbedResponse(embedding=embedding_list, text=request.text)
    except Exception as e:
        logger.error(f"Error during embedding generation for text '{request.text}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating embedding: {e}")


@app.get("/")
async def root():
    if model is None:
        return {"message": "Embedding server is running, but the model FAILED to load. Check logs. /embed/ endpoint will not work."}
    return {"message": "Embedding server is running. Use the POST /embed/ endpoint to get embeddings."}

# This __main__ block is for direct execution, e.g. `uv run python server.py`
# The `uv run fastapi dev server.py` command uses a different entry point.
if __name__ == "__main__":
    logger.info("Starting Uvicorn server from __main__ block (e.g., for 'uv run python server.py')...")
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info" 
    )