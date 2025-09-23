const config = require('../config');
const logger = require('../utils/logger');

const validateQuestion = (req, res, next) => {
    const { question } = req.body;

    // Check if question exists
    if (!question) {
        return res.status(400).json({ 
            error: "Question is required.",
            code: "MISSING_QUESTION"
        });
    }

    // Check question type
    if (typeof question !== 'string') {
        return res.status(400).json({ 
            error: "Question must be a string.",
            code: "INVALID_QUESTION_TYPE"
        });
    }

    // Check question length
    if (question.trim().length === 0) {
        return res.status(400).json({ 
            error: "Question cannot be empty.",
            code: "EMPTY_QUESTION"
        });
    }

    if (question.length > config.security.maxQueryLength) {
        return res.status(400).json({ 
            error: `Question is too long. Maximum ${config.security.maxQueryLength} characters allowed.`,
            code: "QUESTION_TOO_LONG"
        });
    }

    // Check for potentially harmful patterns
    const harmfulPatterns = [
        /drop\s+table/gi,
        /delete\s+from/gi,
        /truncate\s+table/gi,
        /alter\s+table/gi,
        /create\s+table/gi,
        /insert\s+into/gi,
        /update\s+.+set/gi,
        /exec\s*\(/gi,
        /execute\s*\(/gi,
        /xp_cmdshell/gi,
        /sp_executesql/gi,
    ];

    const containsHarmfulPattern = harmfulPatterns.some(pattern => pattern.test(question));
    if (containsHarmfulPattern) {
        logger.warn(`Potentially harmful question detected`, {
            question,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
        return res.status(400).json({ 
            error: "Question contains potentially harmful content.",
            code: "HARMFUL_CONTENT"
        });
    }

    // Sanitize the question
    req.body.question = question.trim();
    next();
};

module.exports = { validateQuestion };