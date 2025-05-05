import os
import numpy as np
import turbopuffer as tpuf
from datasets import load_dataset
from tqdm import tqdm
import logging
import argparse
import glob
import natsort
import gc
import concurrent.futures
import time
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# --- Configuration ---
DATASET_NAME = "nomic-ai/nomic-embed-v2-wikivecs"
VECTOR_DIR = "./nomic_embed_v2_eng_wiki"
DEFAULT_NAMESPACE = "nomic-wiki"
BATCH_SIZE = 1000 # Process dataset and vectors in batches of this size
VECTOR_DIMENSION = 768

# --- Setup Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Argument Parsing ---
parser = argparse.ArgumentParser(description="Upload filtered Hugging Face dataset and corresponding vectors to Turbopuffer.")
parser.add_argument("--namespace", type=str, default=DEFAULT_NAMESPACE, help="Turbopuffer namespace name.")
parser.add_argument("--vector_dir", type=str, default=VECTOR_DIR, help="Directory containing vector .npy files (assumed to match filtered dataset order).")
parser.add_argument("--batch_size", type=int, default=BATCH_SIZE, help="Batch size for processing and uploading.")
parser.add_argument("--num-workers", type=int, default=8, help='Number of worker threads for uploading.')
parser.add_argument("--api_key", type=str, default=os.environ.get("TPUF_API_KEY"), help="Turbopuffer API Key (or set TPUF_API_KEY env var).")
parser.add_argument("--max_rows", type=int, default=None, help="Maximum number of FILTERED rows to process (for testing).")
args = parser.parse_args()

if not args.api_key:
    logging.error("Turbopuffer API key not found. Set TPUF_API_KEY environment variable or use --api_key argument.")
    exit(1)

tpuf.api_key = args.api_key
namespace = args.namespace
vector_dir = args.vector_dir
batch_size = args.batch_size
num_workers = args.num_workers
logging.info(f"Target Turbopuffer Namespace: {namespace}")
logging.info(f"Vector Directory: {vector_dir}")
logging.info(f"Batch Size: {batch_size}")
logging.info(f"Using {num_workers} worker threads for upload.")

# --- Main Execution ---
# 1. Load and Filter Dataset
# Load metadata first (can take time/memory)
logging.info(f"Loading dataset metadata: {DATASET_NAME}...")
# Consider select_columns here if memory is tight, but filter needs 'subset'
ds = load_dataset(DATASET_NAME, split='train')
logging.info(f"Original dataset loaded with {len(ds)} rows.")

logging.info("Filtering dataset (subset != '20231101.en')...")
# Use more processors if available, adjust based on system memory
num_procs_filter = max(1, os.cpu_count() // 2)
logging.info(f"Using {num_procs_filter} processes for filtering.")
filtered_ds = ds.filter(lambda row: row.get('subset') == '20231101.en', num_proc=num_procs_filter)
filtered_num_rows = len(filtered_ds)
logging.info(f"Filtered dataset has {filtered_num_rows} rows.")

# Select only necessary columns AFTER filtering
filtered_ds = filtered_ds.select_columns(['wid', 'title', 'url'])

# Apply row limit for testing AFTER filtering
if args.max_rows is not None and filtered_num_rows > args.max_rows:
    logging.info(f"Limiting filtered dataset to first {args.max_rows} rows for testing.")
    filtered_ds = filtered_ds.select(range(args.max_rows))
    filtered_num_rows = len(filtered_ds) # Update count after select
    logging.info(f"Dataset limited to {filtered_num_rows} rows for processing.")

# Free memory from original dataset
logging.info("Deleting original dataset from memory...")
del ds
gc.collect()

# 2. Prepare Vector Files
logging.info("Scanning for vector files...")
vector_files = natsort.natsorted(glob.glob(os.path.join(vector_dir, '*.npy')))
if not vector_files:
    logging.error(f"No .npy files found in directory: {vector_dir}")
    raise FileNotFoundError(f"No .npy files found in {vector_dir}")
logging.info(f"Found {len(vector_files)} vector files, starting with {vector_files[0]}")

# 3. Initialize Turbopuffer
try:
    ns = tpuf.Namespace(namespace)
    # Optional: Clear namespace before upload, handle if it doesn't exist
    logging.info(f"Attempting to clear namespace '{namespace}'...")
    try:
        ns.delete_all()
        logging.info(f"Namespace '{namespace}' cleared successfully.")
    except tpuf.NotFoundError:
        logging.info(f"Namespace '{namespace}' not found or already empty, continuing.")
    except tpuf.APIError as e:
        logging.error(f"API error during delete_all (not 404): {e}")
        raise e
except Exception as e:
    logging.error(f"Failed to initialize Turbopuffer namespace '{namespace}': {e}")
    exit(1)


def upload_batch(ns, batch_vectors, batch_ds):
    """Helper function to upload a single batch to Turbopuffer."""
    ids = batch_ds['wid']
    titles = batch_ds['title']
    urls = batch_ds['url']
    try:
        ns.write(
            upsert_columns={
                'id': ids,
                'vector': batch_vectors.tolist(),
                'title': titles,
                'url': urls
            },
            distance_metric='cosine_distance',
            schema={
                "title": { # Configure FTS/BM25, other attribtues have inferred types (name: str, public: int)
                    "type": "string",
                    # More schema & FTS options https://turbopuffer.com/docs/schema
                    "full_text_search": True,
                }
            }
        )
        return len(ids) # Return the number of vectors uploaded in this batch
    except Exception as e:
        print(f"Error uploading batch: {e}")
        # Re-raise the exception so tenacity can catch it
        raise e 

# Define retry strategy: wait exponentially starting from 1s, max 10s, up to 3 attempts
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10), retry=retry_if_exception_type(Exception))
def upload_batch_with_retries(ns, batch_vectors, batch_ds):
    """Wrapper function to call upload_batch with retries."""
    # print(f"Attempting to upload batch of size {len(batch_ds['wid'])}") # Optional: for debugging retries
    try:
        return upload_batch(ns, batch_vectors, batch_ds)
    except Exception as e:
        print(f"Upload attempt failed: {e}. Retrying...")
        raise # Reraise exception to trigger tenacity retry

