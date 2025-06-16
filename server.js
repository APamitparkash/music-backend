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

// Helper function to get folders
const getFolders = async () => {
  try {
    const [files] = await bucket.getFiles({ delimiter: '/' });
    
    // If no folders exist but songs exist in root
    const [allFiles] = await bucket.getFiles();
    const hasRootFiles = allFiles.some(file => !file.name.includes('/'));
    
    if ((!files.prefixes || files.prefixes.length === 0) && hasRootFiles) {
      return [{ name: "All Songs", path: "" }];
    }
    
    return files.prefixes ? files.prefixes.map(folder => ({
      name: folder.replace('/', ''),
      path: folder
    })) : [];
  } catch (error) {
    console.error('Error getting folders:', error);
    return [];
  }
};

// API Endpoints

// 1. List all genre folders
app.get('/genres', async (req, res) => {
  try {
    const folders = await getFolders();
    res.json(folders);
  } catch (error) {
    console.error('Error listing genres:', error);
    res.status(500).json({ 
      error: 'Failed to list genres',
      details: error.message 
    });
  }
});

// 2. List songs in a genre/folder
app.get('/songs/:genre', async (req, res) => {
  try {
    const prefix = req.params.genre === "All Songs" ? "" : `${req.params.genre}/`;
    const [files] = await bucket.getFiles({ prefix });
    
    const songs = files
      .filter(file => !file.name.endsWith('/')) // Exclude folders
      .map(file => ({
        name: file.name.replace(prefix, ''),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        size: file.metadata.size,
        lastModified: file.metadata.updated,
        genre: req.params.genre
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

// 3. Search songs across all genres
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const [files] = await bucket.getFiles();
    
    const results = files
      .filter(file => file.name.toLowerCase().includes(query.toLowerCase()))
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

// 4. Upload new song
app.post('/upload', upload.single('song'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const genre = req.body.genre || 'Other';
    const fileName = genre ? `${genre}/${req.file.originalname}` : req.file.originalname;
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
    res.status(500).json({ 
      error: 'Upload failed',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
