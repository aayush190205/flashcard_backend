const Document = require('../models/Document');
const pdfService = require('../services/pdf.service');

// Important: Notice how we keep this file thin by moving logic to services
exports.uploadPDF = async (req, res) => {
    try {
        if (!req.file) throw new Error("No file uploaded");

        const { clerkId, title } = req.body;
        const filePath = req.file.path;

        // 1. Extract text using the service
        const text = await pdfService.extractText(filePath);

        // 2. Set Expiration Date (Current Time + 24 Hours)
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 24);

        // 3. Save to MongoDB
        const newDoc = await Document.create({
            clerkId,
            title: title || req.file.originalname,
            fileUrl: filePath,
            extractedText: text,
            expireAt: expiryDate // MongoDB will auto-delete this
        });

        // 4. Immediate Cleanup: Remove binary file from server disk
        pdfService.deleteLocalFile(filePath);

        res.status(201).json({ success: true, data: newDoc });
    } catch (error) {
        // Cleanup file even if extraction fails
        if (req.file) pdfService.deleteLocalFile(req.file.path);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getDocuments = async (req, res) => {
    try {
        const { clerkId } = req.query;
        const docs = await Document.find({ clerkId }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: docs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteDocument = async (req, res) => {
    try {
        await Document.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: "Manual deletion successful" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};