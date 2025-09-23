// Global error handler
// src/middleware/errorHandler.js

function errorHandler(err, req, res, next) {
    console.error("An error occurred:", err.stack);

    const statusCode = err.statusCode || 500;
    const message = err.message || "An unexpected error occurred.";

    res.status(statusCode).json({
        error: {
            message: message,
            // Optionally include stack trace in development
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        },
    });
}

module.exports = errorHandler;