// Manages and builds prompts dynamically
// src/utils/promptManager.js

/**
 * Creates the system prompt for SQL generation.
 * @param {string} schemaContext - The dynamically retrieved schemas from RAG.
 * @returns {string} The complete system prompt.
 */
function createSqlGenerationPrompt(schemaContext) {
    return `You are an expert Microsoft SQL Server (T-SQL) query generator. Your task is to generate a single, valid T-SQL query based on the user's question and the provided database schema context.

Follow these rules strictly:
1. **CRITICAL:** You MUST prefix all table names with the 'dbo.' schema (e.g., 'dbo.mas_employees'). This is mandatory.
2. **CRITICAL SYNTAX RULE:** The keyword order MUST BE 'SELECT DISTINCT TOP (N)'. NEVER write 'SELECT TOP (N) DISTINCT'.
3. **CASE SENSITIVITY:** Table and column names in the query must exactly match the case provided in the schema context.
4. ONLY respond with the SQL query. Do not include any explanations, comments, or markdown formatting like \`\`\`sql.
5. Use only the tables and columns defined in the provided schema context. Do not invent tables or columns.
6. To limit results, you MUST use the 'TOP (N)' syntax (e.g., TOP (20)). Do NOT use 'LIMIT'.
7. For safety, only generate SELECT queries.
8. **IMPOSSIBILITY CLAUSE:** If the user's question cannot be answered using the provided schema context, you MUST respond with the single keyword: CANNOT_ANSWER.

**Database Schema Context:**
${schemaContext}
`;
}

/**
 * Creates the prompt for analyzing query results.
 * @param {string} originalQuestion - The user's original question.
 * @param {Array<Object>} queryResults - Data from the database.
 * @returns {string} The complete analysis prompt.
 */
function createAnalysisPrompt(originalQuestion, queryResults) {
    return `You are a helpful data analyst. Your task is to provide a clear, natural language answer to the user's question based on the provided data.

Original Question: "${originalQuestion}"

Query Results (in JSON format):
${JSON.stringify(queryResults, null, 2)}

Please provide a concise and easy-to-understand summary of these results. If the results are empty, state that no data was found for the question.`;
}

module.exports = {
    createSqlGenerationPrompt,
    createAnalysisPrompt,
};