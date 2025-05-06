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

// ===============================================
// Rank Fusion
// ===============================================
function reciprocalRankFusion(resultLists, k = 60) {
  const scores = {};
  const allResults = {};
  for (const results of resultLists) {
    if (results) { // Add a check for null/undefined results
      for (let rank = 1; rank <= results.length; rank++) {
        const item = results[rank - 1];
        if (item && item.id != null) { // Ensure item and item.id are valid
          scores[item.id] = (scores[item.id] || 0) + 1.0 / (k + rank);
          allResults[item.id] = item;
        }
      }
    }
  }
  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([docId, score]) => {
      const resultItem = allResults[docId];
      resultItem.dist = score; // Add/overwrite dist with RRF score
      return resultItem;
    });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    let query, vector, top_k_from_request;
    let mode;

    try {
        const requestData = await request.json();
        mode = requestData.mode || requestData.search_type || 'fulltext'; // Accept 'search_type' from frontend, default to fulltext

        if (mode === 'semantic') {
            vector = requestData.vector;
            top_k_from_request = requestData.top_k;
            if (!Array.isArray(vector) || !vector.every(n => typeof n === 'number')) {
                return json({ error: 'Semantic search requires a valid "vector" (array of numbers).' }, { status: 400 });
            }
        } else if (mode === 'fulltext') {
            query = requestData.query;
            top_k_from_request = requestData.top_k; // Frontend might send this in future
            if (typeof query !== 'string' || query.trim() === '') {
                return json({ error: 'Fulltext search requires a non-empty "query" string.' }, { status: 400 });
            }
        } else if (mode === 'phrase') { // Added phrase mode handling
            query = requestData.query;
            top_k_from_request = requestData.top_k;
            if (typeof query !== 'string' || query.trim() === '') {
                return json({ error: 'Phrase search requires a non-empty "query" string.' }, { status: 400 });
            }
        } else if (mode === 'hybrid') {
            query = requestData.query;
            vector = requestData.vector; // Expect vector from frontend
            top_k_from_request = requestData.top_k;
            if (typeof query !== 'string' || query.trim() === '') {
                return json({ error: 'Hybrid search requires a non-empty "query" string.' }, { status: 400 });
            }
            if (!Array.isArray(vector) || !vector.every(n => typeof n === 'number')) {
                return json({ error: 'Hybrid search requires a valid "vector" (array of numbers).' }, { status: 400 });
            }
        } else {
            return json({ error: `Unsupported search mode: ${mode}. Supported modes are "fulltext", "semantic", "phrase", and "hybrid".` }, { status: 400 });
        }
    } catch (e) {
        console.error('Error parsing request body:', e);
        return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!TPUF_API_KEY) {
        console.error('Turbopuffer API key (TPUF_API_KEY) not configured in .env');
        return json({ error: 'Server configuration error' }, { status: 500 });
    }

    // --- TEMPORARY DEBUG LOG: Verify API Key --- 
    // console.log(`[DEBUG] API Key loaded by server: ${TPUF_API_KEY ? TPUF_API_KEY.substring(0, 8) + '...' : 'MISSING!'}`);
    // --- REMOVE THIS LOG AFTER TESTING --- 

    // Instantiate the Turbopuffer client
    const tpuf = new Turbopuffer({ apiKey: TPUF_API_KEY });

    try {
        // Get the specific namespace object from the client
        const ns = tpuf.namespace(NAMESPACE);

        // Construct query options based on mode
        let queryOptions = {
            top_k: top_k_from_request || (mode === 'semantic' ? 20 : 20), // Semantic defaults to 20, Fulltext/Phrase defaults to 20
            include_attributes: ['title', 'url'] // Removed 'text'
        };

        if (mode === 'semantic') {
            queryOptions.vector = vector;
            queryOptions.distance_metric = 'cosine_distance';
            // Ensure no rank_by or filters for pure vector search
            delete queryOptions.rank_by;
            delete queryOptions.filters;
            console.log(`[DEBUG] Performing Semantic Search with ${queryOptions.vector.length}-dim vector. Top K: ${queryOptions.top_k}, Namespace: ${NAMESPACE}`);
        } else if (mode === 'fulltext') { // mode === 'fulltext'
            queryOptions.rank_by = ['title', 'BM25', query];
            // Ensure filters is not set for full-text BM25 search
            delete queryOptions.filters;
            delete queryOptions.vector; // Ensure vector is not set
            console.log(`[DEBUG] Performing Fulltext Search for query: "${query}". Top K: ${queryOptions.top_k}, Namespace: ${NAMESPACE}`);
        } else if (mode === 'phrase') { // mode === 'phrase'
            queryOptions.filters = { "title": ["ContainsAllTokens", query] }; // Changed from "text" to "title"
            // Ensure rank_by and vector are not set for phrase search
            delete queryOptions.rank_by;
            delete queryOptions.vector;
            console.log(`[DEBUG] Performing Phrase Search for query: "${query}". Top K: ${queryOptions.top_k}, Namespace: ${NAMESPACE}`);
        } else if (mode === 'hybrid') {
            // Use the 'query' for FTS and the 'vector' from requestData for vector search
            const ftsPromise = ns.query({
                rank_by: ['title', 'BM25', query],
                include_attributes: ['title', 'url'],
                top_k: top_k_from_request
            });

            // The vector is already available as 'vector' from requestData
            const vectorPromise = ns.query({
                vector: vector, // Use the vector from requestData
                include_attributes: ['title', 'url'],
                top_k: top_k_from_request
            });

            const [ftsResult, vectorResult] = await Promise.all([ftsPromise, vectorPromise]);
            
            const fusedResults = reciprocalRankFusion([ftsResult, vectorResult], 60);
            const finalHybridResults = fusedResults.slice(0, top_k_from_request); // Use top_k_from_request
            const resultsWithImages = await Promise.all(
                finalHybridResults.map(async (result) => {
                    // Defensive check for attributes
                    const attributes = result.attributes || {};
                    const ogImage = await fetchOgImage(attributes.url);
                    return {
                        id: result.id,
                        title: attributes.title || 'N/A', // Provide default if missing
                        url: attributes.url || '#',    // Provide default if missing
                        ogImage: ogImage,
                        distance: result.distance // Include distance for semantic search
                    };
                })
            );
            return json(resultsWithImages, { status: 200 }); 
        }

        // Use the namespace object's query method with dynamic options
        const queryResult = await ns.query(queryOptions);

        // --- TEMPORARY DEBUG LOG: Log full query result --- 
        // console.log('[DEBUG] Full queryResult:', JSON.stringify(queryResult, null, 2));

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
                    ogImage: ogImage,
                    distance: result.distance // Include distance for semantic search
                };
            })
        );

        console.log(`Returning ${resultsWithImages.length} results with OG images.`);
        return json(resultsWithImages);

    } catch (error) {
        console.error('Error processing search request:', error);
        // More detailed error logging
        if (error.response && error.response.data) {
            console.error('Turbopuffer API Error:', error.response.data);
        }
        return json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
