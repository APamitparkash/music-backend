require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// Backblaze B2 configuration
const B2_ACCOUNT_ID = process.env.B2_ACCOUNT_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID;

let authToken = '';
let apiUrl = '';

async function authorizeB2() {
  const authString = Buffer.from(`${B2_ACCOUNT_ID}:${B2_APPLICATION_KEY}`).toString('base64');
  const response = await axios.get('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${authString}` }
  });
  
  authToken = response.data.authorizationToken;
  apiUrl = response.data.apiUrl;
  return response.data;
}

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!authToken) await authorizeB2();
    
    const response = await axios.post(`${apiUrl}/b2api/v2/b2_list_file_names`, {
      bucketId: B2_BUCKET_ID,
      maxFileCount: 1000
    }, {
      headers: { Authorization: authToken }
    });
    
    const files = response.data.files.filter(file => 
      file.fileName.toLowerCase().includes(query.toLowerCase())
    );
    
    res.json(files);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search songs' });
  }
});

// Stream endpoint
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!authToken) await authorizeB2();
    
    const response = await axios.post(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
      bucketId: B2_BUCKET_ID,
      fileNamePrefix: '',
      validDurationInSeconds: 3600,
      b2ContentDisposition: `attachment; filename="${fileId}"`
    }, {
      headers: { Authorization: authToken }
    });
    
    const downloadAuthToken = response.data.authorizationToken;
    const downloadUrl = `https://f002.backblazeb2.com/file/${B2_BUCKET_NAME}/${fileId}?Authorization=${downloadAuthToken}`;
    
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