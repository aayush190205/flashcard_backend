const dotenv = require('dotenv');
dotenv.config();

// Important Learnings:
// 1. Validation: We check if keys exist so the app doesn't crash mysteriously later.
// 2. Defaulting: We provide a default (5000) for the PORT if one isn't set.

if (!process.env.GROQ_API_KEY) {
    console.error("❌ ERROR: GROQ_API_KEY is missing in .env file");
}

module.exports = {
    port: process.env.PORT || 5000,
    mongoUri: process.env.MONGODB_URI,
    groqApiKey: process.env.GROQ_API_KEY,
};