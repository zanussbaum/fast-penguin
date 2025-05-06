<script>
	import { onMount } from 'svelte';

	let searchTerm = '';
	let searchMode = 'fulltext'; // 'fulltext' or 'semantic'
	let results = [];
	let isLoadingEmbedding = false;
	let isLoadingTurbopuffer = false;
	let error = null;
	let debounceTimer;

	const EMBEDDING_API_URL = import.meta.env.VITE_EMBEDDING_API_URL;

	async function fetchResults() {
		if (!searchTerm.trim()) {
			results = [];
			isLoadingEmbedding = false;
			isLoadingTurbopuffer = false;
			error = null;
			return;
		}

		error = null;
		results = []; // Clear previous results

		try {
			if (searchMode === 'semantic') {
				isLoadingEmbedding = true;
				isLoadingTurbopuffer = false;

				if (!EMBEDDING_API_URL) {
					throw new Error('Embedding API URL is not configured.');
				}

				const embedResponse = await fetch(EMBEDDING_API_URL, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ text: searchTerm })
				});

				if (!embedResponse.ok) {
					const errorData = await embedResponse.json().catch(() => ({ detail: 'Failed to get embedding details' }));
					throw new Error(`Embedding failed: ${errorData.detail || embedResponse.statusText}`);
				}
				const embeddingResult = await embedResponse.json();
				const queryVector = embeddingResult.embedding;

				if (!queryVector) {
					throw new Error('Failed to retrieve embedding vector.');
				}

				isLoadingEmbedding = false;
				isLoadingTurbopuffer = true;

				const searchResponse = await fetch('/api/search', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ vector: queryVector, mode: 'semantic', top_k: 10 }) // Pass vector
				});
				if (!searchResponse.ok) {
					let errorMsg = `Semantic search failed! status: ${searchResponse.status}`;
					try {
						const errorData = await searchResponse.json();
						errorMsg = errorData.error || errorMsg;
					} catch (e) { /* Do nothing */ }
					throw new Error(errorMsg);
				}
				results = await searchResponse.json();

			} else { // 'fulltext' search
				isLoadingEmbedding = false; // Ensure this is false
				isLoadingTurbopuffer = true;
				const response = await fetch('/api/search', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ query: searchTerm, mode: 'fulltext' }) // mode is 'fulltext'
				});

				// Check response status first
				if (!response.ok) {
					let errorMsg = `Fulltext search failed! status: ${response.status}`;
					try {
                    // Try to get more specific error from backend JSON response
						const errorData = await response.json();
						errorMsg = errorData.error || errorMsg;
					} catch (jsonError) {
                    // If response is not JSON, try getting text
						try {
							const errorText = await response.text();
							if (errorText) errorMsg += ` - ${errorText}`;
						} catch (textError) {
                        // Ignore if text cannot be read
						}
					}
					throw new Error(errorMsg);
				}

            // Ensure response is ok before parsing JSON
				results = await response.json(); 
			}
		} catch (e) {
			console.error('Search fetch error:', e); // Log the full error object
			console.error('Error name:', e.name);
			console.error('Error message:', e.message);
			console.error('Error stack:', e.stack);
			error = e.message || 'Failed to fetch results. Check console for details.';
			results = []; // Clear results on error
		} finally {
			isLoadingEmbedding = false;
			isLoadingTurbopuffer = false;
		}
	}

	// Function to toggle search mode
	function toggleSearchMode() {
		searchMode = searchMode === 'fulltext' ? 'semantic' : 'fulltext';
		// Optionally re-fetch results when mode changes if there's a search term
		if (searchTerm.trim()) {
			fetchResults();
		}
	}

	// Debounce the search input
	function handleInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			fetchResults();
		}, 500); // Wait 500ms after last keystroke
	}

    // Trigger initial search if needed (e.g., from query param - future enhancement)
	// onMount(() => {
	//     if (searchTerm) fetchResults(); 
	// });

</script>

<svelte:head>
	<title>Wiki Search</title>
	<meta name="description" content="Search Wikipedia titles via Turbopuffer" />
</svelte:head>

<div class="container">
	<h1>Wikipedia Title Search</h1>

	<div class="search-wrapper">
		<input
			type="text"
			bind:value={searchTerm}
			on:input={handleInput}
			placeholder="Search by title..."
			aria-label="Search Wikipedia Titles"
		/>
		<button on:click={toggleSearchMode} title="Toggle search mode (Currently: {searchMode})">
			{#if searchMode === 'fulltext'}
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg> 
			{:else} 
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> 
			{/if}
		</button>
	</div>

	{#if isLoadingEmbedding}
		<p class="status">Generating query embedding...</p>
	{:else if isLoadingTurbopuffer}
		<p class="status">Searching similar articles...</p>
	{:else if error}
		<p class="status error">Error: {error}</p>
	{:else if results.length > 0}
		<ul class="results-list">
			{#each results as result (result.id)}
				<li class="result-item">
					<a href={result.url} target="_blank" rel="noopener noreferrer">
						<h2>{result.title}</h2>
						{#if result.ogImage}
							<img src={result.ogImage} alt="Preview for {result.title}" class="preview-image" loading="lazy"/>
						{:else}
                            <div class="preview-placeholder">No Preview Available</div>
                        {/if}
					</a>
				</li>
			{/each}
		</ul>
    {:else if searchTerm.trim() && !isLoadingEmbedding && !isLoadingTurbopuffer}
        <p class="status">No results found for "{searchTerm}".</p>
	{/if}
</div>

<style>
	.container {
		max-width: 800px;
		margin: 2rem auto;
		padding: 1rem;
		font-family: sans-serif;
	}

	h1 {
		text-align: center;
		color: #333;
		margin-bottom: 1.5rem;
	}

	.search-wrapper {
		display: flex;
		align-items: center;
		margin-bottom: 1.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}

	input[type="text"] {
		display: block;
		flex-grow: 1; /* Allow input to take available space */
		padding: 0.8rem;
		font-size: 1.1rem;
		border: none; /* Remove individual border */
		border-radius: 0; 
		outline: none; /* Remove focus outline */
	}

	.search-wrapper button {
		background: none;
		border: none;
		padding: 0.5rem;
		margin-right: 0.3rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #555;
	}

	.search-wrapper button:hover {
		color: #000;
	}

	.search-wrapper button svg {
		width: 20px; /* Adjust icon size */
		height: 20px;
	}

	.status {
		text-align: center;
		margin-top: 2rem;
		color: #666;
	}

    .status.error {
        color: #d9534f; /* Red color for errors */
    }

	.results-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 1rem;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); 
	}

	.result-item a {
		display: block;
		border: 1px solid #eee;
		border-radius: 4px;
		padding: 1rem;
		text-decoration: none;
		color: #333;
		transition: background-color 0.2s ease;
        height: 100%; /* Make items fill grid cell height */
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
	}

	.result-item a:hover {
		background-color: #f9f9f9;
	}

	.result-item h2 {
		font-size: 1rem;
		margin: 0 0 0.5rem 0;
        flex-grow: 1; /* Allow title to take up space */
	}

	.preview-image {
		max-width: 100%;
        height: 150px; /* Fixed height */
		display: block;
		margin-top: auto; /* Pushes image towards bottom if title is short */
        object-fit: cover; /* Cover the area without distortion */
        border-radius: 3px;
	}
    
    .preview-placeholder {
        height: 150px; /* Match image height */
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: #f0f0f0;
        color: #999;
        border-radius: 3px;
        font-size: 0.9rem;
        margin-top: auto;
    }

</style>
