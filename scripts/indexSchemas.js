//indexSchemas.js
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../src/config');

// Initialize clients
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const chroma = new ChromaClient({ path: config.rag.chromaDbUrl });

// Constants
const SCHEMA_FILE_PATH = './schema_docs.yaml';
const COLLECTION_NAME = config.rag?.collectionName || 'sql_schemas';
const EMBEDDING_MODEL = config.gemini?.embeddingModel || 'text-embedding-004';
const RATE_LIMIT_DELAY = 200; // ms between API calls

/**
 * Validates the schema file structure
 */
function validateSchemaStructure(schemas) {
    const errors = [];
    
    if (!Array.isArray(schemas)) {
        errors.push('Schema file must contain an array of table definitions');
        return errors;
    }

    schemas.forEach((schema, index) => {
        if (!schema.table_name) {
            errors.push(`Schema at index ${index} is missing 'table_name'`);
        }
        if (!schema.description) {
            errors.push(`Schema at index ${index} is missing 'description'`);
        }
        if (!schema.columns || !Array.isArray(schema.columns)) {
            errors.push(`Schema at index ${index} is missing 'columns' array`);
        } else {
            schema.columns.forEach((col, colIndex) => {
                if (!col.name) {
                    errors.push(`Column at index ${colIndex} in table '${schema.table_name}' is missing 'name'`);
                }
                if (!col.description) {
                    errors.push(`Column at index ${colIndex} in table '${schema.table_name}' is missing 'description'`);
                }
            });
        }
    });

    return errors;
}

/**
 * Creates document strings from schema data with enhanced formatting
 */
function createDocuments(schemas) {
    return schemas.map(schema => {
        let content = `Table: ${schema.table_name}\n`;
        content += `Description: ${schema.description}\n\n`;
        
        // Add columns section
        content += `Columns:\n`;
        schema.columns.forEach(col => {
            content += `- ${col.name}`;
            if (col.type) content += ` (${col.type})`;
            content += `: ${col.description}\n`;
        });
        
        // Add relationships if present
        if (schema.relationships && schema.relationships.length > 0) {
            content += `\nRelationships:\n`;
            schema.relationships.forEach(rel => {
                content += `- ${rel}\n`;
            });
        }
        
        // Add additional info
        if (schema.extra_info) {
            content += `\nAdditional Info: ${schema.extra_info}\n`;
        }
        
        // Add sample queries if present
        if (schema.sample_queries && schema.sample_queries.length > 0) {
            content += `\nCommon Query Patterns:\n`;
            schema.sample_queries.forEach(query => {
                content += `- ${query}\n`;
            });
        }
        
        return content.trim();
    });
}

/**
 * Generates embeddings with retry logic and rate limiting
 */
