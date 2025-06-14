
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Storage client
  const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }
});

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

// Health check endpoint
app.get('/health', (req, res) => {
    res.send('Music Backend is running!');
  res.status(200).json({ status: 'healthy' });
});

// Search endpoint - now properly async
app.get('/search', async (req, res) => {  // Added async here
  try {
    const query = req.query.q?.toLowerCase() || '';
    const [files] = await bucket.getFiles();
    
    // Process files asynchronously
    const results = await Promise.all(
      files
        .filter(file => file.name.toLowerCase().includes(query))
        .map(async (file) => ({  // Added async here
          name: file.name,
          url: await generateSignedUrl(file.name),  // Now properly in async function
          metadata: await getSongMetadata(file)  // Now properly in async function
        }))
    );
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search songs' });
  }
});

// Async helper functions
async function generateSignedUrl(filename) {
  const [url] = await bucket.file(filename).getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
    contentType: 'audio/mpeg'
  });
  return url;
}

async function getSongMetadata(file) {
  const [metadata] = await file.getMetadata();
  return {
    contentType: metadata.contentType,
    size: metadata.size,
    timeCreated: metadata.timeCreated,
    updated: metadata.updated
  };
}

const PORT = process.env.PORT || 8080;  // Default to 8080 for Cloud Run
app.listen(PORT, '0.0.0.0', () => {    // Explicitly listen on all interfaces
  console.log(`Server running on port ${PORT}`);
});
