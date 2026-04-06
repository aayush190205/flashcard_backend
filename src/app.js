const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
// Import Models
const Document = require('./models/Document'); 
const User = require('./models/User'); 
const groq = require('./config/groq');

const app = express();

// Setup
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
// src/app.js

// src/app.js

app.use(cors({
    origin: [
        "http://localhost:5173", 
        "https://flashcard-frontend-two.vercel.app" // Your EXACT Vercel URL from the error
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// --- ROUTE 1: PDF UPLOAD ---
app.post('/api/pdf/upload', upload.single('file'), async (req, res) => {
    try {
        const { clerkId, title } = req.body;
        const filePath = req.file.path;
        const loader = new PDFLoader(filePath, { splitPages: false });
        const docs = await loader.load();
        const fullText = docs.map(doc => doc.pageContent).join('\n');

        if (fullText.length < 50) throw new Error("File content empty");

        const newDoc = new Document({
            clerkId,
            title: title || req.file.originalname,
            fileUrl: req.file.originalname, 
            extractedText: fullText, 
        });
        await newDoc.save();
        fs.unlinkSync(filePath);
        res.json({ success: true, data: newDoc });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ success: false, message: "Upload failed" });
    }
});

// --- ROUTE 2: FETCH DOCS ---
app.get('/api/pdf', async (req, res) => {
    try {
        const { clerkId } = req.query;
        const docs = await Document.find({ clerkId }).select('title fileUrl createdAt'); 
        res.json({ success: true, data: docs });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- ROUTE 3: DELETE DOC ---
app.delete('/api/pdf/:id', async (req, res) => {
    try {
        await Document.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- ROUTE 4: CHAT (WITH SOCRATIC STATE MACHINE) ---
app.post('/api/chat/ask', async (req, res) => {
    try {
        const { message, documentId, history } = req.body;
        if (!documentId) return res.status(400).json({ success: false, message: "Select a document." });

        const doc = await Document.findById(documentId);
        const context = doc.extractedText.substring(0, 15000); 

        const conversationContext = history?.slice(-4).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        })) || [];

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a Strict Socratic AI Tutor. 
                    Context from Document: "${context}"

                    CRITICAL RULES (STATE MACHINE LOGIC):
                    1. If the user asks a normal question, answer it directly and thoroughly based ONLY on the context.
                    2. If the user prompt contains "[STUDENT_STUCK]" or they ask for a hint:
                       - DO NOT give them the direct answer to their previous question.
                       - Enter "Remediation State".
                       - Break the concept down into a simpler, foundational concept.
                       - Ask them a guiding question to lead them to the answer.
                    3. Congratulate them warmly when they connect the dots themselves.
                    4. If the information is not in the context at all, say "This document doesn't cover that."`
                },
                ...conversationContext,
                { role: "user", content: message }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.3, 
        });

        res.json({ success: true, reply: completion.choices[0].message.content });
    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ success: false, message: "AI Error" });
    }
});
// --- ROUTE 5: FLASHCARD GENERATOR ---
app.post('/api/flashcards/generate', async (req, res) => {
    try {
        const { documentId } = req.body;
        const doc = await Document.findById(documentId);
        
        // Limit context
        const context = doc.extractedText.substring(0, 15000);

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a Flashcard Generator.
                    INPUT TEXT: "${context}"
                    
                    TASK: Generate 10 flashcards.
                    
                    STRICT OUTPUT FORMAT:
                    [Question Text Here?]
                    [Answer Text Here]
                    ---
                    
                    RULES:
                    1. Separate each card with "---".
                    2. Put the Question on the first line.
                    3. Put the Answer on the second line.
                    4. Do NOT use prefixes like "Q:" or "Answer:". Just the text.`
                },
                { role: "user", content: "Generate now." }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
        });

        const text = completion.choices[0].message.content;

        
        const rawCards = text.split('---');
        const flashcards = rawCards.map(block => {
            // Split into lines and remove empty ones
            const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l);
            
            if (lines.length >= 2) {
                // First line is ALWAYS Question
                let front = lines[0];
                // Rest is Answer (joined back together)
                let back = lines.slice(1).join(' ');

                
                front = front.replace(/^(Q|Question|Front)[:\.-]\s*/i, '');
                back = back.replace(/^(A|Answer|Back)[:\.-]\s*/i, '');
                
                return { front, back };
            }
            return null;
        }).filter(c => c !== null);

        if (flashcards.length === 0) {
            flashcards.push({ front: "Error: No cards generated", back: "Please try again." });
        }

        res.json({ success: true, flashcards });

    } catch (error) {
        console.error("Flashcard Error:", error);
        res.status(500).json({ success: false });
    }
});
// --- ROUTE 5: DYNAMIC FLASHCARD REMEDIATION ---
app.post('/api/flashcards/remediate', async (req, res) => {
    try {
        const { front, back, documentId } = req.body;
        if (!documentId) return res.status(400).json({ success: false, message: "Missing Document ID" });

        const doc = await Document.findById(documentId);
        const context = doc.extractedText.substring(0, 15000); 

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an expert Socratic AI tutor.
                    
                    The user just failed THIS specific flashcard:
                    [FAILED QUESTION]: "${front}"
                    [FAILED ANSWER]: "${back}"

                    BACKGROUND CONTEXT: "${context}"

                    TASK: Generate exactly TWO new flashcards to help the user understand the FAILED ANSWER. Do NOT summarize the whole document. Focus STRICTLY on the failed concept.
                    
                    CARD 1 STRATEGY: Ask a fundamental question that defines the core term or prerequisite concept from the FAILED QUESTION.
                    CARD 2 STRATEGY: Ask a guiding "fill-in-the-blank" or simpler hint question that bridges Card 1 directly to the FAILED ANSWER.
                    
                    STRICT OUTPUT FORMAT:
                    [Question Text]
                    [Answer Text]
                    ---
                    [Question Text]
                    [Answer Text]
                    
                    RULES:
                    1. Output ONLY the two cards.
                    2. Separate them with "---".
                    3. Do NOT use prefixes like "Q:" or "Answer:".`
                },
                { role: "user", content: "Generate my 2 specific remediation cards now." }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.5, 
        });

        const text = completion.choices[0].message.content;
        const rawCards = text.split('---');
        const newCards = rawCards.map(block => {
            const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length >= 2) {
                let f = lines[0].replace(/^(Question|Q|Front)[:\.-]\s*/i, '');
                let b = lines[1].replace(/^(Answer|A|Back)[:\.-]\s*/i, '');
                return { front: f, back: b, isRemediation: true }; 
            }
            return null;
        }).filter(c => c !== null).slice(0, 2); 

        res.json({ success: true, flashcards: newCards });
    } catch (error) {
        console.error("Remediation Error:", error);
        res.status(500).json({ success: false, message: "AI Error" });
    }
});
// --- ROUTE 7: AUTH SYNC ---
app.post('/api/auth/sync', async (req, res) => {
    try {
        const { clerkId, email, name } = req.body;
        await User.findOneAndUpdate(
            { clerkId },
            { email, name, lastActive: new Date() },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/user/upgrade', async (req, res) => {
    const { clerkId } = req.body;
    await User.findOneAndUpdate({ clerkId }, { isPro: true });
    res.json({ success: true });
});

app.post('/api/user/downgrade', async (req, res) => {
    const { clerkId } = req.body;
    await User.findOneAndUpdate({ clerkId }, { isPro: false });
    res.json({ success: true, message: "Plan Cancelled" });
});

module.exports = app; 
