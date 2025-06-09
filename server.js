require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const B2 = require('backblaze-b2');

const app = express();
app.use(cors());
app.use(express.json());

// Backblaze B2 Configuration
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID || process.env.B2_ACCOUNT_ID,
  applicationKey: process.env.B2_APP_KEY || process.env.B2_APPLICATION_KEY,
});

// Environment variables
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID;
const CACHE_TTL = process.env.CACHE_TTL || 3600; // 1 hour cache

// Cache implementation
let cache = {
  auth: null,
  authExpiry: null,
  files: null,
  filesExpiry: null
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    services: {
      backblaze: cache.auth ? 'connected' : 'disconnected'
    }
  });
});

// Helper function to authorize with B2
async function authorizeB2() {
  try {
    // Use cached auth if available and not expired
    if (cache.auth && cache.authExpiry > Date.now()) {
      return cache.auth;
    }

    const auth = await b2.authorize();
    cache.auth = auth;
    cache.authExpiry = Date.now() + (CACHE_TTL * 1000);
    return auth;
  } catch (error) {
    console.error('B2 Authorization failed:', error.message);
    throw new Error('Failed to authenticate with Backblaze B2');
  }
}

// Search endpoint using B2 SDK
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    await authorizeB2();

    const response = await b2.listFileNames({
      bucketId: B2_BUCKET_ID,
      prefix: query.trim().toLowerCase(),
      maxFileCount: 100
    });

    const files = response.data.files.map(file => ({
      fileId: file.fileId,
      fileName: file.fileName,
      size: file.contentLength,
      uploadTimestamp: file.uploadTimestamp
    }));

    res.json(files);
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ 
      error: 'Failed to search songs',
      details: error.response?.data || error.message
    });
  }
});

// Get all songs endpoint
app.get('/api/songs', async (req, res) => {
  try {
    await authorizeB2();

    // Use cached files if available and not expired
    if (cache.files && cache.filesExpiry > Date.now()) {
      return res.json(cache.files);
    }

    const response = await b2.listFileNames({
      bucketId: B2_BUCKET_ID,
      maxFileCount: 1000
    });

    // Generate signed URLs for each file
    const songs = await Promise.all(
      response.data.files.map(async (file) => {
        const downloadUrl = await b2.getDownloadUrl({
          bucketId: B2_BUCKET_ID,
          fileName: file.fileName,
        });
        return {
          fileId: file.fileId,
          fileName: file.fileName,
          size: file.contentLength,
          uploadTimestamp: file.uploadTimestamp,
          url: `${downloadUrl.data.downloadUrl}?Authorization=${downloadUrl.data.authorizationToken}`,
        };
      })
    );

    // Cache the results
    cache.files = songs;
    cache.filesExpiry = Date.now() + (CACHE_TTL * 1000);

    res.json(songs);
  } catch (error) {
    console.error('Error fetching songs:', error.message);
    res.status(500).json({ 
      error: 'Error fetching songs',
      details: error.response?.data || error.message
    });
  }
});

// Streaming endpoint with multiple options
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { filename } = req.query;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    await authorizeB2();

    // Option 1: Get download authorization
    const downloadUrl = await b2.getDownloadUrl({
      bucketId: B2_BUCKET_ID,
      fileName: fileId,
    });

    const streamUrl = `${downloadUrl.data.downloadUrl}?Authorization=${downloadUrl.data.authorizationToken}`;
    
    res.json({ 
      url: streamUrl,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      filename: filename || fileId
    });
    
  } catch (error) {
    console.error('Stream error:', error.message);
    res.status(500).json({ 
      error: 'Failed to get stream URL',
      details: error.response?.data || error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  try {
    await authorizeB2();
    console.log(`Connected to Backblaze B2 Bucket: ${B2_BUCKET_NAME}`);
  } catch (error) {
    console.error('Failed to connect to Backblaze B2:', error.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully');
  process.exit(0);
});
