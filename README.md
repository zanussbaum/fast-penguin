# Fast Penguin - Wikipedia Search

This project provides tools to upload data (likely Wikipedia content) to a Turbopuffer vector database and a Svelte-based frontend to search through that data.

# Quickstart

Prerequisites:

1. Python 3.8 or higher and less than 3.12
2. Node.js 16 or higher
3. A Turbopuffer API key

## Embedding Server Install

1. uv venv --python=3.10
2. uv sync
3. uv run fastapi dev server.py

Make sure to wait for the server to startup.

## Svelte Frontend Install

1. cd wiki-search-frontend
2. npm install
3. npm run dev
4. Add the following to your .env file:

```bash
TPUF_API_KEY=<your-turbopuffer-api-key>
VITE_EMBEDDING_API_URL="http://localhost:8000/embed"
```

Open `http://localhost:5173` in your browser.

## Notes

Most of this code, especially the frontend, is vibe-coded with Windsurf. I wanted to see what svelte is like but not sure if it's setup in the correct way!

You can upload vectors to Turbopuffer using the `upload_to_turbopuffer.py` script. I used the English Wikipedia vectors from [Nomic Embed v2](https://huggingface.co/datasets/nomic-ai/nomic-embed-v2-wikivecs). I uploaded the first 5M or so but you can use any vectors you want. Make sure to swap out the `MODEL_NAME` in `server.py` if you do so. 
