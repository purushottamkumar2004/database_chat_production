const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const logger = require('../utils/logger');

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const chroma = new ChromaClient({ path: config.rag.chromaDbUrl });
const model = genAI.getGenerativeModel({ model: config.gemini.embeddingModel });

let isConnected = false;
let collection = null;

/**
 * Initialize connection to ChromaDB
 */
async function initializeConnection() {
    try {
        // Use getOrCreateCollection instead of getCollection
        collection = await chroma.getOrCreateCollection({
            name: config.rag.collectionName || 'sql_schemas',
            metadata: { 
                description: 'Database table schemas for text-to-SQL generation',
                created_at: new Date().toISOString()
            }
        });
        isConnected = true;
        
        logger.info('✅ Connected to ChromaDB successfully', {
            collectionName: config.rag.collectionName || 'sql_schemas'
        });
        
        return collection;
    } catch (error) {
        isConnected = false;
        logger.error('❌ Failed to connect to ChromaDB:', {
            error: error.message,
            chromaUrl: config.rag.chromaDbUrl
        });
        throw new Error(`ChromaDB connection failed: ${error.message}`);
    }
}

/**
 * Get or initialize the collection
 */
async function getCollection() {
    if (!collection || !isConnected) {
        await initializeConnection();
    }
    return collection;
}

/**
 * Retrieves the most relevant table schemas for a given user question.
 * @param {string} question - The user's natural language question.
 * @returns {Promise<string>} A string containing the context of the most relevant schemas.
 */
async function retrieveRelevantSchemas(question) {
    try {
        // Validate input
        if (!question || typeof question !== 'string' || question.trim().length === 0) {
            throw new Error('Question must be a non-empty string');
        }

        logger.debug('Starting schema retrieval', {
            question: question.substring(0, 100) + (question.length > 100 ? '...' : ''),
            questionLength: question.length
        });

        // Get the collection (will initialize if needed)
        const currentCollection = await getCollection();

        // Generate embedding for the user's question
        logger.debug('Generating embedding for question');
        const result = await model.embedContent({
            content: {
                role: "user",
                parts: [{ text: question }]
            }
        });

        if (!result.embedding || !result.embedding.values) {
            throw new Error('Failed to generate embedding for question');
        }

        const queryEmbedding = result.embedding.values;

        // Query ChromaDB to find the most similar documents
        logger.debug('Querying ChromaDB for similar schemas');
        const searchResults = await currentCollection.query({
            queryEmbeddings: [queryEmbedding],
            nResults: config.rag.topK || 3,
            include: ['documents', 'metadatas', 'distances']
        });

        // Validate search results
        if (!searchResults.documents || 
            searchResults.documents.length === 0 || 
            searchResults.documents[0].length === 0) {
            logger.warn('No relevant schemas found for question', {
                question: question.substring(0, 100)
            });
            throw new Error("No relevant schemas found for the question. Please try rephrasing your question or check if the relevant tables have been indexed.");
        }

        // Log the retrieved schemas for debugging
        const retrievedTableNames = searchResults.metadatas[0]
            .map(meta => meta.tableName)
            .filter(name => name);

        logger.info('Retrieved relevant schemas', {
            question: question.substring(0, 50),
            retrievedTables: retrievedTableNames,
            tableCount: retrievedTableNames.length,
            similarities: searchResults.distances ? searchResults.distances[0] : 'N/A'
        });

        // Combine the retrieved schema documents into a single context string
        const schemaContext = searchResults.documents[0].join('\n\n---\n\n');
        
        logger.debug('Schema context created', {
            contextLength: schemaContext.length,
            tableCount: retrievedTableNames.length
        });

        return schemaContext;

    } catch (error) {
        logger.error('Error in RAG schema retrieval', {
            error: error.message,
            question: question ? question.substring(0, 100) : 'undefined',
            isConnected,
            collectionExists: !!collection
        });

        // Provide more specific error messages
        if (error.message.includes('Collection') && error.message.includes('does not exist')) {
            throw new Error('Schema collection does not exist. Please run the indexing script first: npm run index');
        } else if (error.message.includes('ECONNREFUSED')) {
            throw new Error('ChromaDB is not running. Please start ChromaDB: docker run -d -p 8000:8000 chromadb/chroma');
        } else if (error.message.includes('embedding')) {
            throw new Error('Failed to generate embedding for the question. Please check your Gemini API configuration.');
        }

        throw new Error(`Could not retrieve relevant database schemas: ${error.message}`);
    }
}

/**
 * Log the complete input being sent to Gemini (schemas + rules + question)
 * @param {string} fullInput - The complete input sent to Gemini AI
 * @param {string} userQuestion - Original user question
 */
function logGeminiInput(fullInput, userQuestion = '') {
    logger.info('Complete input sent to Gemini AI', {
        event: 'gemini_input_log',
        timestamp: new Date().toISOString(),
        userQuestion: userQuestion.substring(0, 100) + (userQuestion.length > 100 ? '...' : ''),
        inputLength: fullInput.length,
        fullInput: fullInput
    });
}

/**
 * Health check for the RAG service
 */
async function healthCheck() {
    try {
        // Test ChromaDB connection
        await chroma.heartbeat();
        
        // Test collection access
        const currentCollection = await getCollection();
        const count = await currentCollection.count();
        
        // Test embedding generation
        const testResult = await model.embedContent({
            content: {
                role: "user", 
                parts: [{ text: "test query" }]
            }
        });

        return {
            healthy: true,
            chromaConnected: true,
            collectionExists: true,
            documentsCount: count,
            embeddingWorking: !!testResult.embedding
        };
    } catch (error) {
        return {
            healthy: false,
            error: error.message,
            chromaConnected: false,
            collectionExists: !!collection,
            documentsCount: 0,
            embeddingWorking: false
        };
    }
}

/**
 * Get collection statistics
 */
async function getStats() {
    try {
        if (!collection) {
            await initializeConnection();
        }
        
        const count = await collection.count();
        return {
            isConnected,
            collectionName: config.rag.collectionName || 'sql_schemas',
            documentsCount: count,
            topK: config.rag.topK || 3
        };
    } catch (error) {
        logger.error('Error getting RAG stats:', error);
        return {
            isConnected: false,
            error: error.message
        };
    }
}

module.exports = { 
    retrieveRelevantSchemas, 
    logGeminiInput,
    healthCheck, 
    getStats,
    initializeConnection 
};