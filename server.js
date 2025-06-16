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

// Helper function to get folders and root files
const getMusicData = async () => {
  try {
    // Get all files first to check if bucket has content
    const [allFiles] = await bucket.getFiles();
    
    // Get folders
    const [folderData] = await bucket.getFiles({ delimiter: '/' });
    const folders = folderData.prefixes ? folderData.prefixes.map(f => ({
      name: f.replace('/', ''),
      path: f
    })) : [];

    // Get root files (not in any folder)
    const rootFiles = allFiles
      .filter(file => !file.name.includes('/') && file.name.endsWith('.mp3'))
      .map(file => ({
        name: file.name,
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        genre: 'All Songs'
      }));

    return { folders, rootFiles };
  } catch (error) {
    console.error('Error getting music data:', error);
    return { folders: [], rootFiles: [] };
  }
};

// API Endpoints

// 1. List all genres (folders) and root files
app.get('/genres', async (req, res) => {
  try {
    const { folders, rootFiles } = await getMusicData();
    
    // If we have root files, add "All Songs" as first genre
    const allGenres = rootFiles.length > 0 
      ? [{ name: "All Songs", path: "" }, ...folders]
      : folders;
    
    res.json(allGenres);
  } catch (error) {
    console.error('Error listing genres:', error);
    res.status(500).json({ error: 'Failed to list genres' });
  }
});

// 2. List songs - maintains your original functionality
app.get('/songs', async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    const songs = files.map(file => ({
      name: file.name,
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
      size: file.metadata.size,
      lastModified: file.metadata.updated,
      genre: file.name.includes('/') ? file.name.split('/')[0] : 'All Songs'
    }));
    res.json(songs);
  } catch (error) {
    console.error('Error listing songs:', error);
    res.status(500).json({ error: 'Failed to list songs' });
  }
});

// 3. List songs in a specific genre/folder
app.get('/songs/:genre', async (req, res) => {
  try {
    const prefix = req.params.genre === "All Songs" ? "" : `${req.params.genre}/`;
    const [files] = await bucket.getFiles({ prefix });
    
    const songs = files
      .filter(file => !file.name.endsWith('/')) // Exclude folders
      .map(file => ({
        name: file.name.replace(prefix, ''),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        genre: req.params.genre
      }));
    
    res.json(songs);
  } catch (error) {
    console.error('Error listing genre songs:', error);
    res.status(500).json({ error: 'Failed to list genre songs' });
  }
});

// 4. Search songs (maintains your original functionality)
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const [files] = await bucket.getFiles();
    
    const results = files
      .filter(file => file.name.toLowerCase().includes(query.toLowerCase()))
      .map(file => ({
        name: path.basename(file.name),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        genre: file.name.includes('/') ? file.name.split('/')[0] : 'All Songs'
      }));
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 5. Upload new song (modified to handle genres)
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
    res.status(500).json({ error: 'Upload failed' });
  }
});

// 6. Delete song (maintains your original functionality)
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
