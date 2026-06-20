const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

let dbType = 'json';
const jsonDbPath = path.join(__dirname, '../db_fallback.json');

// Initialize JSON database with empty collections if it doesn't exist
if (!fs.existsSync(jsonDbPath)) {
  fs.writeFileSync(jsonDbPath, JSON.stringify({ users: [], listings: [] }, null, 2));
}

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri);
      console.log('MongoDB Connected Successfully');
      dbType = 'mongodb';
    } catch (err) {
      console.error('MongoDB connection failed. Falling back to persistent local JSON database:', err.message);
      dbType = 'json';
    }
  } else {
    console.log('No MONGO_URI provided in env. Running in persistent local JSON Database mode.');
    dbType = 'json';
  }
};

const getDbType = () => dbType;

// Local JSON DB helper methods
const readJsonDb = () => {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading local JSON DB:', err);
    return { users: [], listings: [] };
  }
};

const writeJsonDb = (data) => {
  try {
    fs.writeFileSync(jsonDbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing local JSON DB:', err);
  }
};

module.exports = {
  connectDB,
  getDbType,
  readJsonDb,
  writeJsonDb
};
