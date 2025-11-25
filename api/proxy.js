// api/proxy.js
const fetch = require('node-fetch');

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzigAL47G_8wcUH5Ik3423LnHW5RKPy0YYbuIPh8mFOHNDJpYeiUPi8YPkZD3Xw3OcH4w/exec';

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'POST') {
      const { action, ...data } = req.body;
      
      console.log('Proxying to Google Apps Script:', { action });
      
      const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...data })
      });
      
      const result = await response.json();
      res.json(result);
      
    } else if (req.method === 'GET') {
      const { action, username } = req.query;
      
      console.log('Proxying GET request:', { action, username });
      
      const url = `${SCRIPT_URL}?action=${action}&username=${encodeURIComponent(username || '')}`;
      const response = await fetch(url);
      const result = await response.json();
      
      res.json(result);
      
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
};