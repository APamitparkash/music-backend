require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// Enhanced Backblaze B2 configuration
const B2_ACCOUNT_ID = process.env.B2_ACCOUNT_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID;
const B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://api.backblazeb2.com';

// Cache for B2 authorization
let authToken = '';
let apiUrl = '';
let downloadUrl = '';

// Improved authorization function with error handling
async function authorizeB2() {
  try {
    const authString = Buffer.from(`${B2_ACCOUNT_ID}:${B2_APPLICATION_KEY}`).toString('base64');
    const response = await axios.get(`${B2_ENDPOINT}/b2api/v2/b2_authorize_account`, {
      headers: { Authorization: `Basic ${authString}` },
      timeout: 5000
    });
    
    authToken = response.data.authorizationToken;
    apiUrl = response.data.apiUrl;
    downloadUrl = response.data.downloadUrl;
    return response.data;
  } catch (error) {
    console.error('B2 Authorization failed:', error.message);
    throw new Error('Failed to authenticate with Backblaze B2');
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Enhanced search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    if (!authToken) await authorizeB2();
    
    const response = await axios.post(`${apiUrl}/b2api/v2/b2_list_file_names`, {
      bucketId: B2_BUCKET_ID,
      maxFileCount: 1000,
      prefix: query.trim().toLowerCase()
    }, {
      headers: { Authorization: authToken },
      timeout: 10000
    });
    
    const files = response.data.files.map(file => ({
      id: file.fileId,
      name: file.fileName,
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

// Improved streaming endpoint
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { filename } = req.query;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    if (!authToken) await authorizeB2();
    
    // Option 1: Use public URL if bucket is public
    // const publicUrl = `${downloadUrl}/file/${B2_BUCKET_NAME}/${fileId}`;
    // return res.json({ url: publicUrl });
    
    // Option 2: Generate authorized download URL (for private buckets)
    const response = await axios.post(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
      bucketId: B2_BUCKET_ID,
      fileNamePrefix: fileId,
      validDurationInSeconds: 86400, // 24 hours
      b2ContentDisposition: filename ? `inline; filename="${encodeURIComponent(filename)}"` : 'inline'
    }, {
      headers: { Authorization: authToken },
      timeout: 10000
    });
    
    const downloadAuthToken = response.data.authorizationToken;
    const streamUrl = `${downloadUrl}/file/${B2_BUCKET_NAME}/${fileId}?Authorization=${downloadAuthToken}`;
    
    res.json({ 
      url: streamUrl,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString()
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
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Backblaze B2 Bucket: ${B2_BUCKET_NAME}`);
});
