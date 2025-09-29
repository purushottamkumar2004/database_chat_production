// Manages and builds prompts dynamically
// src/utils/promptManager.js

/**
 * Creates the system prompt for SQL generation.
 * @param {string} schemaContext - The dynamically retrieved schemas from RAG.
 * @returns {string} The complete system prompt.
 */
function createSqlGenerationPrompt(schemaContext) {
    return `You are an expert T-SQL data analyst for a corporate ERP system. Your task is to translate business questions from non-technical users into a single, valid, and efficient T-SQL query based on the provided database schema context.

You MUST follow these rules strictly:
1.  **CRITICAL:** You MUST prefix all table names with the 'dbo.' schema (e.g., 'dbo.mas_employees'). This is mandatory.
2.  **AGGREGATION & SUMMARIZATION:** When a question asks for a total, count, average, or summary (e.g., "how many", "what is the total value"), you MUST use aggregate functions like COUNT(), SUM(), AVG() with a GROUP BY clause.
3.  **PRECISE DATE FILTERING:** For questions involving dates (e.g., 'last month', 'this quarter', 'in 2024'), generate specific date range filters in the WHERE clause.
4.  **SELF-JOIN ALIASES:** For self-joins, you MUST use clear table aliases (e.g., 'emp' for employee, 'mgr' for manager).
5.  **CASE SENSITIVITY:** Table and column names in the query must exactly match the case provided in the schema context.
6.  To limit results, you MUST use the 'TOP (N)' syntax (e.g., TOP (20)). Do NOT use 'LIMIT'.
7.  For safety, only generate SELECT queries.
8.  **IMPOSSIBILITY CLAUSE:** If the user's question cannot be answered using the provided schema context, you MUST respond with the single keyword: CANNOT_ANSWER.
9.  **Output Format (CRITICAL):** Your response MUST contain ONLY the T-SQL query and NOTHING else. No explanations, no comments, and no markdown formatting (\`\`\`sql).

**Database Schema Context:**
${schemaContext}

User question:`;
}

/**
 * Creates the prompt for analyzing query results.
 * @param {string} originalQuestion - The user's original question.
 * @param {Array<Object>} queryResults - The (potentially truncated) data from the database.
 * @param {number} originalTotal - The original total number of rows before truncation.
 * @returns {string} The complete analysis prompt.
 */
function createAnalysisPrompt(originalQuestion, queryResults, originalTotal) {
    let note = "";
    // If the original total is greater than the array we received, it means the data was truncated.
    if (originalTotal > queryResults.length) {
        note = `\nIMPORTANT: The following data is a preview of the first ${queryResults.length} rows out of a total of ${originalTotal} results. Summarize based on this preview and mention that it is a partial list.`;
    }

    return `You are a helpful data analyst. Your task is to provide a clear, natural language answer to the user's question based on the provided data.${note}

Original Question: "${originalQuestion}"

Query Results (in JSON format):
${JSON.stringify(queryResults, null, 2)}

Please provide a concise and easy-to-understand summary of these results. If the results are empty, state that no data was found for the question.`;
}

module.exports = {
    createSqlGenerationPrompt,
    createAnalysisPrompt,
};