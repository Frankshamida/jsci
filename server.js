// In your Express server (the Node.js file)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500','http://127.0.0.1:5501/'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Parse JSON bodies
app.use(express.json());

// Serve static files (your HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '.')));

// Your Google Apps Script URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzigAL47G_8wcUH5Ik3423LnHW5RKPy0YYbuIPh8mFOHNDJpYeiUPi8YPkZD3Xw3OcH4w/exec';

// Proxy endpoint for all Google Apps Script requests
app.post('/api/proxy', async (req, res) => {
    try {
        const { action, ...data } = req.body;
        
        console.log('Proxying request to Google Apps Script:', { action, data });
        
        // Make sure we're sending the action parameter
        const requestBody = {
            action: action,
            ...data
        };
        
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        console.log('Google Apps Script response:', result);
        res.json(result);
        
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({
            success: false,
            message: 'Proxy error: ' + error.message
        });
    }
});

// Special endpoint for GET requests
app.get('/api/proxy-get', async (req, res) => {
    try {
        const { action, username } = req.query;
        
        console.log('Proxying GET request to Google Apps Script:', { action, username });
        
        const url = `${SCRIPT_URL}?action=${action}&username=${encodeURIComponent(username)}`;
        const response = await fetch(url);
        const result = await response.json();
        
        res.json(result);
        
    } catch (error) {
        console.error('Proxy GET error:', error);
        res.status(500).json({
            success: false,
            message: 'Proxy GET error: ' + error.message
        });
    }
});

// Serve your main HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'forgot-password.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Ministry Portal Server running on http://localhost:${PORT}`);
    console.log(`📝 Login: http://localhost:${PORT}/login`);
    console.log(`👤 Signup: http://localhost:${PORT}/signup`);
    console.log(`🔑 Forgot Password: http://localhost:${PORT}/forgot-password`);
    console.log(`🏠 Dashboard: http://localhost:${PORT}/dashboard`);
});