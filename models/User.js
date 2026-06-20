const mongoose = require('mongoose');
const { getDbType, readJsonDb, writeJsonDb } = require('../config/db');

// 1. Mongoose Schema Definition
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  hostel: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MongooseUser = mongoose.model('User', UserSchema);

// 2. Unified Interface
const User = {
  // Find user by email
  findOne: async (query) => {
    if (getDbType() === 'mongodb') {
      return await MongooseUser.findOne(query);
    } else {
      const db = readJsonDb();
      const user = db.users.find(u => u.email === query.email);
      return user ? { ...user } : null;
    }
  },

  // Find user by ID
  findById: async (id) => {
    if (getDbType() === 'mongodb') {
      return await MongooseUser.findById(id).select('-password');
    } else {
      const db = readJsonDb();
      const user = db.users.find(u => u.id === id || u._id === id);
      if (user) {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      }
      return null;
    }
  },

  // Create a new user
  create: async (userData) => {
    if (getDbType() === 'mongodb') {
      const newUser = new MongooseUser(userData);
      return await newUser.save();
    } else {
      const db = readJsonDb();
      // Verify user email doesn't already exist
      if (db.users.some(u => u.email === userData.email)) {
        throw new Error('User already exists');
      }
      const newUser = {
        _id: Math.random().toString(36).substring(2, 11),
        id: Math.random().toString(36).substring(2, 11),
        name: userData.name,
        email: userData.email,
        password: userData.password,
        hostel: userData.hostel,
        createdAt: new Date()
      };
      db.users.push(newUser);
      writeJsonDb(db);
      const { password, ...userWithoutPassword } = newUser;
      return userWithoutPassword;
    }
  }
};

module.exports = { User, MongooseUser };
