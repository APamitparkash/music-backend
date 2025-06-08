require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Backblaze B2 configuration
const B2_ACCOUNT_ID = process.env.B2_ACCOUNT_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID;

// Cache for auth tokens (valid for 23 hours)
const authCache = new NodeCache({ stdTTL: 82800 });
const FILE_CACHE_TTL = 3600; // 1 hour cache for file listings

// Initialize B2 authorization
async function authorizeB2() {
  try {
    const authString = Buffer.from(`${B2_ACCOUNT_ID}:${B2_APPLICATION_KEY}`).toString('base64');
    const response = await axios.get('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      headers: { Authorization: `Basic ${authString}` },
      timeout: 5000
    });
    
    authCache.set('authToken', response.data.authorizationToken);
    authCache.set('apiUrl', response.data.apiUrl);
    authCache.set('downloadUrl', response.data.downloadUrl);
    
    return response.data;
  } catch (error) {
    console.error('B2 Authorization error:', error);
    throw new Error('Failed to authorize with Backblaze B2');
  }
}

// Middleware to ensure we have valid auth
async function ensureAuth(req, res, next) {
  try {
    if (!authCache.get('authToken')) {
      await authorizeB2();
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Service unavailable' });
  }
}

// Search endpoint with caching
app.get('/api/search', ensureAuth, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // Check cache first
    const cacheKey = `search-${query.toLowerCase()}`;
    const cachedResults = authCache.get(cacheKey);
    if (cachedResults) {
      return res.json(cachedResults);
    }

    const response = await axios.post(
      `${authCache.get('apiUrl')}/b2api/v2/b2_list_file_names`,
      {
        bucketId: B2_BUCKET_ID,
        maxFileCount: 1000,
        prefix: query.toLowerCase()
      },
      {
        headers: { Authorization: authCache.get('authToken') },
        timeout: 10000
      }
    );

    const files = response.data.files
      .filter(file => file.fileName.toLowerCase().includes(query.toLowerCase()))
      .map(file => ({
        fileId: file.fileName,
        fileName: file.fileName.split('/').pop(),
        contentLength: file.contentLength,
        contentType: file.contentType
      }));

    // Cache the results
    authCache.set(cacheKey, files, FILE_CACHE_TTL);

    res.json(files);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Failed to search songs',
      details: error.response?.data?.message || error.message
    });
  }
});

// Stream endpoint with enhanced security
app.get('/api/stream/:fileId', ensureAuth, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }

    // Generate a download token
    const response = await axios.post(
      `${authCache.get('apiUrl')}/b2api/v2/b2_get_download_authorization`,
      {
        bucketId: B2_BUCKET_ID,
        fileNamePrefix: fileId,
        validDurationInSeconds: 3600,
        b2ContentDisposition: `inline; filename="${encodeURIComponent(fileId)}"`
      },
      {
        headers: { Authorization: authCache.get('authToken') },
        timeout: 5000
      }
    );

    const downloadUrl = `${authCache.get('downloadUrl')}/file/${B2_BUCKET_NAME}/${encodeURIComponent(fileId)}?Authorization=${response.data.authorizationToken}`;
    
    res.json({ 
      url: downloadUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ 
      error: 'Failed to get stream URL',
      details: error.response?.data?.message || error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    await authorizeB2();
    console.log(`Server running on port ${PORT}`);
    console.log(`Backblaze B2 authorized. Download URL: ${authCache.get('downloadUrl')}`);
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
});
