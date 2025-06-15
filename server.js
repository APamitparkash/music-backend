require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = process.env.PORT || 10000; // Render works better with port 10000+

// ======================
// GCP CONFIGURATION (OPTIMIZED FOR RENDER)
// ======================
const gcpCredentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);

// Fix newlines in private key
gcpCredentials.private_key = gcpCredentials.private_key.replace(/\\n/g, '\n');

const storage = new Storage({
  projectId: gcpCredentials.project_id,
  credentials: gcpCredentials
});

const bucket = storage.bucket(process.env.GOOGLE_BUCKET_NAME);

// Immediate connection test
bucket.getFiles({ maxResults: 1 })
  .then(() => console.log('✅ Successfully connected to GCS bucket:', bucket.name))
  .catch(err => {
    console.error('❌ GCS Connection Error:', err.message);
    process.exit(1);
  });

// ======================
// MIDDLEWARE
// ======================
app.use(cors());
app.use(express.json());

// ======================
// API ENDPOINTS (SIMPLIFIED & RELIABLE)
// ======================

// Health Check
app.get('/', (req, res) => {
  res.json({
    status: 'ready',
    bucket: bucket.name,
    service: 'apmusicstream'
  });
});

// Get All Songs
app.get('/songs', async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    const songs = files.map(file => ({
      name: file.name.replace('.mp3', ''),
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`
    }));
    res.json(songs);
  } catch (err) {
    console.error('GCS Error:', err);
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

// Search Songs
app.get('/search', async (req, res) => {
  const query = req.query.q || '';
  
  if (!query.trim()) {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    const [files] = await bucket.getFiles({ 
      prefix: query.toLowerCase() // Case-insensitive search
    });

    res.json(files.map(file => ({
      name: file.name.replace('.mp3', ''),
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`
    })));
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// ======================
// SERVER START
// ======================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🔗 Endpoints:`);
  console.log(`- Health: http://localhost:${port}`);
  console.log(`- Songs: http://localhost:${port}/songs`);
  console.log(`- Search: http://localhost:${port}/search?q=example`);
});
