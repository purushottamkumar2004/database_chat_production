const mssql = require('mssql');
const config = require('../config');
const logger = require('../utils/logger');

// Enhanced configuration with better error handling and timeouts
const dbConfig = {
    server: config.database.host,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    port: config.database.port,
    connectionTimeout: config.database.connectionTimeout,
    requestTimeout: config.database.requestTimeout,
    pool: config.database.pool,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
    },
};

let poolPromise = null;
let isConnected = false;

function getPool() {
    if (poolPromise) return poolPromise;

    poolPromise = new mssql.ConnectionPool(dbConfig)
        .connect()
        .then(pool => {
            isConnected = true;
            logger.info('✅ Connected to SQL Server successfully!', {
                server: config.database.host,
                database: config.database.database
            });

            // Handle pool errors
            pool.on('error', err => {
                logger.error('Database pool error:', err);
                isConnected = false;
                poolPromise = null;
            });

            return pool;
        })
        .catch(err => {
            logger.error('Database Connection Failed!', {
                error: err.message,
                server: config.database.host,
                database: config.database.database
            });
            isConnected = false;
            poolPromise = null;
            throw err;
        });

    return poolPromise;
}

/**
 * Enhanced SQL execution with comprehensive security checks and monitoring
 */
async function executeQuery(query) {
    const startTime = Date.now();
    
    // Input validation
    if (!query || query.trim() === '') {
        throw new Error('SQL query cannot be empty');
    }

    // Security validation - only allow SELECT statements
    const cleanQuery = query.trim().toUpperCase();
    if (!cleanQuery.startsWith('SELECT')) {
        logger.warn(`Non-SELECT query attempted: ${query.substring(0, 100)}`);
        throw new Error('For security reasons, only SELECT queries are allowed.');
    }

    // Additional security checks
    const dangerousPatterns = [
        /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)/i,
        /xp_cmdshell/i,
        /sp_executesql/i,
        /--[^\r\n]*$/m,
        /\/\*[\s\S]*?\*\//,
    ];

    const hasDangerousPattern = dangerousPatterns.some(pattern => pattern.test(query));
    if (hasDangerousPattern) {
        logger.warn(`Potentially dangerous SQL pattern detected: ${query.substring(0, 100)}`);
        throw new Error('Query contains potentially unsafe patterns.');
    }

    try {
        const pool = await getPool();
        
        // Create request with timeout
        const request = pool.request();
        request.timeout = config.database.requestTimeout;

        logger.debug('Executing SQL query', {
            query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
            queryLength: query.length
        });

        const result = await request.query(query);
        const executionTime = Date.now() - startTime;

        logger.info('SQL query executed successfully', {
            executionTime,
            rowCount: result.recordset.length,
            queryLength: query.length
        });

        return result.recordset;

    } catch (err) {
        const executionTime = Date.now() - startTime;
        
        logger.error('SQL query execution error', {
            error: err.message,
            executionTime,
            query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
            sqlState: err.code,
            sqlNumber: err.number
        });

        // Provide more helpful error messages
        let userFriendlyMessage = 'Error executing database query.';
        
        if (err.code === 'ETIMEOUT') {
            userFriendlyMessage = 'Query execution timed out. Please try a simpler query.';
        } else if (err.code === 'ELOGIN') {
            userFriendlyMessage = 'Database authentication failed.';
        } else if (err.code === 'ECONNRESET') {
            userFriendlyMessage = 'Database connection was reset. Please try again.';
        } else if (err.number === 2) { // SQL Server error numbers
            userFriendlyMessage = 'Database server is not accessible.';
        } else if (err.number === 207) {
            userFriendlyMessage = 'Invalid column name in the generated query.';
        } else if (err.number === 208) {
            userFriendlyMessage = 'Invalid table name in the generated query.';
        }

        throw new Error(`${userFriendlyMessage} Technical details: ${err.message}`);
    }
}

/**
 * Health check for the database connection
 */
async function healthCheck() {
    try {
        const result = await executeQuery('SELECT 1 as health_check');
        return { healthy: true, connected: isConnected };
    } catch (error) {
        return { healthy: false, connected: isConnected, error: error.message };
    }
}

/**
 * Get database connection statistics
 */
function getConnectionStats() {
    return {
        isConnected,
        config: {
            server: config.database.host,
            database: config.database.database,
            port: config.database.port
        }
    };
}

module.exports = { 
    executeQuery, 
    healthCheck, 
    getConnectionStats 
};