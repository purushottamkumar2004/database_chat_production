// src/services/geminiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const { createSqlGenerationPrompt, createAnalysisPrompt } = require('../utils/promptManager');
const logger = require('../utils/logger');

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

// Performance optimization: Set strict limits
const LIMITS = {
    MAX_ANALYSIS_ROWS: 50,        // Maximum rows to analyze
    MAX_ANALYSIS_CHARS: 50000,    // Maximum characters in analysis data
    SQL_TIMEOUT_MS: 15000,        // 15 seconds timeout for SQL generation
    ANALYSIS_TIMEOUT_MS: 20000,   // 20 seconds timeout for analysis
    MAX_SCHEMA_LENGTH: 10000      // Maximum schema context length
};

/**
 * Generates a T-SQL query from a user's question with timeout protection.
 */
async function generateSql(question, schemaContext) {
    const startTime = Date.now();
    
    // Limit schema context size to prevent long processing
    if (schemaContext.length > LIMITS.MAX_SCHEMA_LENGTH) {
        logger.warn(`Schema context truncated from ${schemaContext.length} to ${LIMITS.MAX_SCHEMA_LENGTH} chars`);
        schemaContext = schemaContext.substring(0, LIMITS.MAX_SCHEMA_LENGTH) + '\n... (truncated)';
    }

    let lastError = null;

    for (let attempt = 1; attempt <= config.gemini.maxRetries; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ model: config.gemini.sqlModel });
            const systemPrompt = createSqlGenerationPrompt(schemaContext);
            const fullPrompt = `${systemPrompt}\n\nUser question: "${question}"`;

            logger.debug(`Generating SQL - Attempt ${attempt}`);
            
            // Add timeout protection
            const result = await Promise.race([
                model.generateContent(fullPrompt),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('SQL generation timeout')), LIMITS.SQL_TIMEOUT_MS)
                )
            ]);
            
            const response = await result.response;
            let sqlQuery = response.text().trim();

            if (sqlQuery.toUpperCase() === 'CANNOT_ANSWER') {
                throw new Error("This question cannot be answered using the available database schema.");
            }

            sqlQuery = sqlQuery.replace(/```sql/gi, '').replace(/```/g, '').replace(/^\s*sql\s*/i, '').trim();

            if (!sqlQuery.toUpperCase().startsWith('SELECT')) {
                throw new Error(`Generated query is not a SELECT statement: ${sqlQuery.substring(0, 100)}`);
            }
            if (!sqlQuery.endsWith(';')) {
                sqlQuery += ';';
            }

            logger.info(`SQL generated successfully in ${Date.now() - startTime}ms`);
            return sqlQuery;

        } catch (error) {
            lastError = error;
            logger.warn(`SQL generation attempt ${attempt} failed`, { error: error.message });
            if (attempt < config.gemini.maxRetries) {
                await new Promise(resolve => setTimeout(resolve, config.gemini.retryDelay * attempt));
            }
        }
    }
    throw new Error(`Failed to generate SQL query after ${config.gemini.maxRetries} attempts. Last error: ${lastError?.message}`);
}

/**
 * Intelligently truncate data for analysis
 */
function truncateDataForAnalysis(queryResults) {
    if (!queryResults || queryResults.length === 0) {
        return { truncated: [], originalCount: 0, wasTruncated: false };
    }

    const originalCount = queryResults.length;
    let truncated = queryResults.slice(0, LIMITS.MAX_ANALYSIS_ROWS);
    
    // Calculate total characters in the truncated data
    const dataString = JSON.stringify(truncated);
    
    // If still too large, further reduce
    if (dataString.length > LIMITS.MAX_ANALYSIS_CHARS) {
        logger.warn(`Analysis data still too large (${dataString.length} chars), reducing further`);
        
        // Calculate how many rows we can fit
        const avgRowSize = dataString.length / truncated.length;
        const maxRows = Math.floor(LIMITS.MAX_ANALYSIS_CHARS / avgRowSize);
        truncated = truncated.slice(0, Math.max(10, maxRows)); // Keep at least 10 rows
    }

    return {
        truncated,
        originalCount,
        wasTruncated: truncated.length < originalCount,
        truncatedCount: truncated.length
    };
}