def upload_vectors(vector_files, filtered_ds, ns, batch_size=5000, max_workers=8):
    total_vectors_uploaded = 0
    probbar = tqdm(total=len(filtered_ds), desc="Uploading vectors")

    vector_offset = 0 # Track the starting index in filtered_ds for the current file
    for file in vector_files:
        current_vector_file_handle = np.load(file, mmap_mode='r')
        num_vectors_in_current_file = current_vector_file_handle.shape[0]

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            for i in range(0, num_vectors_in_current_file, batch_size):
                # Determine the actual slice for vectors in this batch
                vector_batch_end_index_in_file = min(i + batch_size, num_vectors_in_current_file)
                batch_vectors = current_vector_file_handle[i:vector_batch_end_index_in_file]
                actual_batch_vector_count = batch_vectors.shape[0]

                # Calculate corresponding slice indices for the dataset
                batch_start_index_in_ds = vector_offset + i
                # Use the *actual* count of vectors in this batch for the end index
                batch_end_index_in_ds = batch_start_index_in_ds + actual_batch_vector_count

                # Slice the corresponding part of filtered_ds using the corrected indices
                curr_batch_ds = filtered_ds[batch_start_index_in_ds:min(batch_end_index_in_ds, len(filtered_ds))]
                # Ensure the shapes match before submitting
                if actual_batch_vector_count == len(curr_batch_ds['wid']): # Check length of a specific column
                    # Submit the wrapper function with retry logic
                    future = executor.submit(upload_batch_with_retries, ns, batch_vectors, curr_batch_ds)
                    futures.append(future)
                else:
                    # This warning might still occur if total vectors != total filtered rows
                    print(f"Warning: Skipping batch due to shape mismatch. Vector batch size: {actual_batch_vector_count}, Dataset batch size: {len(curr_batch_ds)}")
                    # Advance progress bar by the number of vectors we processed, even if skipped
                    probbar.update(actual_batch_vector_count)

            for future in concurrent.futures.as_completed(futures):
                try:
                    uploaded_count = future.result()
                    if uploaded_count: # Ensure result is not None or 0 if retries failed completely
                         probbar.update(uploaded_count)
                         total_vectors_uploaded += uploaded_count
                except Exception as e:
                    # This exception occurs if all retries failed
                    print(f"An error occurred during upload after multiple retries: {e}")
                    # Optionally, log the failed batch details here

        # Update the offset for the next file
        vector_offset += num_vectors_in_current_file

    probbar.close()
    print(f"Finished uploading {total_vectors_uploaded} vectors.")

upload_vectors(vector_files, filtered_ds, ns, batch_size=batch_size, max_workers=num_workers)