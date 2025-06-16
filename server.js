require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Google Cloud Storage with robust error handling
let storage;
try {
  storage = new Storage({
    projectId: process.env.GOOGLE_PROJECT_ID,
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    retryOptions: {
      autoRetry: true,
      maxRetries: 3,
      maxRetryDelay: 2000
    }
  });

  // Test connection immediately
  storage.getBuckets()
    .then(() => console.log('✅ Storage connection successful'))
    .catch(err => console.error('❌ Initial storage connection failed:', err));
} catch (err) {
  console.error('❌ Storage initialization error:', err);
  process.exit(1);
}

const bucket = storage.bucket(process.env.GOOGLE_BUCKET_NAME);

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper function with retry logic
async function bucketOperationWithRetry(operation, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      console.warn(`Attempt ${i + 1} failed, retrying...`, err.message);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

// API Endpoints

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await bucketOperationWithRetry(() => bucket.getFiles({ maxResults: 1 }));
    res.json({ 
      status: 'healthy',
      bucket: bucket.name,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message,
      details: {
        bucket: bucket.name,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// List all songs with retry
app.get('/songs', async (req, res) => {
  try {
    const files = await bucketOperationWithRetry(() => bucket.getFiles());
    const songs = files[0].map(file => ({
      name: file.name,
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
      size: file.metadata.size,
      lastModified: file.metadata.updated,
      genre: file.name.includes('/') ? file.name.split('/')[0] : 'All Songs'
    }));
    res.json(songs);
  } catch (error) {
    console.error('Error listing songs:', error);
    res.status(500).json({ 
      error: 'Failed to list songs',
      details: error.message 
    });
  }
});

// List songs in specific genre
app.get('/songs/:genre', async (req, res) => {
  try {
    const prefix = req.params.genre === "All Songs" ? "" : `${req.params.genre}/`;
    const files = await bucketOperationWithRetry(() => bucket.getFiles({ prefix }));
    
    const songs = files[0]
      .filter(file => !file.name.endsWith('/'))
      .map(file => ({
        name: file.name.replace(prefix, ''),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        genre: req.params.genre
      }));
    
    res.json(songs);
  } catch (error) {
    console.error('Error listing genre songs:', error);
    res.status(500).json({ 
      error: 'Failed to list genre songs',
      details: error.message 
    });
  }
});

// Search endpoint
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q?.trim() || '';
    const files = await bucketOperationWithRetry(() => bucket.getFiles());
    
    const results = files[0]
      .filter(file => path.basename(file.name).toLowerCase().includes(query.toLowerCase()))
      .map(file => ({
        name: path.basename(file.name),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        genre: file.name.split('/')[0] || 'All Songs'
      }));
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Search failed',
      details: error.message 
    });
  }
});

// Upload endpoint
app.post('/upload', upload.single('song'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const genre = req.body.genre || 'Other';
    const fileName = genre ? `${genre}/${req.file.originalname}` : req.file.originalname;
    const file = bucket.file(fileName);

    await bucketOperationWithRetry(() => file.save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype },
    }));

    res.json({
      message: 'File uploaded successfully',
      url: `https://storage.googleapis.com/${bucket.name}/${fileName}`
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      details: error.message 
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
