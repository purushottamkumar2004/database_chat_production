const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

const limiter = rateLimit({
    windowMs: config.rateLimiting.windowMs,
    max: config.rateLimiting.maxRequests,
    skipSuccessfulRequests: config.rateLimiting.skipSuccessfulRequests,
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(config.rateLimiting.windowMs / 1000 / 60) + ' minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`, {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path
        });
        res.status(429).json({
            error: 'Too many requests from this IP, please try again later.',
            retryAfter: Math.ceil(config.rateLimiting.windowMs / 1000 / 60) + ' minutes'
        });
    }
});

module.exports = limiter;