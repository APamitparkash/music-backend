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

// Helper function to extract folder structure
const getFolderStructure = (files) => {
  const folders = new Set();
  
  files.forEach(file => {
    const parts = file.name.split('/');
    if (parts.length > 1) {
      folders.add(parts[0]);
    }
  });
  
  return Array.from(folders);
};

// API Endpoints

// 1. List all folders
app.get('/folders', async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    const folders = getFolderStructure(files);
    res.json(folders);
  } catch (error) {
    console.error('Error listing folders:', error);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

// 2. List all songs or songs in a specific folder
app.get('/songs/:folder?', async (req, res) => {
  try {
    const folder = req.params.folder;
    const prefix = folder ? `${folder}/` : '';
    
    const [files] = await bucket.getFiles({ prefix });
    
    const songs = files
      .filter(file => !file.name.endsWith('/')) // Exclude folder markers
      .map(file => ({
        name: path.basename(file.name),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        folder: folder || undefined,
        size: file.metadata.size,
        lastModified: file.metadata.updated
      }));
    
    res.json(songs);
  } catch (error) {
    console.error('Error listing songs:', error);
    res.status(500).json({ error: 'Failed to list songs' });
  }
});

// 3. Search songs across all folders
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const [files] = await bucket.getFiles();
    
    const results = files
      .filter(file => !file.name.endsWith('/')) // Exclude folder markers
      .filter(file => file.name.toLowerCase().includes(query.toLowerCase()))
      .map(file => {
        const parts = file.name.split('/');
        return {
          name: parts[parts.length - 1],
          url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
          folder: parts.length > 1 ? parts[0] : undefined
        };
      });
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 4. Upload new song
app.post('/upload', upload.single('song'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = req.body.folder 
      ? `${req.body.folder}/${req.file.originalname}`
      : req.file.originalname;
      
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

// 5. Delete song
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

// 6. Create new folder
app.post('/folders', async (req, res) => {
  try {
    const { folderName } = req.body;
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // In GCS, folders are implicit, but we can create a dummy file
    const folderPath = `${folderName}/.keep`;
    const file = bucket.file(folderPath);
    await file.save('', { contentType: 'text/plain' });

    res.json({ message: 'Folder created successfully' });
  } catch (error) {
    console.error('Folder creation error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
