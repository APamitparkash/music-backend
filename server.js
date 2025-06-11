require('dotenv').config();
const express = require('express');
const cors = require('cors');
const B2 = require('backblaze-b2');

const app = express();
app.use(cors());

// Initialize B2 with proper endpoint
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID || 'f11f22431ef0',
  applicationKey: process.env.B2_APP_KEY,
  endpoint: 'https://api005.backblazeb2.com' // From your auth response
});

// Search endpoint with proper filtering
app.get('/api/search', async (req, res) => {
  try {
    // First authorize
    const auth = await b2.authorize();
    
    // Then list files
    const response = await b2.listFileNames({
      bucketId: process.env.B2_BUCKET_ID,
      prefix: req.query.query || '',
      maxFileCount: 100,
      delimiter: ''
    });

    // Filter audio files and format response
    const audioFiles = response.data.files
      .filter(file => file.fileName.endsWith('.mp3')) // Only MP3 files
      .map(file => ({
        id: file.fileId,
        name: file.fileName,
        size: file.contentLength,
        type: file.contentType || 'audio/mpeg'
      }));

    res.json(audioFiles);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Failed to search files',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get playable URL with proper authorization
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    await b2.authorize();
    
    // Get download authorization
    const authResponse = await b2.getDownloadAuthorization({
      bucketId: process.env.B2_BUCKET_ID,
      fileNamePrefix: '', // For any file
      validDurationInSeconds: 3600 // 1 hour
    });

    // Get the file info first
    const fileInfo = await b2.getFileInfo({
      fileId: req.params.fileId
    });

    // Construct the download URL
    const downloadUrl = `https://f005.backblazeb2.com/file/${process.env.B2_BUCKET_NAME}/${fileInfo.data.fileName}`;

    res.json({
      url: downloadUrl,
      token: authResponse.data.authorizationToken,
      expiresAt: Date.now() + 3600000 // 1 hour from now
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ 
      error: 'Failed to generate stream URL',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`B2 API Endpoint: https://api005.backblazeb2.com`);
});
