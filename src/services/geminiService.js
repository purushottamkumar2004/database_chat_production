const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const { createSqlGenerationPrompt, createAnalysisPrompt } = require('../utils/promptManager');
const logger = require('../utils/logger');

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

/**
 * Enhanced SQL generation with retry logic and better error handling
 */
async function generateSql(question, schemaContext) {
    const startTime = Date.now();
    let lastError = null;

    for (let attempt = 1; attempt <= config.gemini.maxRetries; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ 
                model: config.gemini.sqlModel,
                generationConfig: {
                    temperature: 0.1, // Low temperature for more deterministic SQL generation
                    topK: 1,
                    topP: 0.8,
                    maxOutputTokens: 1000,
                }
            });

            const systemPrompt = createSqlGenerationPrompt(schemaContext);
            const fullPrompt = `${systemPrompt}\n\nUser question: "${question}"`;

            logger.debug(`Generating SQL - Attempt ${attempt}`, {
                question: question.substring(0, 100),
                schemaLength: schemaContext.length,
                promptLength: fullPrompt.length
            });

            const result = await model.generateContent(fullPrompt);
            const response = await result.response;
            let sqlQuery = response.text().trim();

            // Handle the "cannot answer" case
            if (sqlQuery.toUpperCase() === 'CANNOT_ANSWER') {
                throw new Error("This question cannot be answered using the available database schema. Please rephrase your question or check if the relevant tables exist.");
            }

            // Clean up the response
            sqlQuery = sqlQuery
                .replace(/```sql/gi, '')
                .replace(/```/g, '')
                .replace(/^\s*sql\s*/i, '') // Remove "SQL" prefix if present
                .trim();

            // Validate the generated SQL
            if (!sqlQuery.toUpperCase().startsWith('SELECT')) {
                throw new Error(`Generated query is not a SELECT statement: ${sqlQuery.substring(0, 100)}`);
            }

            // Ensure proper semicolon ending
            if (!sqlQuery.endsWith(';')) {
                sqlQuery += ';';
            }

            const generationTime = Date.now() - startTime;
            logger.info(`SQL generated successfully`, {
                attempt,
                generationTime,
                queryLength: sqlQuery.length,
                question: question.substring(0, 50)
            });

            return sqlQuery;

        } catch (error) {
            lastError = error;
            const generationTime = Date.now() - startTime;
            
            logger.warn(`SQL generation attempt ${attempt} failed`, {
                attempt,
                error: error.message,
                generationTime,
                question: question.substring(0, 50)
            });

            // If it's the last attempt, don't wait
            if (attempt < config.gemini.maxRetries) {
                await new Promise(resolve => setTimeout(resolve, config.gemini.retryDelay * attempt));
            }
        }
    }

    // All attempts failed
    logger.error(`SQL generation failed after ${config.gemini.maxRetries} attempts`, {
        question: question.substring(0, 100),
        finalError: lastError?.message
    });

    throw new Error(`Failed to generate SQL query after ${config.gemini.maxRetries} attempts. Last error: ${lastError?.message}`);
}

/**
 * Enhanced analysis generation with retry logic
 */
async function generateAnalysis(originalQuestion, queryResults) {
    const startTime = Date.now();
    let lastError = null;

    for (let attempt = 1; attempt <= config.gemini.maxRetries; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ 
                model: config.gemini.analysisModel,
                generationConfig: {
                    temperature: 0.3, // Slightly higher temperature for more natural language
                    topK: 40,
                    topP: 0.8,
                    maxOutputTokens: 500,
                }
            });

            const prompt = createAnalysisPrompt(originalQuestion, queryResults);

            logger.debug(`Generating analysis - Attempt ${attempt}`, {
                question: originalQuestion.substring(0, 100),
                resultCount: queryResults.length,
                promptLength: prompt.length
            });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const analysis = response.text().trim();

            const analysisTime = Date.now() - startTime;
            logger.info(`Analysis generated successfully`, {
                attempt,
                analysisTime,
                responseLength: analysis.length,
                question: originalQuestion.substring(0, 50)
            });

            return analysis;

        } catch (error) {
            lastError = error;
            const analysisTime = Date.now() - startTime;
            
            logger.warn(`Analysis generation attempt ${attempt} failed`, {
                attempt,
                error: error.message,
                analysisTime,
                question: originalQuestion.substring(0, 50)
            });

            if (attempt < config.gemini.maxRetries) {
                await new Promise(resolve => setTimeout(resolve, config.gemini.retryDelay * attempt));
            }
        }
    }

    // All attempts failed, return a fallback response
    logger.error(`Analysis generation failed after ${config.gemini.maxRetries} attempts`, {
        question: originalQuestion.substring(0, 100),
        finalError: lastError?.message
    });

    // Return a basic fallback response instead of throwing
    if (queryResults.length === 0) {
        return "No data was found matching your query criteria.";
    } else {
        return `Found ${queryResults.length} result${queryResults.length === 1 ? '' : 's'} for your query. Please see the data below for details.`;
    }
}

/**
 * Test the Gemini API connection
 */
async function healthCheck() {
    try {
        const model = genAI.getGenerativeModel({ model: config.gemini.sqlModel });
        const result = await model.generateContent("Say 'API connection successful'");
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
    healthCheck 
};