const mongoose = require('mongoose');
const { getDbType, readJsonDb, writeJsonDb } = require('../config/db');

// 1. Mongoose Schema Definition
const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  content: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const MongooseMessage = mongoose.model('Message', MessageSchema);

// Helper to populate user and listing details in JSON DB mode
const populateMessageJSON = (msg, db) => {
  const senderUser = db.users.find(u => u.id === msg.sender || u._id === msg.sender);
  const receiverUser = db.users.find(u => u.id === msg.receiver || u._id === msg.receiver);
  const item = db.listings.find(l => l.id === msg.listing || l._id === msg.listing);
  
  return {
    ...msg,
    sender: senderUser ? { _id: senderUser._id, name: senderUser.name, email: senderUser.email } : null,
    receiver: receiverUser ? { _id: receiverUser._id, name: receiverUser.name, email: receiverUser.email } : null,
    listing: item ? { _id: item._id, title: item.title, imageUrl: item.imageUrl, price: item.price } : null
  };
};

// 2. Unified Interface
const Message = {
  find: async (queryFilters = {}) => {
    if (getDbType() === 'mongodb') {
      let query = {};
      if (queryFilters.sender && queryFilters.receiver) {
        query.$or = [
          { sender: queryFilters.sender, receiver: queryFilters.receiver },
          { sender: queryFilters.receiver, receiver: queryFilters.sender }
        ];
      }
      if (queryFilters.listing) {
        query.listing = queryFilters.listing;
      }
      
      return await MongooseMessage.find(query)
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .populate('listing', 'title imageUrl price')
        .sort({ createdAt: 1 }); // chronological order for chat threads
    } else {
      const db = readJsonDb();
      if (!db.messages) db.messages = [];
      
      let results = [...db.messages];
      
      if (queryFilters.sender && queryFilters.receiver) {
        results = results.filter(m => 
          (m.sender === queryFilters.sender && m.receiver === queryFilters.receiver) ||
          (m.sender === queryFilters.receiver && m.receiver === queryFilters.sender)
        );
      }
      if (queryFilters.listing) {
        results = results.filter(m => m.listing === queryFilters.listing);
      }
      
      // Sort ascending
      results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      return results.map(m => populateMessageJSON(m, db));
    }
  },

  create: async (msgData) => {
    if (getDbType() === 'mongodb') {
      const newMsg = new MongooseMessage(msgData);
      const saved = await newMsg.save();
      return await MongooseMessage.findById(saved._id)
        .populate('sender', 'name email')
        .populate('receiver', 'name email')
        .populate('listing', 'title imageUrl price');
    } else {
      const db = readJsonDb();
      if (!db.messages) db.messages = [];
      
      const newMsg = {
        _id: Math.random().toString(36).substring(2, 11),
        id: Math.random().toString(36).substring(2, 11),
        sender: msgData.sender,
        receiver: msgData.receiver,
        listing: msgData.listing,
        content: msgData.content,
        read: false,
        createdAt: new Date()
      };
      
      db.messages.push(newMsg);
      writeJsonDb(db);
      return populateMessageJSON(newMsg, db);
    }
  },

  // Get active conversations list for user's Inbox view
  getConversations: async (userId) => {
    if (getDbType() === 'mongodb') {
      // Find all messages involving this user
      const messages = await MongooseMessage.find({
        $or: [{ sender: userId }, { receiver: userId }]
      })
      .populate('sender', 'name email hostel')
      .populate('receiver', 'name email hostel')
      .populate('listing', 'title imageUrl price')
      .sort({ createdAt: -1 }); // newest first

      const conversations = [];
      const seenKeys = new Set();

      for (const msg of messages) {
        if (!msg.sender || !msg.receiver || !msg.listing) continue;
        const otherUser = msg.sender._id.toString() === userId ? msg.receiver : msg.sender;
        
        // Group by user and listing
        const key = `${otherUser._id}-${msg.listing._id}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          
          // Count unread messages in this conversation where current user is receiver
          const unreadCount = await MongooseMessage.countDocuments({
            sender: otherUser._id,
            receiver: userId,
            listing: msg.listing._id,
            read: false
          });

          conversations.push({
            otherUser,
            listing: msg.listing,
            lastMessage: msg.content,
            lastMessageDate: msg.createdAt,
            unreadCount
          });
        }
      }
      return conversations;
    } else {
      const db = readJsonDb();
      if (!db.messages) db.messages = [];

      // Filter local JSON messages
      const messages = db.messages.filter(m => m.sender === userId || m.receiver === userId);
      // Sort newest first
      messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const conversations = [];
      const seenKeys = new Set();

      for (const msg of messages) {
        const otherUserId = msg.sender === userId ? msg.receiver : msg.sender;
        const otherUser = db.users.find(u => u.id === otherUserId || u._id === otherUserId);
        const item = db.listings.find(l => l.id === msg.listing || l._id === msg.listing);

        if (!otherUser || !item) continue;

        const key = `${otherUser._id}-${item._id}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);

          const unreadCount = db.messages.filter(m =>
            m.sender === otherUserId &&
            m.receiver === userId &&
            m.listing === item._id &&
            m.read === false
          ).length;

          conversations.push({
            otherUser: { _id: otherUser._id, name: otherUser.name, email: otherUser.email, hostel: otherUser.hostel },
            listing: { _id: item._id, title: item.title, imageUrl: item.imageUrl, price: item.price },
            lastMessage: msg.content,
            lastMessageDate: msg.createdAt,
            unreadCount
          });
        }
      }
      return conversations;
    }
  },

  // Mark all messages in a thread as read
  markAsRead: async (userId, senderId, listingId) => {
    if (getDbType() === 'mongodb') {
      return await MongooseMessage.updateMany(
        { receiver: userId, sender: senderId, listing: listingId, read: false },
        { $set: { read: true } }
      );
    } else {
      const db = readJsonDb();
      if (!db.messages) db.messages = [];
      
      db.messages.forEach(m => {
        if (m.receiver === userId && m.sender === senderId && m.listing === listingId) {
          m.read = true;
        }
      });
      
      writeJsonDb(db);
      return true;
    }
  },

  // Count total unread messages for a user
  countUnreadTotal: async (userId) => {
    if (getDbType() === 'mongodb') {
      return await MongooseMessage.countDocuments({ receiver: userId, read: false });
    } else {
      const db = readJsonDb();
      if (!db.messages) db.messages = [];
      
      return db.messages.filter(m => m.receiver === userId && m.read === false).length;
    }
  }
};

module.exports = { Message, MongooseMessage };
