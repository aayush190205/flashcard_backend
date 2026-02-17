const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
    clerkId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    extractedText: { type: String },
    expireAt: { 
        type: Date, 
        index: { expires: '24h' } // The '24h' is the TTL setting
    }
}, { timestamps: true });

module.exports = mongoose.model('Document', DocumentSchema);