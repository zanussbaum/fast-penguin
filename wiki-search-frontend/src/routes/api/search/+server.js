import { json } from '@sveltejs/kit';
import { TPUF_API_KEY } from '$env/static/private';
import fetch from 'node-fetch'; // Keep for OG image fetch
import { parse } from 'node-html-parser'; // Keep for OG image fetch
import { Turbopuffer } from '@turbopuffer/turbopuffer'; // Import the client

const NAMESPACE = 'nomic-wiki'; // Your Turbopuffer namespace

// Helper function to fetch and parse og:image
async function fetchOgImage(url) {
    if (!url || !url.startsWith('http')) { // Basic URL validation
        console.warn(`Skipping invalid URL for OG image fetch: ${url}`);
        return null;
    }
    try {
        // Use a timeout to prevent hanging on slow sites
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds

        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // Common browser user agent
                'Accept': 'text/html'
            },
            signal: controller.signal // Pass the AbortController's signal
        });
        
        clearTimeout(timeoutId); // Clear the timeout if fetch completes

        if (!response.ok) {
            console.error(`Failed to fetch ${url}: ${response.status}`);
            return null;
        }

        // Check content type to avoid parsing non-html
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('text/html')) {
            console.warn(`Skipping non-HTML content at ${url}`);
            return null;
        }

        const html = await response.text();
        const root = parse(html);
        // Look for og:image meta tag
        const imageTag = root.querySelector('meta[property="og:image"]');
        const imageUrl = imageTag ? imageTag.getAttribute('content') : null;
        
        // Basic validation for the found image URL
        if (imageUrl && imageUrl.startsWith('http')) {
            return imageUrl;
        } else {
            console.warn(`Found invalid or relative og:image URL at ${url}: ${imageUrl}`);
            return null;
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`Timeout fetching OG image for ${url}`);
        } else {
            console.error(`Error fetching or parsing ${url}:`, error.message);
        }
        return null;
    }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    let query;
    try {
        const requestData = await request.json();
        query = requestData.query;
    } catch (e) {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof query !== 'string' || query.trim() === '') {
        return json({ error: 'Query parameter must be a non-empty string' }, { status: 400 });
    }

    if (!TPUF_API_KEY) {
        console.error('Turbopuffer API key (TPUF_API_KEY) not configured in .env');
        return json({ error: 'Server configuration error' }, { status: 500 });
    }

    // --- TEMPORARY DEBUG LOG: Verify API Key --- 
    console.log(`[DEBUG] API Key loaded by server: ${TPUF_API_KEY ? TPUF_API_KEY.substring(0, 8) + '...' : 'MISSING!'}`);
    // --- REMOVE THIS LOG AFTER TESTING --- 

    // Instantiate the Turbopuffer client
    const tpuf = new Turbopuffer({ apiKey: TPUF_API_KEY });

    try {
        console.log(`Performing Turbopuffer search for query: "${query}" using client library`);
        
        // Get the specific namespace object from the client
        const ns = tpuf.namespace(NAMESPACE);

        // Use the namespace object's query method according to FTS docs
        const queryResult = await ns.query({
            // Use rank_by array: [attribute, method, query]
            rank_by: ['title', 'BM25', query],
            top_k: 20, // Use top_k instead of limit for rank_by
            include_attributes: ['title', 'url']
        });

        // --- TEMPORARY DEBUG LOG: Log full query result --- 
        console.log('[DEBUG] Full queryResult:', JSON.stringify(queryResult, null, 2));
        // --- REMOVE THIS LOG AFTER TESTING --- 

        // Check for errors returned by the client library itself
        // (Note: The client might throw errors directly for network/auth issues)
        if (!queryResult) { // Or check specific error indicators if the client has them
            console.error('Turbopuffer client query failed, but did not throw. Response:', queryResult);
            return json({ error: 'Turbopuffer query failed unexpectedly.' }, { status: 500 });
        }
        
        // Access results (adjust based on the actual structure returned by the client)
        const results = queryResult.vectors || queryResult || []; // Try accessing queryResult directly if .vectors is empty/undefined

        console.log(`Received ${results.length} results from Turbopuffer client.`);

        // Ensure results is an array before mapping (client should ensure this, but good practice)
        if (!Array.isArray(results)) {
            console.error('Turbopuffer response was not an array:', results);
            return json({ error: 'Unexpected response format from Turbopuffer' }, { status: 500 });
        }

        // Fetch og:image for each result concurrently
        const resultsWithImages = await Promise.all(
            results.map(async (result) => {
                // Defensive check for attributes
                const attributes = result.attributes || {};
                const ogImage = await fetchOgImage(attributes.url);
                return {
                    id: result.id,
                    title: attributes.title || 'N/A', // Provide default if missing
                    url: attributes.url || '#',    // Provide default if missing
                    ogImage: ogImage
                };
            })
        );

        console.log(`Returning ${resultsWithImages.length} results with OG images.`);
        return json(resultsWithImages);

    } catch (error) {
        console.error('Error processing search request:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