/**
 * Generates a natural language analysis with strict limits and optimization.
 */
async function generateAnalysis(originalQuestion, queryResults) {
    if (!queryResults || queryResults.length === 0) {
        return "No data was found matching your query criteria.";
    }

    // Intelligent truncation
    const { truncated, originalCount, wasTruncated, truncatedCount } = truncateDataForAnalysis(queryResults);
    
    if (wasTruncated) {
        logger.info(`Analysis optimized: Processing ${truncatedCount} of ${originalCount} rows`);
    }

    // Skip analysis for very simple queries (single row or very small datasets)
    if (originalCount === 1 && !wasTruncated) {
        const firstRow = queryResults[0];
        const keys = Object.keys(firstRow);
        if (keys.length === 1) {
            return `Result: ${firstRow[keys[0]]}`;
        }
    }

    let lastError = null;
    for (let attempt = 1; attempt <= Math.min(config.gemini.maxRetries, 2); attempt++) { // Limit retries to 2
        try {
            const model = genAI.getGenerativeModel({ model: config.gemini.analysisModel });
            const prompt = createAnalysisPrompt(originalQuestion, truncated, originalCount);
            
            // Add timeout protection
            const result = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Analysis timeout')), LIMITS.ANALYSIS_TIMEOUT_MS)
                )
            ]);
            
            const response = await result.response;
            return response.text().trim();
        } catch (error) {
            lastError = error;
            logger.warn(`Analysis generation attempt ${attempt} failed`, { error: error.message });
            if (attempt < Math.min(config.gemini.maxRetries, 2)) {
                await new Promise(resolve => setTimeout(resolve, config.gemini.retryDelay * attempt));
            }
        }
    }
    
    logger.error(`Analysis failed after all retries`, { lastError });
    
    // Return a basic summary if analysis fails
    if (originalCount <= 10) {
        return `Found ${originalCount} result(s). Analysis unavailable, but you can view the raw data below.`;
    }
    return `Found ${originalCount} result(s). Analysis unavailable due to processing error. Please try refining your question or view the raw data.`;
}

/**
 * Rewrites a follow-up question with timeout and caching
 */
async function createStandaloneQuestion(followUpQuestion, chatHistory) {
    // If no history, return original question immediately
    if (!chatHistory || chatHistory.length === 0) {
        return followUpQuestion;
    }

    // Limit history size for rewriting (only use last 6 entries = 3 exchanges)
    const limitedHistory = chatHistory.slice(-6);

    try {
        const model = genAI.getGenerativeModel({ model: config.gemini.analysisModel });

        const historyText = limitedHistory
            .map(entry => `${entry.role === 'user' ? 'User' : 'Bot'}: ${entry.content}`)
            .join('\n');

        const prompt = `Given the following chat history and a follow-up question, rephrase the follow-up question to be a complete, standalone question that can be understood without the context of the chat history.

Chat History:
---
${historyText}
---

Follow-up Question: "${followUpQuestion}"

Standalone Question:`;

        // Add timeout
        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Rewrite timeout')), 10000)
            )
        ]);
        
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        logger.warn(`Failed to rewrite question, using original`, { error: error.message });
        return followUpQuestion; // Fallback to original question
    }
}

/**
 * Test the Gemini API connection
 */
async function healthCheck() {
    try {
        const model = genAI.getGenerativeModel({ model: config.gemini.sqlModel });
        const result = await Promise.race([
            model.generateContent("Say 'API connection successful'"),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Health check timeout')), 5000)
            )
        ]);
        const response = await result.response;
        return { 
            healthy: true, 
            response: response.text().trim(),
            model: config.gemini.sqlModel
        };
    } catch (error) {
        return { 
            healthy: false, 
            error: error.message,
            model: config.gemini.sqlModel
        };
    }
}

module.exports = { 
    generateSql, 
    generateAnalysis, 
    healthCheck,
    createStandaloneQuestion,
    LIMITS // Export limits for reference
};