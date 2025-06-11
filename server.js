require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const B2_ACCOUNT_ID = process.env.B2_ACCOUNT_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID;

let authToken = '';
let apiUrl = '';

async function authorizeB2() {
  try {
    const authString = Buffer.from(`${B2_ACCOUNT_ID}:${B2_APPLICATION_KEY}`).toString('base64');
    const response = await axios.get('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      headers: { Authorization: `Basic ${authString}` }
    });
    
    authToken = response.data.authorizationToken;
    apiUrl = response.data.apiUrl;
    return response.data;
  } catch (error) {
    console.error('B2 Authorization error:', error);
    throw new Error('Failed to authenticate with Backblaze B2');
  }
}

app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    if (!authToken) await authorizeB2();
    
    const response = await axios.post(`${apiUrl}/b2api/v2/b2_list_file_names`, {
      bucketId: B2_BUCKET_ID,
      maxFileCount: 1000
    }, {
      headers: { Authorization: authToken }
    });
    
    const files = response.data.files
      .filter(file => 
        file.fileName.toLowerCase().includes(query.toLowerCase()) && 
        file.fileName.endsWith('.mp3')
      )
      .map(file => ({
        fileId: file.fileId,
        fileName: file.fileName,
        contentLength: file.contentLength,
        contentType: file.contentType
      }));
    
    res.json(files);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Failed to search songs',
      details: error.response?.data?.message || error.message 
    });
  }
});

app.get('/api/stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    if (!authToken) await authorizeB2();

    const fileInfo = await axios.post(`${apiUrl}/b2api/v2/b2_get_file_info`, {
      fileId: fileId
    }, {
      headers: { Authorization: authToken }
    });

    const fileName = fileInfo.data.fileName;
    const bucketName = fileInfo.data.bucketName;

    const authResponse = await axios.post(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
      bucketId: B2_BUCKET_ID,
      fileNamePrefix: fileName,
      validDurationInSeconds: 3600,
      b2ContentDisposition: `inline; filename="${fileName}"`
    }, {
      headers: { Authorization: authToken }
    });

    const downloadUrl = `${authResponse.data.downloadUrl}/file/${bucketName}/${encodeURIComponent(fileName)}?Authorization=${authResponse.data.authorizationToken}`;

    // Verify URL works
    await axios.head(downloadUrl);
    
    res.json({ 
      url: downloadUrl,
      fileName: fileName 
    });
  } catch (error) {
    console.error('Stream error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to get stream URL',
      details: error.response?.data?.message || error.message,
      suggestion: 'Please check if the file exists and permissions are correct'
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    bucket: B2_BUCKET_NAME,
    filesEndpoint: `${apiUrl}/b2api/v2/b2_list_file_names` 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Configured bucket: ${B2_BUCKET_NAME}`);
});