async function generateEmbeddings(documents, schemas) {
    const model = genAI.getGenerativeModel({ 
        model: `models/${EMBEDDING_MODEL}`,
        generationConfig: {
            temperature: 0, // Deterministic embeddings
        }
    });
    
    const embeddings = [];
    const failedDocuments = [];
    
    console.log("🔄 Generating embeddings...");
    
    for (let i = 0; i < documents.length; i++) {
        const tableName = schemas[i].table_name;
        const progress = `${i + 1}/${documents.length}`;
        
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                console.log(`📝 Processing [${progress}]: ${tableName}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
                
                const result = await model.embedContent({
                    content: {
                        role: "user",
                        parts: [{ text: documents[i] }]
                    }
                });
                
                if (!result.embedding || !result.embedding.values) {
                    throw new Error('Invalid embedding response format');
                }
                
                embeddings.push(result.embedding.values);
                console.log(`✅ Successfully processed: ${tableName}`);
                break; // Success, break retry loop
                
            } catch (embedError) {
                retryCount++;
                console.error(`❌ Error generating embedding for ${tableName} (attempt ${retryCount}):`, embedError.message);
                
                if (retryCount >= maxRetries) {
                    failedDocuments.push({ tableName, error: embedError.message, index: i });
                    // Push null to maintain array alignment
                    embeddings.push(null);
                } else {
                    // Exponential backoff
                    const delay = RATE_LIMIT_DELAY * Math.pow(2, retryCount - 1);
                    console.log(`⏳ Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        // Rate limiting between successful requests
        if (i < documents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }
    }
    
    return { embeddings, failedDocuments };
}

/**
 * Connects to ChromaDB with retry logic
 */
async function connectToChromaDB() {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            console.log(`🔗 Connecting to ChromaDB...${retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}`);
            
            // Test connection first
            await chroma.heartbeat();
            
            const collection = await chroma.getOrCreateCollection({ 
                name: COLLECTION_NAME,
                metadata: { 
                    description: 'Database table schemas for text-to-SQL generation',
                    created_at: new Date().toISOString(),
                    embedding_model: EMBEDDING_MODEL
                }
            });
            
            console.log(`✅ Connected to ChromaDB collection '${COLLECTION_NAME}'`);
            return collection;
            
        } catch (error) {
            retryCount++;
            console.error(`❌ ChromaDB connection failed (attempt ${retryCount}):`, error.message);
            
            if (retryCount >= maxRetries) {
                throw new Error(`Failed to connect to ChromaDB after ${maxRetries} attempts. ${error.message}`);
            }
            
            const delay = 2000 * retryCount; // 2s, 4s, 6s
            console.log(`⏳ Retrying ChromaDB connection in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Adds documents to ChromaDB collection with validation
 */
async function addToCollection(collection, schemas, embeddings, documents) {
    // Filter out failed embeddings
    const validEntries = [];
    const skippedTables = [];
    
    schemas.forEach((schema, index) => {
        if (embeddings[index] !== null) {
            validEntries.push({
                id: schema.table_name,
                embedding: embeddings[index],
                metadata: {
                    tableName: schema.table_name,
                    description: schema.description,
                    columnCount: schema.columns.length,
                    hasRelationships: !!(schema.relationships && schema.relationships.length > 0),
                    indexed_at: new Date().toISOString()
                },
                document: documents[index]
            });
        } else {
            skippedTables.push(schema.table_name);
        }
    });
    
    if (validEntries.length === 0) {
        throw new Error('No valid embeddings to add to collection');
    }
    
    console.log(`📊 Adding ${validEntries.length} documents to ChromaDB...`);
    if (skippedTables.length > 0) {
        console.warn(`⚠️  Skipping ${skippedTables.length} tables due to embedding failures: ${skippedTables.join(', ')}`);
    }
    
    try {
        await collection.add({
            ids: validEntries.map(entry => entry.id),
            embeddings: validEntries.map(entry => entry.embedding),
            metadatas: validEntries.map(entry => entry.metadata),
            documents: validEntries.map(entry => entry.document),
        });
        
        console.log(`✅ Successfully added ${validEntries.length} documents to collection`);
        return { successCount: validEntries.length, skippedCount: skippedTables.length };
        
    } catch (error) {
        console.error('❌ Error adding documents to ChromaDB:', error.message);
        throw error;
    }
}

/**
 * Creates a backup of the existing collection (if it exists)
 */
async function backupExistingCollection() {
    try {
        const existingCollection = await chroma.getCollection({ name: COLLECTION_NAME });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `${COLLECTION_NAME}_backup_${timestamp}`;
        
        console.log(`🔄 Creating backup of existing collection as '${backupName}'...`);
        
        // Get all documents from existing collection
        const results = await existingCollection.get();
        
        if (results.ids && results.ids.length > 0) {
            // Create backup collection
            const backupCollection = await chroma.createCollection({ 
                name: backupName,
                metadata: { 
                    description: `Backup of ${COLLECTION_NAME} created on ${new Date().toISOString()}`,
                    original_collection: COLLECTION_NAME
                }
            });
            
            // Add data to backup
            await backupCollection.add({
                ids: results.ids,
                embeddings: results.embeddings,
                metadatas: results.metadatas,
                documents: results.documents,
            });
            
            console.log(`✅ Backup created successfully with ${results.ids.length} documents`);
        }
        
        // Delete the original collection
        await chroma.deleteCollection({ name: COLLECTION_NAME });
        console.log(`🗑️  Original collection deleted`);
        
    } catch (error) {
        if (error.message && error.message.includes('Collection') && error.message.includes('does not exist')) {
            console.log('ℹ️  No existing collection found to backup');
        } else {
            console.warn('⚠️  Warning: Could not create backup:', error.message);
        }
    }
}

/**
 * Validates the final collection state
 */
async function validateCollection(collection, expectedCount) {
    try {
        const results = await collection.get();
        const actualCount = results.ids ? results.ids.length : 0;
        
        console.log(`🔍 Collection validation:`);
        console.log(`   Expected documents: ${expectedCount}`);
        console.log(`   Actual documents: ${actualCount}`);
        
        if (actualCount !== expectedCount) {
            console.warn(`⚠️  Document count mismatch! Expected ${expectedCount}, got ${actualCount}`);
            return false;
        }
        
        // Test a sample query
        if (actualCount > 0 && results.embeddings && results.embeddings.length > 0) {
            try {
                const sampleResults = await collection.query({
                    queryEmbeddings: [results.embeddings[0]],
                    nResults: 1
                });
                
                if (sampleResults.documents && sampleResults.documents[0] && sampleResults.documents[0].length > 0) {
                    console.log(`✅ Collection is queryable and working correctly`);
                    return true;
                } else {
                    console.warn(`⚠️  Collection query test failed`);
                    return false;
                }
            } catch (queryError) {
                console.warn(`⚠️  Collection query test failed: ${queryError.message}`);
                return actualCount > 0; // Still consider valid if documents exist
            }
        }
        
        return true;
        
    } catch (error) {
        console.error(`❌ Collection validation failed:`, error.message);
        return false;
    }
}

/**
 * Main indexing function
 */
async function indexSchemas() {
    const startTime = Date.now();
    
    console.log("🚀 Starting enhanced schema indexing process...");
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log(`🔧 Configuration:`);
    console.log(`   - Schema file: ${SCHEMA_FILE_PATH}`);
    console.log(`   - Collection: ${COLLECTION_NAME}`);
    console.log(`   - Embedding model: ${EMBEDDING_MODEL}`);
    console.log(`   - ChromaDB URL: ${config.rag?.chromaDbUrl || 'http://localhost:8000'}`);

    try {
        // Step 1: Validate schema file exists
        console.log("\n📋 Step 1: Validating schema file...");
        if (!fs.existsSync(SCHEMA_FILE_PATH)) {
            throw new Error(`Schema file not found: ${SCHEMA_FILE_PATH}`);
        }

        // Step 2: Read and parse schema file
        console.log("📖 Step 2: Reading schema file...");
        const file = fs.readFileSync(SCHEMA_FILE_PATH, 'utf8');
        const schemas = yaml.parse(file);
        console.log(`✅ Found ${schemas.length} table schemas`);

        // Step 3: Validate schema structure
        console.log("🔍 Step 3: Validating schema structure...");
        const validationErrors = validateSchemaStructure(schemas);
        if (validationErrors.length > 0) {
            console.error('❌ Schema validation failed:');
            validationErrors.forEach(error => console.error(`   - ${error}`));
            throw new Error('Schema file has validation errors');
        }
        console.log("✅ Schema structure is valid");

        // Step 4: Create documents
        console.log("📝 Step 4: Creating documents...");
        const documents = createDocuments(schemas);
        console.log(`✅ Created ${documents.length} document strings`);

        // Step 5: Generate embeddings
        console.log("\n🤖 Step 5: Generating embeddings...");
        const { embeddings, failedDocuments } = await generateEmbeddings(documents, schemas);
        const successfulEmbeddings = embeddings.filter(e => e !== null).length;
        
        console.log(`✅ Generated embeddings: ${successfulEmbeddings}/${schemas.length}`);
        if (failedDocuments.length > 0) {
            console.warn('⚠️  Failed embeddings:');
            failedDocuments.forEach(failed => {
                console.warn(`   - ${failed.tableName}: ${failed.error}`);
            });
        }

        // Step 6: Connect to ChromaDB
        console.log("\n🔗 Step 6: Connecting to ChromaDB...");
        
        // Create backup if needed
        await backupExistingCollection();
        
        const collection = await connectToChromaDB();

        // Step 7: Add documents to collection
        console.log("\n💾 Step 7: Adding documents to collection...");
        const { successCount, skippedCount } = await addToCollection(collection, schemas, embeddings, documents);

        // Step 8: Validate collection
        console.log("\n🔍 Step 8: Validating collection...");
        const isValid = await validateCollection(collection, successCount);

        // Final summary
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        
        console.log("\n🎉 Schema indexing completed!");
        console.log("📊 Summary:");
        console.log(`   ✅ Successfully indexed: ${successCount} tables`);
        console.log(`   ⚠️  Skipped: ${skippedCount} tables`);
        console.log(`   ⏱️  Total time: ${(totalTime / 1000).toFixed(2)} seconds`);
        console.log(`   🔍 Collection valid: ${isValid ? 'Yes' : 'No'}`);
        
        if (failedDocuments.length > 0) {
            console.log(`   ❌ Failed embeddings: ${failedDocuments.length}`);
            console.log("\n💡 Consider checking the failed tables and re-running the indexing if needed.");
        }
        
        if (!isValid) {
            console.warn("\n⚠️  Warning: Collection validation failed. The index may not work correctly.");
            process.exit(1);
        }
        
        console.log("\n✨ Ready to process queries!");
        
    } catch (error) {
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        
        console.error("\n💥 Schema indexing failed!");
        console.error(`❌ Error: ${error.message}`);
        console.error(`⏱️  Failed after: ${(totalTime / 1000).toFixed(2)} seconds`);
        
        // Enhanced error diagnostics
        if (error.message && error.message.includes('Bad Request')) {
            console.error("\n🔧 Troubleshooting:");
            console.error("   - Check your Google AI API key is valid and active");
            console.error("   - Verify you have access to the embedding model");
            console.error("   - Check if you've exceeded API quotas");
        } else if (error.message && error.message.includes('ECONNREFUSED')) {
            console.error("\n🔧 Troubleshooting:");
            console.error("   - Make sure ChromaDB is running:");
            console.error("     docker run -d -p 8000:8000 chromadb/chroma");
            console.error("   - Wait 30 seconds after starting ChromaDB");
            console.error("   - Check if port 8000 is available");
        } else if (error.code === 'ENOENT') {
            console.error("\n🔧 Troubleshooting:");
            console.error("   - Make sure schema_docs.yaml exists in the project root");
            console.error("   - Check the file path and permissions");
        }
        
        process.exit(1);
    }
}

// Enhanced graceful shutdown handling
const gracefulShutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    console.log('⏳ Cleaning up resources...');
    
    // Add any cleanup logic here if needed
    setTimeout(() => {
        console.log('✅ Shutdown complete');
        process.exit(0);
    }, 1000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Promise Rejection:', reason);
    process.exit(1);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

// Run the indexing if this script is executed directly
if (require.main === module) {
    indexSchemas();
}

module.exports = { indexSchemas };