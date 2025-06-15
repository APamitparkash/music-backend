require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Enhanced CORS configuration
const corsOptions = {
  origin: ['http://localhost:8081', 'exp://your-expo-url', 'https://your-frontend-domain.com'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Initialize Google Cloud Storage with error handling
let storage, bucket;
try {
  storage = new Storage({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS || '{}')
  });
  bucket = storage.bucket(process.env.GOOGLE_BUCKET_NAME);
} catch (error) {
  console.error('Storage initialization failed:', error);
  process.exit(1);
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    message: 'Music API is running',
    timestamp: new Date().toISOString()
  });
});

// Configure multer with file filtering
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/aac'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  }
});

// Helper function to handle errors
const handleError = (res, error, message = 'An error occurred') => {
  console.error(`${message}:`, error);
  res.status(500).json({ error: message, details: error.message });
};

// API Endpoints

// 1. List all songs with pagination
app.get('/songs', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const [files] = await bucket.getFiles({
      autoPaginate: false,
      maxResults: limit,
      offset: (page - 1) * limit
    });

    const songs = files.map(file => ({
      id: file.name,
      name: path.parse(file.name).name,
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
      size: file.metadata.size,
      lastModified: file.metadata.updated,
      contentType: file.metadata.contentType
    }));

    res.json({
      data: songs,
      page: parseInt(page),
      limit: parseInt(limit),
      total: files.length
    });
  } catch (error) {
    handleError(res, error, 'Failed to list songs');
  }
});

// 2. Enhanced search with multiple criteria
app.get('/search', async (req, res) => {
  try {
    const { q: query, type, limit = 10 } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const [files] = await bucket.getFiles({
      prefix: query,
      maxResults: limit
    });

    const results = files
      .filter(file => !type || file.metadata.contentType.includes(type))
      .map(file => ({
        id: file.name,
        name: path.parse(file.name).name,
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        type: file.metadata.contentType
      }));

    res.json(results);
  } catch (error) {
    handleError(res, error, 'Search failed');
  }
});

// 3. Secure file upload with validation
app.post('/upload', upload.single('song'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '');
    const file = bucket.file(fileName);

    // Check if file already exists
    const [exists] = await file.exists();
    if (exists) {
      return res.status(409).json({ error: 'File already exists' });
    }

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          uploadedBy: req.ip,
          uploadDate: new Date().toISOString()
        }
      },
      public: true
    });

    res.status(201).json({
      id: fileName,
      name: path.parse(fileName).name,
      url: `https://storage.googleapis.com/${bucket.name}/${fileName}`,
      size: req.file.size,
      type: req.file.mimetype
    });
  } catch (error) {
    handleError(res, error, 'Upload failed');
  }
});

// 4. Enhanced delete with confirmation
app.delete('/songs/:id', async (req, res) => {
  try {
    const fileName = req.params.id;
    const file = bucket.file(fileName);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    await file.delete();
    res.json({ message: 'File deleted successfully', id: fileName });
  } catch (error) {
    handleError(res, error, 'Delete failed');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  handleError(res, err, 'Server error');
});

// Start server with graceful shutdown
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
