const mongoose = require('mongoose');
const { getDbType, readJsonDb, writeJsonDb } = require('../config/db');

// 1. Mongoose Schema Definition
const ListingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  transactionType: { type: String, required: true, enum: ['Sell', 'Rent', 'Exchange', 'Donate'] },
  price: { type: Number, required: true },
  imageUrl: { type: String, required: true },
  hostel: { type: String, required: true },
  status: { type: String, required: true, enum: ['Available', 'Sold', 'Rented', 'Exchanged', 'Donated'], default: 'Available' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

const MongooseListing = mongoose.model('Listing', ListingSchema);

// Helper to populate owner in local JSON DB mode
const populateOwnerJSON = (listing, db) => {
  const owner = db.users.find(u => u.id === listing.owner || u._id === listing.owner);
  return {
    ...listing,
    owner: owner ? { _id: owner._id, name: owner.name, hostel: owner.hostel, email: owner.email } : null
  };
};

// 2. Unified Interface
const Listing = {
  find: async (filters = {}) => {
    if (getDbType() === 'mongodb') {
      let query = {};
      if (filters.search) {
        query.title = { $regex: filters.search, $options: 'i' };
      }
      if (filters.category) {
        query.category = filters.category;
      }
      if (filters.transactionType) {
        query.transactionType = filters.transactionType;
      }
      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.owner) {
        query.owner = filters.owner;
      }
      return await MongooseListing.find(query).populate('owner', 'name hostel email').sort({ createdAt: -1 });
    } else {
      const db = readJsonDb();
      let results = [...db.listings];

      if (filters.search) {
        const searchRegex = new RegExp(filters.search, 'i');
        results = results.filter(l => searchRegex.test(l.title));
      }
      if (filters.category) {
        results = results.filter(l => l.category === filters.category);
      }
      if (filters.transactionType) {
        results = results.filter(l => l.transactionType === filters.transactionType);
      }
      if (filters.status) {
        results = results.filter(l => l.status === filters.status);
      }
      if (filters.owner) {
        results = results.filter(l => l.owner === filters.owner);
      }

      // Sort by createdAt descending
      results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Populate owner
      return results.map(l => populateOwnerJSON(l, db));
    }
  },

  findById: async (id) => {
    if (getDbType() === 'mongodb') {
      return await MongooseListing.findById(id).populate('owner', 'name hostel email');
    } else {
      const db = readJsonDb();
      const listing = db.listings.find(l => l._id === id || l.id === id);
      if (!listing) return null;
      return populateOwnerJSON(listing, db);
    }
  },

  create: async (listingData) => {
    if (getDbType() === 'mongodb') {
      const newListing = new MongooseListing(listingData);
      const saved = await newListing.save();
      return await MongooseListing.findById(saved._id).populate('owner', 'name hostel email');
    } else {
      const db = readJsonDb();
      const newListing = {
        _id: Math.random().toString(36).substring(2, 11),
        id: Math.random().toString(36).substring(2, 11),
        title: listingData.title,
        description: listingData.description,
        category: listingData.category,
        transactionType: listingData.transactionType,
        price: Number(listingData.price),
        imageUrl: listingData.imageUrl,
        hostel: listingData.hostel,
        status: listingData.status || 'Available',
        owner: listingData.owner,
        createdAt: new Date()
      };
      db.listings.push(newListing);
      writeJsonDb(db);
      return populateOwnerJSON(newListing, db);
    }
  },

  findByIdAndUpdate: async (id, updateData) => {
    if (getDbType() === 'mongodb') {
      return await MongooseListing.findByIdAndUpdate(id, updateData, { new: true }).populate('owner', 'name hostel email');
    } else {
      const db = readJsonDb();
      const index = db.listings.findIndex(l => l._id === id || l.id === id);
      if (index === -1) return null;

      db.listings[index] = {
        ...db.listings[index],
        ...updateData,
        price: updateData.price !== undefined ? Number(updateData.price) : db.listings[index].price
      };
      writeJsonDb(db);
      return populateOwnerJSON(db.listings[index], db);
    }
  },

  findByIdAndDelete: async (id) => {
    if (getDbType() === 'mongodb') {
      return await MongooseListing.findByIdAndDelete(id);
    } else {
      const db = readJsonDb();
      const index = db.listings.findIndex(l => l._id === id || l.id === id);
      if (index === -1) return null;
      const deleted = db.listings.splice(index, 1)[0];
      writeJsonDb(db);
      return deleted;
    }
  }
};

module.exports = { Listing, MongooseListing };
