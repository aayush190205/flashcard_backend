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

// Middleware & CORS
app.use(cors({
    origin: [
        "http://localhost:5173", 
        "https://flashcard-frontend-two.vercel.app" 
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// --- 1. USER & AUTH SYNC ROUTES ---

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

// GET USER STATUS (Fixes Sidebar 404 and SyntaxError)
app.get('/api/user/status', async (req, res) => {
    try {
        const { clerkId } = req.query;
        if (!clerkId) return res.status(400).json({ success: false });
        
        const user = await User.findOne({ clerkId });
        res.json({ 
            success: true, 
            isPro: user ? user.isPro : false, 
            streak: user ? user.streak : 0 
        });
    } catch (e) { 
        // Return valid JSON even on error to prevent frontend "Unexpected token <" crash
        res.status(200).json({ success: true, isPro: false, streak: 0 }); 
    }
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

// --- 2. PDF MANAGEMENT ---

app.post('/api/pdf/upload', upload.single('file'), async (req, res) => {
    try {
        const { clerkId, title } = req.body;
        const filePath = req.file.path;
        const loader = new PDFLoader(filePath, { splitPages: false });
        const docs = await loader.load();
        const fullText = docs.map(doc => doc.pageContent).join('\n');

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
        res.status(500).json({ success: false, message: "Upload failed" });
    }
});

app.get('/api/pdf', async (req, res) => {
    try {
        const { clerkId } = req.query;
        const docs = await Document.find({ clerkId }).select('title createdAt'); 
        res.json({ success: true, data: docs });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.delete('/api/pdf/:id', async (req, res) => {
    try {
        await Document.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// --- 3. AI CHAT (SOCRATIC TUTOR) ---

app.post('/api/chat/ask', async (req, res) => {
    try {
        const { message, documentId, history } = req.body;
        const doc = await Document.findById(documentId);
        
        // TOKEN BUDGETING: Context pruned to 4000 chars for rate limit stability
        const context = doc.extractedText.substring(0, 4000); 
        const chatHistory = history?.slice(-2).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        })) || [];

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a Strict Socratic Tutor. Context: "${context}". 
                    If the message contains [STUDENT_STUCK]: Give a foundational hint, DO NOT give the direct answer.`
                },
                ...chatHistory,
                { role: "user", content: message }
            ],
            model: "llama-3.1-8b-instant", // Higher throughput model to avoid 429 errors
            temperature: 0.3, 
        });
        res.json({ success: true, reply: completion.choices[0].message.content });
    } catch (error) { res.status(500).json({ success: false, message: "AI Busy" }); }
});

// --- 4. FLASHCARD GENERATION & REMEDIATION ---

app.post('/api/flashcards/generate', async (req, res) => {
    try {
        const { documentId } = req.body;
        const doc = await Document.findById(documentId);
        const context = doc.extractedText.substring(0, 4000);

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Generate 10 flashcards from: "${context}". 
                    Format: Question line, Answer line, separator "---".`
                }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.1,
        });

        const rawCards = completion.choices[0].message.content.split('---');
        const flashcards = rawCards.map(block => {
            const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length >= 2) return { front: lines[0], back: lines[1], isRemediation: false };
            return null;
        }).filter(c => c !== null);

        res.json({ success: true, flashcards });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/flashcards/remediate', async (req, res) => {
    try {
        const { front, back, documentId } = req.body;
        const doc = await Document.findById(documentId);
        const context = doc.extractedText.substring(0, 3000); 

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Expert Tutor mode. User failed card: "${front}". Context: "${context}". 
                    Generate 2 foundational hint cards to lead them to the answer. 
                    Format: Question line, Answer line, separator "---".`
                }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.5, 
        });

        const rawCards = completion.choices[0].message.content.split('---');
        const newCards = rawCards.map(block => {
            const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length >= 2) return { front: lines[0], back: lines[1], isRemediation: true };
            return null;
        }).filter(c => c !== null).slice(0, 2); 

        res.json({ success: true, flashcards: newCards });
    } catch (error) { res.status(500).json({ success: false }); }
});

module.exports = app;
