require('dotenv').config();
const express = require('express');
const cors = require('cors');
const B2 = require('backblaze-b2');

const app = express();
app.use(cors());

const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
  bucketId: process.env.B2_BUCKET_ID
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    await b2.authorize();
    const response = await b2.listFileNames({
      bucketId: process.env.B2_BUCKET_ID,
      prefix: req.query.query,
      maxFileCount: 100,
      delimiter: ''
    });
    
    const files = response.data.files.map(file => ({
      fileId: file.fileId,
      fileName: file.fileName,
      contentLength: file.contentLength,
      contentType: file.contentType
    }));
    
    res.json(files);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to search files' });
  }
});

// Stream endpoint
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    await b2.authorize();
    const response = await b2.getDownloadUrl({
      fileId: req.params.fileId,
      bucketName: process.env.B2_BUCKET_NAME
    });
    
    res.json({ url: response.data.downloadUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get stream URL' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});