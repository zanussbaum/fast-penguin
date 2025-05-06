<script>
	import { onMount } from 'svelte';

	let searchTerm = '';
	let searchType = 'semantic'; // 'semantic', 'fulltext', or 'phrase'
	let _previousSearchType = searchType; // For reactive statement
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

	// Reactive statement to re-fetch results when searchType changes
	$: {
	  if (searchType !== _previousSearchType) {
	    _previousSearchType = searchType; // Update for the next change
	    if (searchTerm.trim()) {
	      // console.log('Search type changed to:', searchType, '- re-fetching for:', searchTerm);
	      fetchResults();
	    }
	  }
	}

</script>

<svelte:head>
	<title>Wiki Search</title>
	<meta name="description" content="Search Wikipedia titles via Turbopuffer" />
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="page-wrapper">
	<header class="header">
		<h1>WikiExplorer</h1>
		<p class="subtitle">Discover articles with power and precision</p>
	</header>

	<div class="search-container">
		<div class="search-input-wrapper">
			<svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
			<input
				type="text"
				bind:value={searchTerm}
				on:input={handleInput}
				placeholder="Explore Wikipedia..."
				aria-label="Search Wikipedia Titles"
			/>
		</div>
		<div class="search-options">
			<label class:selected={searchType === 'semantic'}>
				<input type="radio" bind:group={searchType} value="semantic" />
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L9 9l-7 2.5L9 14l3 7 3-7 7-2.5L15 9z"/><path d="M22 12l-3-1.5L16 12l3 1.5L22 12zM10 22l-1.5-3L7 16l1.5 3L10 22z"/></svg>
				Semantic
			</label>
			<label class:selected={searchType === 'fulltext'}>
				<input type="radio" bind:group={searchType} value="fulltext" />
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
				Full-text
			</label>
			<label class:selected={searchType === 'phrase'}>
				<input type="radio" bind:group={searchType} value="phrase" />
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
				Phrase
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
						<div class="image-container">
							{#if result.ogImage}
								<img src={result.ogImage} alt="Preview for {result.title}" class="preview-image" loading="lazy"/>
							{:else}
								<div class="preview-placeholder">
									<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="12" x2="12" y2="12"></line></svg>
									<p>No Preview Available</p>
								</div>
							{/if}
						</div>
						<div class="content">
							<h2>{result.title}</h2>
							<p class="url-link">{result.url}</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
    {/if}
</div>

<style>
	:root {
		--font-primary: 'Inter', sans-serif;
		--color-background: #f4f7f9; /* Lighter gray background */
		--color-surface: #ffffff;
		--color-text-primary: #2c3e50; /* Darker, more saturated blue-gray */
		--color-text-secondary: #7f8c8d; /* Softer gray */
		--color-accent: #3498db; /* Vibrant blue */
		--color-accent-hover: #2980b9;
		--color-border: #e0e6ed;
		--shadow-sm: 0 2px 4px rgba(0,0,0,0.04);
		--shadow-md: 0 4px 12px rgba(0,0,0,0.08);
		--border-radius: 8px;
	}

	.page-wrapper {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		background-color: var(--color-background);
		min-height: 100vh;
		color: var(--color-text-primary);
		font-family: var(--font-primary);
		line-height: 1.6;
	}

	.header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.header h1 {
		font-size: 3rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0 0 0.25rem 0;
	}

	.header .subtitle {
		font-size: 1.15rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.search-container {
		background-color: var(--color-surface);
		padding: 2rem;
		border-radius: var(--border-radius);
		box-shadow: var(--shadow-md);
		margin-bottom: 2.5rem;
	}

	.search-input-wrapper {
		display: flex;
		align-items: center;
		background-color: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius);
		padding: 0 0.75rem;
		margin-bottom: 1.5rem;
		box-shadow: none;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.search-input-wrapper:focus-within {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.25);
	}

	.search-icon {
		color: var(--color-text-secondary);
		margin-right: 0.5rem;
		flex-shrink: 0;
	}

	input[type="text"] {
		flex-grow: 1;
		width: 100%;
		padding: 0.9rem 0.5rem;
		font-size: 1.1rem;
		font-family: var(--font-primary);
		color: var(--color-text-primary);
		border: none;
		outline: none;
		background-color: transparent;
		letter-spacing: 0.5px;
	}

	.search-options {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
	}

	.search-options label {
		flex-grow: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s ease-in-out;
		user-select: none;
	}

	.search-options label:hover {
		border-color: var(--color-accent-hover);
		color: var(--color-accent-hover);
		background-color: #eaf5fc;
	}

	.search-options label.selected {
		background-color: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
		box-shadow: 0 3px 10px rgba(52, 152, 219, 0.35);
	}

	.search-options label.selected svg {
		stroke: white;
	}

	.search-options label svg {
		stroke: var(--color-text-secondary);
		transition: stroke 0.2s ease-in-out;
	}

	.search-options label:hover svg {
		stroke: var(--color-accent-hover);
	}

	.search-options input[type="radio"] {
		display: none;
	}

	.status {
		text-align: center;
		margin: 2.5rem 0;
		font-size: 1.1rem;
		color: var(--color-text-secondary);
	}

    .status.error {
        color: #e74c3c;
		background-color: #ffebee;
		padding: 1rem;
		border-radius: var(--border-radius);
		border: 1px solid #e74c3c;
    }

	.results-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 1.5rem;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	}

	.result-item a {
		display: block;
		background-color: var(--color-surface);
		border-radius: var(--border-radius);
		text-decoration: none;
		color: var(--color-text-primary);
		transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.result-item a:hover {
		transform: translateY(-5px);
		box-shadow: var(--shadow-md);
	}

	.result-item .image-container {
		width: 100%;
		height: 180px;
		background-color: #e9ecef;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.preview-image {
		width: 100%;
        height: 100%;
        object-fit: cover;
	}
    
    .preview-placeholder {
		width: 100%;
        height: 100%; 
        display: flex;
        flex-direction: column; 
        align-items: center;
        justify-content: center;
        color: var(--color-text-secondary);
        font-size: 0.9rem;
    }

	.preview-placeholder svg {
		width: 40px;
		height: 40px;
		margin-bottom: 0.5rem;
		stroke-width: 1.5;
	}

	.result-item .content {
		padding: 1rem;
		flex-grow: 1;
		display: flex;
		flex-direction: column;
	}

	.result-item h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 0.5rem 0;
		line-height: 1.4;
	}

	.result-item .url-link {
		font-size: 0.85rem;
		color: var(--color-accent);
		word-break: break-all;
		margin-top: auto;
		text-decoration: none;
	}

	.result-item .url-link:hover {
		text-decoration: underline;
	}

</style>
