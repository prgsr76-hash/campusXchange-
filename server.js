require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectDB } = require('./config/db');

const app = express();

// Connect to Database (MongoDB or local JSON DB)
connectDB();

// Init Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static assets
app.use(express.static(path.join(__dirname, 'public')));

// Define API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/messages', require('./routes/messages'));


// Fallback to index.html to support single page app routing on page refreshes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`CampusLoop Server running on port ${PORT}`);
  console.log(`Access local application at http://localhost:${PORT}`);
  console.log(`==================================================`);
});
