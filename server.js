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

// Helper function to extract folder name from path
const getFolderName = (filePath) => {
  const dir = path.dirname(filePath);
  return dir === '.' ? '' : dir;
};

// API Endpoints

// 1. List all folders/categories
app.get('/folders', async (req, res) => {
  try {
    const [files] = await bucket.getFiles({ delimiter: '/' });
    const folders = (files.prefixes || []).map(folder => ({
      name: folder.replace('/', ''),
      type: 'folder'
    }));
    res.json(folders);
  } catch (error) {
    console.error('Error listing folders:', error);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

// 2. List songs in a specific folder
app.get('/songs/:folder', async (req, res) => {
  try {
    const folder = req.params.folder;
    const [files] = await bucket.getFiles({ prefix: `${folder}/` });
    
    const songs = files
      .filter(file => !file.name.endsWith('/')) // Exclude "folders"
      .map(file => ({
        name: path.basename(file.name),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        size: file.metadata.size,
        lastModified: file.metadata.updated,
        folder: getFolderName(file.name)
      }));
    
    res.json(songs);
  } catch (error) {
    console.error('Error listing folder songs:', error);
    res.status(500).json({ error: 'Failed to list folder songs' });
  }
});

// 3. List all songs (for compatibility)
app.get('/songs', async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    
    const songs = files
      .filter(file => !file.name.endsWith('/')) // Exclude "folders"
      .map(file => ({
        name: path.basename(file.name),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        size: file.metadata.size,
        lastModified: file.metadata.updated,
        folder: getFolderName(file.name)
      }));
    
    res.json(songs);
  } catch (error) {
    console.error('Error listing songs:', error);
    res.status(500).json({ error: 'Failed to list songs' });
  }
});

// 4. Search songs across all folders
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const [files] = await bucket.getFiles();
    
    const results = files
      .filter(file => {
        // Exclude directories and search in both filename and folder name
        return !file.name.endsWith('/') && 
          (file.name.toLowerCase().includes(query.toLowerCase()) ||
           path.dirname(file.name).toLowerCase().includes(query.toLowerCase()));
      })
      .map(file => ({
        name: path.basename(file.name),
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        folder: getFolderName(file.name)
      }));
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 5. Upload new song to a specific folder
app.post('/upload', upload.single('song'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get folder from request or use root
    const folder = req.body.folder || '';
    const fileName = folder ? `${folder}/${req.file.originalname}` : req.file.originalname;
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    // Make the file publicly accessible
    await file.makePublic();

    res.json({
      message: 'File uploaded successfully',
      url: `https://storage.googleapis.com/${bucket.name}/${fileName}`,
      folder: folder
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// 6. Create a new folder
app.post('/folders', async (req, res) => {
  try {
    const folderName = req.body.name;
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // In Google Cloud Storage, folders are implicit (just prefixes)
    // We create a "placeholder" empty file to make the folder appear
    const folderPath = `${folderName}/.keep`;
    const file = bucket.file(folderPath);
    await file.save('', { contentType: 'text/plain' });

    res.json({
      message: 'Folder created successfully',
      name: folderName
    });
  } catch (error) {
    console.error('Folder creation error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// 7. Delete song
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

// 8. Delete folder (and all its contents)
app.delete('/folders/:name', async (req, res) => {
  try {
    const folderName = req.params.name;
    const [files] = await bucket.getFiles({ prefix: `${folderName}/` });
    
    // Delete all files in the folder
    await Promise.all(files.map(file => file.delete()));
    
    res.json({ message: 'Folder and its contents deleted successfully' });
  } catch (error) {
    console.error('Folder deletion error:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
