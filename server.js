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

// Initialize B2 with custom endpoint
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
  endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com'
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Search files in bucket
app.get('/api/search', async (req, res) => {
  try {
    await b2.authorize();
    
    const response = await b2.listFileNames({
      bucketId: process.env.B2_BUCKET_ID,
      prefix: req.query.query || '',
      maxFileCount: 100,
      delimiter: '/'
    });

    // Format response with relevant file info
    const files = response.data.files.map(file => ({
      id: file.fileId,
      name: file.fileName,
      size: file.contentLength,
      uploadTimestamp: file.uploadTimestamp,
      contentType: file.contentType
    }));

    res.json(files);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Failed to search files',
      details: error.message 
    });
  }
});

// Generate signed URL for streaming
app.get('/api/stream/:fileName', async (req, res) => {
  try {
    await b2.authorize();
    
    const fileName = req.params.fileName;
    const bucketName = process.env.B2_BUCKET_NAME;

    // Generate signed URL (valid for 1 hour)
    const authResponse = await b2.getDownloadAuthorization({
      bucketId: process.env.B2_BUCKET_ID,
      fileNamePrefix: fileName,
      validDurationInSeconds: 3600
    });

    // Construct S3-compatible URL
    const downloadUrl = new URL(
      `https://${bucketName}.${process.env.B2_ENDPOINT?.replace('https://', '') || 's3.us-east-005.backblazeb2.com'}/${fileName}`
    );

    // Add authorization token
    downloadUrl.searchParams.set('Authorization', authResponse.data.authorizationToken);

    res.json({ 
      url: downloadUrl.toString(),
      expiresAt: Date.now() + 3600000 // 1 hour from now
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ 
      error: 'Failed to generate stream URL',
      details: error.response?.data || error.message 
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
  console.log(`B2 Endpoint: ${process.env.B2_ENDPOINT || 'default'}`);
});