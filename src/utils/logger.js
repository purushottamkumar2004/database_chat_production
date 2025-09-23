const winston = require('winston');
const config = require('../config');

const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.prettyPrint()
);

const logger = winston.createLogger({
    level: config.server.env === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'text-to-sql-api' },
    transports: [
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

if (config.server.env !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

module.exports = logger;