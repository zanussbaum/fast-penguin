<script>
	import { onMount } from 'svelte';

	let searchTerm = '';
	let results = [];
	let isLoading = false;
	let error = null;
	let debounceTimer;

	async function fetchResults() {
		if (!searchTerm.trim()) {
			results = [];
			isLoading = false;
			error = null;
			return;
		}

		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/search', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ query: searchTerm })
			});

			// Check response status first
			if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
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
			
		} catch (e) {
			console.error('Search fetch error:', e); // Log the full error object
            console.error('Error name:', e.name);
            console.error('Error message:', e.message);
            console.error('Error stack:', e.stack);
			error = e.message || 'Failed to fetch results. Check console for details.';
			results = []; // Clear results on error
		} finally {
			isLoading = false;
		}
	}

	// Debounce the search input
	function handleInput() {
		clearTimeout(debounceTimer);
        isLoading = true; // Show loading indicator immediately on input
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

	<input
		type="text"
		bind:value={searchTerm}
		on:input={handleInput}
		placeholder="Search by title..."
		aria-label="Search Wikipedia Titles"
	/>

	{#if isLoading}
		<p class="status">Loading...</p>
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
    {:else if searchTerm.trim() && !isLoading}
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

	input[type="text"] {
		display: block;
		width: 100%;
		padding: 0.8rem;
		font-size: 1.1rem;
		margin-bottom: 1.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
        box-sizing: border-box; /* Include padding in width */
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
        /* Responsive grid */
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
