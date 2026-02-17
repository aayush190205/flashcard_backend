const Groq = require("groq-sdk");
const { groqApiKey } = require("./env");
const groq = new Groq({
    apiKey: groqApiKey
});

module.exports = groq;