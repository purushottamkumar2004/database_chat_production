const express = require('express');
const NodeCache = require('node-cache');
const config = require('../config');
const dbService = require('../services/dbService');
const geminiService = require('../services/geminiService');
const ragService = require('../services/ragService');
const { validateQuestion } = require('../middleware/validator');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize cache with enhanced configuration
const cache = new NodeCache({ 
    stdTTL: config.cache.ttl,
    maxKeys: config.cache.maxKeys,
    checkperiod: config.cache.checkPeriod,
    useClones: false
});

// Cache event handlers
cache.on('set', (key, value) => {
    logger.debug(`Cache SET: ${key}`);
});

cache.on('expired', (key, value) => {
    logger.debug(`Cache EXPIRED: ${key}`);
});

router.post('/', validateQuestion, async (req, res, next) => {
    const { question } = req.body;
    const startTime = Date.now();
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    logger.info(`Processing question`, {
        requestId,
        question: question.substring(0, 100) + (question.length > 100 ? '...' : ''),
        ip: req.ip
    });

    try {
        // Check cache first
        const cacheKey = Buffer.from(question.toLowerCase().trim()).toString('base64');
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            const responseTime = Date.now() - startTime;
            logger.info(`Cache hit`, { requestId, responseTime });
            
            return res.json({
                ...cachedResult,
                cached: true,
                requestId,
                responseTime
            });
        }

        logger.debug(`Cache miss, processing new question`, { requestId });

        // Step 1: RAG - Retrieve relevant schemas
        logger.debug(`Starting RAG retrieval`, { requestId });
        const schemaContext = await ragService.retrieveRelevantSchemas(question);
        
        if (!schemaContext || schemaContext.trim().length === 0) {
            throw new Error("No relevant database schemas found for this question.");
        }

        // Step 2: Generate SQL using the retrieved context
        logger.debug(`Generating SQL query`, { requestId });
        const sqlQuery = await geminiService.generateSql(question, schemaContext);

        // Step 3: Execute the SQL query with timeout
        logger.debug(`Executing SQL query`, { requestId });
        const queryResults = await Promise.race([
            dbService.executeQuery(sqlQuery),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Query execution timeout')), config.security.queryTimeoutMs)
            )
        ]);

        // Check result size limit
        if (queryResults.length > config.security.maxResultRows) {
            logger.warn(`Query returned too many rows, truncating`, { 
                requestId, 
                originalCount: queryResults.length,
                truncatedTo: config.security.maxResultRows
            });
            queryResults.splice(config.security.maxResultRows);
        }

        // Step 4: Generate natural language analysis
        logger.debug(`Generating analysis`, { requestId });
        const finalAnswer = await geminiService.generateAnalysis(question, queryResults);

        const responsePayload = {
            answer: finalAnswer,
            generatedSql: sqlQuery,
            rawData: queryResults,
            metadata: {
                schemaTablesUsed: schemaContext.split('Table:').length - 1,
                resultCount: queryResults.length,
                executionTimeMs: Date.now() - startTime
            },
            cached: false,
            requestId
        };

        // Cache successful results
        cache.set(cacheKey, {
            answer: finalAnswer,
            generatedSql: sqlQuery,
            rawData: queryResults,
            metadata: responsePayload.metadata
        });

        const responseTime = Date.now() - startTime;
        logger.info(`Question processed successfully`, {
            requestId,
            responseTime,
            resultCount: queryResults.length
        });

        res.json({
            ...responsePayload,
            responseTime
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`Error processing question`, {
            requestId,
            error: error.message,
            responseTime,
            question: question.substring(0, 100) + (question.length > 100 ? '...' : '')
        });

        // Enhanced error details for debugging
        error.requestId = requestId;
        error.responseTime = responseTime;
        next(error);
    }
});

// Cache statistics endpoint (for monitoring)
router.get('/cache/stats', (req, res) => {
    const stats = cache.getStats();
    res.json({
        ...stats,
        keys: cache.keys().length,
        memoryUsage: process.memoryUsage()
    });
});

module.exports = router;