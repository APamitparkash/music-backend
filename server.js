require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Google Cloud Storage
const storage = new Storage({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
});
const bucket = storage.bucket(process.env.GOOGLE_BUCKET_NAME);

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// API Endpoints

// 1. List all songs
app.get('/songs', async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    const songs = files.map(file => ({
      name: file.name,
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
      size: file.metadata.size,
      lastModified: file.metadata.updated
    }));
    res.json(songs);
  } catch (error) {
    console.error('Error listing songs:', error);
    res.status(500).json({ error: 'Failed to list songs' });
  }
});

// 2. Search songs
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const [files] = await bucket.getFiles({ prefix: query });
    
    const results = files.map(file => ({
      name: file.name,
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`
    }));
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 3. Upload new song
app.post('/upload', upload.single('song'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = req.file.originalname;
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    res.json({
      message: 'File uploaded successfully',
      url: `https://storage.googleapis.com/${bucket.name}/${fileName}`
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// 4. Delete song
app.delete('/songs/:name', async (req, res) => {
  try {
    const fileName = req.params.name;
    await bucket.file(fileName).delete();
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});