require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = process.env.PORT || 10000; // Render prefers 10000+

// ======================
// GCP CONFIGURATION (BULLETPROOF VERSION)
// ======================
const gcpCredentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);

// Critical: Fix private key formatting
gcpCredentials.private_key = gcpCredentials.private_key.replace(/\\n/g, '\n');

const storage = new Storage({
  projectId: gcpCredentials.project_id,
  credentials: gcpCredentials,
  retryOptions: {
    autoRetry: true,
    maxRetries: 3
  }
});

const bucket = storage.bucket(process.env.GOOGLE_BUCKET_NAME);

// Enhanced connection test with explicit permission check
async function verifyAccess() {
  try {
    // Test both bucket and object-level permissions
    const [bucketExists] = await bucket.exists();
    if (!bucketExists) throw new Error('Bucket does not exist');
    
    const [permissions] = await bucket.iam.testPermissions([
      'storage.objects.list',
      'storage.objects.get'
    ]);
    
    console.log('✅ Verified permissions:', permissions);
    return true;
  } catch (err) {
    console.error('❌ Access verification failed:', err.message);
    throw err;
  }
}

// Immediate verification on startup
verifyAccess()
  .then(() => console.log(`🚀 Connected to GCS bucket: ${bucket.name}`))
  .catch(err => {
    console.error('FATAL: GCS connection failed');
    console.error('Please verify:');
    console.error(`1. Bucket exists: gs://${bucket.name}`);
    console.error(`2. Service account ${gcpCredentials.client_email} has Storage Object Admin role`);
    console.error(`3. Private key is properly formatted`);
    process.exit(1);
  });

// ======================
// API ENDPOINTS
// ======================
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'operational',
    bucket: bucket.name,
    serviceAccount: gcpCredentials.client_email
  });
});

app.get('/songs', async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    res.json(files.map(file => ({
      name: file.name.replace('.mp3', ''),
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
      size: file.metadata.size
    })));
  } catch (err) {
    console.error('GCS Error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch songs',
      message: err.message
    });
  }
});

app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const [files] = await bucket.getFiles({
      prefix: query.toLowerCase()
    });
    res.json(files.map(file => ({
      name: file.name.replace('.mp3', ''),
      url: `https://storage.googleapis.com/${bucket.name}/${file.name}`
    })));
  } catch (err) {
    res.status(500).json({ 
      error: 'Search failed',
      message: err.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('Endpoints:');
  console.log(`- Health: http://localhost:${port}`);
  console.log(`- Songs: http://localhost:${port}/songs`);
  console.log(`- Search: http://localhost:${port}/search?q=example`);
});
