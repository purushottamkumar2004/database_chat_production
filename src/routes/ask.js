// src/routes/ask.js
const express = require('express');
const NodeCache = require('node-cache');
const { v4: uuidv4 } = require('uuid'); // Import uuid for session IDs
const config = require('../config');
const dbService = require('../services/dbService');
const geminiService = require('../services/geminiService');
const ragService = require('../services/ragService');
const { validateQuestion } = require('../middleware/validator');
const logger = require('../utils/logger');

const router = express.Router();

// This cache will now be used to store session histories
const sessionCache = new NodeCache({ 
    stdTTL: (config.conversation?.sessionTimeoutMinutes || 30) * 60, // Use TTL for session expiration
    checkperiod: 120 
});

router.post('/', validateQuestion, async (req, res, next) => {
    // Now expecting `question` and an optional `sessionId`
    let { question, sessionId } = req.body;
    const startTime = Date.now();

    try {
        // 1. MANAGE SESSION & RETRIEVE CHAT HISTORY
        if (!sessionId) {
            sessionId = uuidv4();
            logger.info(`New session started: ${sessionId}`);
        }
        const historyKey = `history_${sessionId}`;
        const chatHistory = sessionCache.get(historyKey) || [];

        // 2. CREATE STANDALONE QUESTION (THE "MEMORY" STEP)
        const standaloneQuestion = await geminiService.createStandaloneQuestion(question, chatHistory);
        logger.info(`Rewritten question for RAG: "${standaloneQuestion}"`, { sessionId });

        // 3. USE STANDALONE QUESTION IN RAG & SQL PIPELINE
        const schemaContext = await ragService.retrieveRelevantSchemas(standaloneQuestion);
        
        if (!schemaContext || !schemaContext.trim()) {
            throw new Error("No relevant database schemas found for this question.");
        }

        const sqlQuery = await geminiService.generateSql(standaloneQuestion, schemaContext);
        const queryResults = await dbService.executeQuery(sqlQuery);
        
        // Use the standalone question for analysis to give the AI better context
        const finalAnswer = await geminiService.generateAnalysis(standaloneQuestion, queryResults);

        // 4. UPDATE AND SAVE HISTORY
        // Add the original user question and the bot's final answer to the history
        chatHistory.push({ role: 'user', content: question });
        chatHistory.push({ role: 'bot', content: finalAnswer });
        
        // Trim history if it exceeds the max length
        if (chatHistory.length > (config.conversation?.maxHistoryLength || 10) * 2) {
            chatHistory.splice(0, 2); // Remove the oldest user/bot pair
        }

        sessionCache.set(historyKey, chatHistory);
        logger.debug(`History for session ${sessionId} updated.`);

        // 5. SEND RESPONSE
        res.json({
            answer: finalAnswer,
            generatedSql: sqlQuery,
            rawData: queryResults,
            sessionId: sessionId, // Always return the sessionId
            responseTimeMs: Date.now() - startTime
        });

    } catch (error) {
        logger.error(`Error in /ask route for session ${sessionId}`, {
            error: error.message,
            question,
        });
        error.sessionId = sessionId; // Pass sessionId for better error logging
        next(error);
    }
});

module.exports = router;