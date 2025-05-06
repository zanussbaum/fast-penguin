<script>
	import { onMount } from 'svelte';

	let searchTerm = '';
	let searchType = 'semantic'; // 'semantic', 'fulltext', or 'phrase'
	let results = [];
	let isLoadingEmbedding = false;
	let isLoadingTurbopuffer = false;
	let error = null;
	let debounceTimer;
	let searchPerformedForCurrentTerm = false; // New flag

	const EMBEDDING_API_URL = import.meta.env.VITE_EMBEDDING_API_URL;

	async function fetchResults() {
		if (!searchTerm.trim()) {
			results = [];
			isLoadingEmbedding = false;
			isLoadingTurbopuffer = false;
			error = null;
			searchPerformedForCurrentTerm = false; // Reset if term is empty
			return;
		}

		error = null;
		results = []; // Clear previous results

		try {
			if (searchType === 'semantic') {
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
					body: JSON.stringify({ vector: queryVector, mode: 'semantic', top_k: 20 }) // Pass vector
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

			} else if (searchType === 'fulltext') { // 'fulltext' search
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
			} else if (searchType === 'phrase') { // 'phrase' search
				isLoadingEmbedding = false; // Ensure this is false
				isLoadingTurbopuffer = true;
				const response = await fetch('/api/search', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ query: searchTerm, mode: 'phrase' }) // mode is 'phrase'
				});

				// Check response status first
				if (!response.ok) {
					let errorMsg = `Phrase search failed! status: ${response.status}`;
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
			searchPerformedForCurrentTerm = true; // Set flag after search completes
		}
	}

	// Debounce the search input
	function handleInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			fetchResults();
		}, 500); // Wait 500ms after last keystroke
		if (!searchTerm.trim()) {
			results = [];
			error = null;
			isLoadingEmbedding = false;
			isLoadingTurbopuffer = false;
			searchPerformedForCurrentTerm = false; // Reset if term is cleared
			return;
		}
		// When input changes, a new search hasn't been performed for this exact term yet
		// The debounced function will set it to true when it actually runs.
		// However, we want to clear previous 'no results' if user continues typing from a 'no results' state.
		// If results are empty AND searchWasPerformed, implies previous search yielded no results.
		// If user types more, we should clear the 'no results' message until new search completes.
		if (results.length === 0 && searchPerformedForCurrentTerm) {
       // This implies the last search for a *previous version* of searchTerm yielded no results.
       // As user is typing more, we can pre-emptively set searchPerformedForCurrentTerm to false
       // to hide "no results" until the new debounced search completes.
       searchPerformedForCurrentTerm = false;
    }
	}

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
		<div class="search-options">
			<label>
				<input type="radio" bind:group={searchType} value="semantic" /> Semantic
			</label>
			<label>
				<input type="radio" bind:group={searchType} value="fulltext" /> Full-text
			</label>
			<label>
				<input type="radio" bind:group={searchType} value="phrase" /> Phrase
			</label>
		</div>
	</div>

	{#if isLoadingEmbedding}
		<p class="status">Generating query embedding...</p>
	{:else if isLoadingTurbopuffer}
		<p class="status">Searching similar articles...</p>
	{:else if error}
		<p class="status error">Error: {error}</p>
	{:else if searchTerm && !isLoadingEmbedding && !isLoadingTurbopuffer && searchPerformedForCurrentTerm && results.length === 0}
        <p class="status">No results found for "{searchTerm}".</p>
	{/if}

	{#if results.length > 0}
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
		flex-direction: column;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	input[type="text"] {
		display: block;
		width: 100%;
		padding: 0.8rem;
		font-size: 1.1rem;
		border: none; /* Remove individual border */
		border-radius: 0; 
		outline: none; /* Remove focus outline */
	}

	.search-options {
		display: flex;
		justify-content: center;
		gap: 1rem; /* Adjusted gap for better spacing */
		margin-bottom: 1.5rem;
		align-items: center; /* Vertically align items if they wrap */
	}

	.search-options label {
		cursor: pointer;
		display: flex; /* Align radio button and text */
		align-items: center; /* Vertically center radio and text */
		padding: 0.5rem; /* Add some padding for easier clicking */
		border-radius: 4px; /* Slightly rounded corners for labels */
		transition: background-color 0.2s; /* Smooth background transition on hover */
	}

	.search-options label:hover {
		background-color: #ecf0f1; /* Light background on hover for better UX */
	}

   .search-options input[type="radio"] {
    margin-right: 0.5em; /* Space between radio button and text */
    cursor: pointer;
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
