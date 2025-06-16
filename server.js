require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Google Cloud Storage with debug logging
const storage = new Storage({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  projectId: process.env.GOOGLE_PROJECT_ID
});

const bucket = storage.bucket(process.env.GOOGLE_BUCKET_NAME);

// Verify bucket connection on startup
console.log('Initializing connection to bucket:', process.env.GOOGLE_BUCKET_NAME);
bucket.getFiles({ maxResults: 1 })
  .then(() => console.log('✅ Successfully connected to bucket'))
  .catch(err => console.error('❌ Bucket connection failed:', err));

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Helper function to get folders with debug logging
const getFolders = async () => {
  try {
    console.log('Fetching bucket contents...');
    const [allFiles] = await bucket.getFiles();
    console.log(`Found ${allFiles.length} total files`);

    const [folderResult] = await bucket.getFiles({ delimiter: '/' });
    console.log('Folder prefixes found:', folderResult.prefixes);

    // Process folders
    const folders = folderResult.prefixes?.map(folder => ({
      name: folder.replace('/', ''),
      path: folder
    })) || [];

    // Add "All Songs" if root files exist
    const hasRootFiles = allFiles.some(file => !file.name.includes('/'));
    if (hasRootFiles) {
      folders.unshift({ name: "All Songs", path: "" });
    }

    console.log('Returning folders:', folders);
    return folders;
  } catch (error) {
    console.error('Error in getFolders:', error);
    return [{ name: "All Songs", path: "" }]; // Fallback
  }
};

// API Endpoints

// 1. List all genres (folders)
app.get('/genres', async (req, res) => {
  try {
    const folders = await getFolders();
    res.json(folders);
  } catch (error) {
    console.error('Error in /genres:', error);
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
    console.log(`Fetching songs for prefix: "${prefix}"`);

    const [files] = await bucket.getFiles({ prefix });
    console.log(`Found ${files.length} files for prefix "${prefix}"`);

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
    console.error('Error in /songs/:genre:', error);
    res.status(500).json({ 
      error: 'Failed to list songs',
      details: error.message 
    });
  }
});

// 3. Search songs across all genres
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q?.trim() || '';
    console.log(`Searching for: "${query}"`);

    const [files] = await bucket.getFiles();
    const results = files
      .filter(file => path.basename(file.name).toLowerCase().includes(query.toLowerCase()))
      .map(file => ({
        name: path.basename(file.name),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        genre: file.name.split('/')[0] || 'All Songs'
      }));

    res.json(results);
  } catch (error) {
    console.error('Error in /search:', error);
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
    
    console.log(`Uploading file: ${fileName}`);
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype },
    });

    res.json({
      message: 'File uploaded successfully',
      url: `https://storage.googleapis.com/${bucket.name}/${fileName}`
    });
  } catch (error) {
    console.error('Error in /upload:', error);
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
