const express = require('express');
const { URLSearchParams } = require('url');
const router = express.Router();

router.get('/', (req, res) => res.json({ status: 'ok' }));

// Nominatim proxy to prevent client-side 403 rate-limiting blocks
router.get('/nominatim-proxy', async (req, res) => {
  const { type, ...params } = req.query;
  const endpoint = type === 'reverse' ? 'reverse' : 'search';
  
  // Reconstruct query string
  const qs = new URLSearchParams(params).toString();
  const url = `https://nominatim.openstreetmap.org/${endpoint}?${qs}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ZenvyApp/1.0 (contact@zenvy.com)'
      }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Nominatim responded with an error status' });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[NOMINATIM_PROXY_ERR]', error.message);
    res.status(500).json({ error: 'Proxy request failed', details: error.message });
  }
});

module.exports = router;
