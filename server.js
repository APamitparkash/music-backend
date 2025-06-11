require('dotenv').config();
const express = require('express');
const cors = require('cors');
const B2 = require('backblaze-b2');

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Initialize B2 with proper endpoints from your auth response
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID || 'f11f22431ef0',
  applicationKey: process.env.B2_APP_KEY,
  endpoint: 'https://api005.backblazeb2.com' // From your auth response
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    b2: {
      accountId: process.env.B2_KEY_ID,
      bucket: process.env.B2_BUCKET_NAME
    }
  });
});

// Search files in bucket
app.get('/api/search', async (req, res) => {
  try {
    // Authorize with B2 (cached automatically by the library)
    await b2.authorize();
    
    const response = await b2.listFileNames({
      bucketId: process.env.B2_BUCKET_ID,
      prefix: req.query.query || '',
      maxFileCount: 100,
      delimiter: '/'
    });

    // Filter for audio files and format response
    const audioFiles = response.data.files
      .filter(file => file.contentType.startsWith('audio/'))
      .map(file => ({
        id: file.fileId,
        name: file.fileName,
        size: file.contentLength,
        type: file.contentType,
        uploadTimestamp: file.uploadTimestamp
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

// Generate direct download URL with authorization
app.get('/api/stream/:fileName', async (req, res) => {
  try {
    await b2.authorize();
    
    const fileName = req.params.fileName;
    
    // Get download authorization (valid for 1 hour)
    const authResponse = await b2.getDownloadAuthorization({
      bucketId: process.env.B2_BUCKET_ID,
      fileNamePrefix: fileName,
      validDurationInSeconds: 3600
    });

    // Construct direct download URL using your auth response domain
    const downloadUrl = `https://f005.backblazeb2.com/file/${process.env.B2_BUCKET_NAME}/${encodeURIComponent(fileName)}`;

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`B2 API Endpoint: https://api005.backblazeb2.com`);
  console.log(`B2 Download Domain: f005.backblazeb2.com`);
});
