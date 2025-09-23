// query.js
const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./src/config');

// --- Configuration ---
const userQuestion = "who is the employee with the name purushottam kumar?";
const COLLECTION_NAME = 'sql_schemas';
const N_RESULTS = 1;

// --- Initialize Clients ---
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const chroma = new ChromaClient({ path: config.rag.chromaDbUrl });

async function testQuery() {
    try {
        console.log(`\nQuestion: "${userQuestion}"`);

        // 1. Get the collection from ChromaDB, specifying tenant and database
        console.log(`\n1. Connecting to ChromaDB collection '${COLLECTION_NAME}'...`);
        const collection = await chroma.getCollection({ 
            name: COLLECTION_NAME,
            tenant: "default_tenant",
            database: "default_database"
        });
        console.log("   ✅ Collection retrieved.");

        // 2. Get the embedding model
        const model = genAI.getGenerativeModel({ model: "models/text-embedding-004" });

        // 3. Generate an embedding for the user's question
        console.log("2. Generating embedding for the question...");
        const questionEmbedding = await model.embedContent(userQuestion);
        console.log("   ✅ Embedding generated.");

        // 4. Query the collection with the question's embedding
        console.log(`3. Querying for the ${N_RESULTS} most relevant schema(s)...`);
        const results = await collection.query({
            queryEmbeddings: [questionEmbedding.embedding.values],
            nResults: N_RESULTS,
        });
        console.log("   ✅ Query successful.");

        // 5. Display the results
        console.log("\n--- Query Results ---");
        if (results.ids[0].length === 0) {
            console.log("No relevant schemas found in the database.");
        } else {
            for (let i = 0; i < results.ids[0].length; i++) {
                const tableName = results.ids[0][i];
                const distance = results.distances[0][i];
                const schemaContent = results.documents[0][i];

                console.log(`\nTable Name: ${tableName}`);
                console.log(`Similarity Score (Distance): ${distance.toFixed(4)} (Closer to 0 is more similar)`);
                console.log("--- Schema Content ---");
                console.log(schemaContent);
                console.log("----------------------");
            }
        }

    } catch (error) {
        console.error("\n❌ An error occurred:", error);
        if (error.message && error.message.includes('CollectionNotFound')) {
            console.error("💡 Hint: Make sure you have run the `npm run index` script first to create and populate the collection.");
        }
    }
}

testQuery();