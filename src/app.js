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
app.use(cors());
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

// --- ROUTE 4: CHAT ---
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
                    content: `You are a Strict AI Tutor. Context: "${context}"`
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
// --- ROUTE 6: USER STATUS ---
app.get('/api/user/status', async (req, res) => {
    try {
        const { clerkId } = req.query;
        if(!clerkId) return res.json({ isPro: false, streak: 0 });

        let user = await User.findOne({ clerkId });
        if (!user) {
            user = new User({ clerkId, isPro: false, streak: 1, lastActiveDate: new Date() });
            await user.save();
            return res.json({ isPro: false, streak: 1 });
        }

        const today = new Date();
        const lastDate = user.lastActiveDate ? new Date(user.lastActiveDate) : new Date(0); 
        const isSameDay = (d1, d2) => d1.toDateString() === d2.toDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (!isSameDay(today, lastDate)) {
            if (isSameDay(lastDate, yesterday)) user.streak += 1;
            else user.streak = 1;
            
            user.lastActiveDate = today;
            await user.save();
        }

        res.json({ isPro: user.isPro, streak: user.streak || 0 });
    } catch (e) {
        res.status(500).json({ isPro: false, streak: 0 });
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