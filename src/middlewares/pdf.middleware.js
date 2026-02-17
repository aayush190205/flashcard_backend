const multer = require('multer');
const path = require('path');

// 1. Storage Engine Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // This saves files to the 'uploads' folder in your root
        cb(null, 'uploads/'); 
    },
    filename: (req, file, cb) => {
        // We add a timestamp to prevent duplicate filenames
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

// 2. File Filter (Security)
const fileFilter = (req, file, cb) => {
    // Strictly allow only PDFs to keep the 512MB Atlas clean
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are allowed!'), false);
    }
};

const upload = multer({ 
    storage, 
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

module.exports = upload;