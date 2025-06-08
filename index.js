require('dotenv').config();
const express = require('express');
const cors = require('cors');
const B2 = require('backblaze-b2');

const app = express();
app.use(cors());

const b2 = new B2({
  applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY
});

// Initialize B2 connection
let b2Authorized = false;

const authorizeB2 = async () => {
  if (!b2Authorized) {
    await b2.authorize();
    b2Authorized = true;
  }
};

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    await authorizeB2();
    
    const query = req.query.query || '';
    const response = await b2.listFileNames({
      bucketId: process.env.B2_BUCKET_ID,
      prefix: query,
      maxFileCount: 100
    });
    
    const songs = response.data.files.map(file => ({
      fileId: file.fileId,
      fileName: file.fileName,
      contentLength: file.contentLength,
      contentType: file.contentType
    }));
    
    res.json(songs);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search songs' });
  }
});

// Stream endpoint
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    await authorizeB2();
    
    const fileId = req.params.fileId;
    const response = await b2.getDownloadAuthorization({
      bucketId: process.env.B2_BUCKET_ID,
      fileNamePrefix: '',
      validDurationInSeconds: 3600, // 1 hour
      fileId
    });
    
    const downloadUrl = `${response.data.downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${fileId}`;
    res.json({ url: downloadUrl });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: 'Failed to get stream URL' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
