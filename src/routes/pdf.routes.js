const express = require('express');
const router = express.Router();
const pdfController = require('../controllers/pdf.controller');
const upload = require('../middlewares/pdf.middleware'); // From previous step

router.post('/upload', upload.single('file'), pdfController.uploadPDF);
router.get('/', pdfController.getDocuments);
router.delete('/:id', pdfController.deleteDocument);

module.exports = router;