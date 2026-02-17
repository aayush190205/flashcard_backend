const groq = require('../config/groq');

class GroqService {
    /**
     * The "Academic Brain" of your app.
     * It takes the student's question and the PDF text to give a precise answer.
     */
    async getChatResponse(userMessage, pdfContext) {
        try {
            const response = await groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are a helpful Academic Tutor. Use the following PDF context to answer the student's question accurately. 
                        If the answer isn't in the context, say so, but try to be helpful.
                        Context: ${pdfContext}`
                    },
                    {
                        role: "user",
                        content: userMessage
                    }
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.5, // Keeps the AI factual rather than creative
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error("Groq AI Error:", error.message);
            throw new Error("AI Tutor is currently overthinking. Try again in a second!");
        }
    }
}

module.exports = new GroqService();