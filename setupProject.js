const fs = require("fs");
const path = require("path");

const folders = [
  "src",
  "src/config",
  "src/middleware",
  "src/routes",
  "src/services",
  "src/utils",
  "scripts",
];

const files = {
  "src/app.js": "// Main Express server setup\n",
  "src/config/index.js": "// Centralized configuration loader\n",
  "src/middleware/errorHandler.js": "// Global error handler\n",
  "src/routes/ask.js": "// Routes for the /ask endpoint\n",
  "src/services/dbService.js": "// Handles all DB connections and queries\n",
  "src/services/geminiService.js": "// Handles all interactions with the Gemini API\n",
  "src/services/ragService.js": "// Core RAG logic: indexing and retrieval\n",
  "src/utils/promptManager.js": "// Manages and builds prompts dynamically\n",
  "scripts/indexSchemas.js": "// One-time script to build the RAG index\n",
  "schema_docs.yaml": "# Schema documentation (YAML format)\n",
  ".env": "",
};

// Create folders
folders.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log("Created folder:", dir);
  }
});

// Create files
Object.entries(files).forEach(([filePath, content]) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log("Created file:", filePath);
  }
});

console.log("\n✅ Project structure setup complete!");
