require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const app = express();

// Backblaze B2 Configuration
const s3 = new AWS.S3({
  endpoint: process.env.B2_ENDPOINT || 's3.us-east-005.backblazeb2.com',
  accessKeyId: process.env.B2_APPLICATION_KEY_ID,
  secretAccessKey: process.env.B2_APPLICATION_KEY,
  region: 'us-east-005',
  signatureVersion: 'v4'
});

const BUCKET = process.env.B2_BUCKET || 'punjabi-songs';

// Middleware
app.use(cors());
app.use(express.json());

// Search Endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).send('Query parameter required');

    const data = await s3.listObjectsV2({ Bucket: BUCKET }).promise();
    
    const filteredSongs = data.Contents
      .filter(file => 
        file.Key.toLowerCase().includes(query.toLowerCase()) && 
        file.Key.endsWith('.mp3')
      )
      .map(file => ({
        fileId: file.Key,
        fileName: file.Key,
        size: file.Size,
        uploadTimestamp: file.LastModified.getTime()
      }));

    res.json(filteredSongs);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).send('Server error');
  }
});

// Stream Endpoint (Generates pre-signed URL)
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { filename } = req.query;

    const params = {
      Bucket: BUCKET,
      Key: fileId,
      Expires: 3600, // 1 hour expiration
      ResponseContentDisposition: `inline; filename="${filename || fileId}"`
    };

    const url = s3.getSignedUrl('getObject', params);
    res.json({ url });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).send('Error generating stream URL');
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
