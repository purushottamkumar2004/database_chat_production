const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const askRoutes = require('./routes/ask');
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');
const logger = require('./utils/logger');

const app = express();

// Security middleware
app.use(helmet());

// Compression middleware
app.use(compression());

// CORS configuration
app.use(cors({
    origin: config.server.corsOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Rate limiting
app.use('/ask', rateLimiter);

// Body parsing middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentType: req.get('Content-Type'),
    });
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
    });
});

// Routes
app.use('/ask', askRoutes);

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: ['/health', '/ask']
    });
});

// Global Error Handler (must be last)
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

// Start the server
app.listen(config.server.port, () => {
    logger.info(`🚀 Server started successfully`, {
        port: config.server.port,
        environment: config.server.env,
        nodeVersion: process.version
    });
});

module.exports = app;