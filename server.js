const express = require('express');
const cors = require('cors');
const B2 = require('backblaze-b2');

const app = express();
app.use(cors());

const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    await b2.authorize();
    const response = await b2.listFileNames({
      bucketId: process.env.B2_BUCKET_ID,
      prefix: req.query.query || '',
      maxFileCount: 100
    });
    res.json(response.data.files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get playable URL
app.get('/api/stream/:fileId', async (req, res) => {
  try {
    await b2.authorize();
    const downloadUrl = await b2.getDownloadUrl({
      fileId: req.params.fileId
    });
    res.json({ url: `${downloadUrl.data.downloadUrl}?response-content-disposition=inline` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));