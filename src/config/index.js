// index.js
const dotenv = require('dotenv');
dotenv.config();

const config = {
    server: {
        port: process.env.PORT || 3000,
        env: process.env.NODE_ENV || 'development',
        corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'],
    },
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 1433,
        database: process.env.DB_NAME || 'your_database',
        user: process.env.DB_USER || 'your_user',
        password: process.env.DB_PASSWORD || 'your_password',
        connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 15000,
        requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT) || 30000,
        pool: {
            max: parseInt(process.env.DB_POOL_MAX) || 10,
            min: parseInt(process.env.DB_POOL_MIN) || 0,
            idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
        }
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        sqlModel: process.env.GEMINI_SQL_MODEL || 'gemini-1.5-flash',
        embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
        analysisModel: process.env.GEMINI_ANALYSIS_MODEL || 'gemini-1.5-flash',
        maxRetries: parseInt(process.env.GEMINI_MAX_RETRIES) || 3,
        retryDelay: parseInt(process.env.GEMINI_RETRY_DELAY) || 1000,
    },
    rag: {
        chromaDbUrl: process.env.CHROMA_DB_URL || 'http://localhost:8000',
        topK: parseInt(process.env.RAG_TOP_K) || 3,
        collectionName: process.env.RAG_COLLECTION_NAME || 'sql_schemas',
        similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD) || 0.5,
    },
    cache: {
        ttl: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes
        maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 1000,
        checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 600, // 10 minutes
    },
    rateLimiting: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESSFUL === 'true',
    },
    security: {
        maxQueryLength: parseInt(process.env.MAX_QUERY_LENGTH) || 500,
        maxResultRows: parseInt(process.env.MAX_RESULT_ROWS) || 1000,
        queryTimeoutMs: parseInt(process.env.QUERY_TIMEOUT_MS) || 30000,
    }
};

// Validation
if (!config.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY is required in environment variables');
}

if (!config.database.password) {
    console.warn('⚠️  Database password not set. Using default.');
}

module.exports = config;