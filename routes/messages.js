const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { Message } = require('../models/Message');
const { Listing } = require('../models/Listing');

// @route    POST api/messages
// @desc     Send a message to a student
// @access   Private
router.post('/', auth, async (req, res) => {
  const { receiver, listing, content } = req.body;

  if (!receiver || !listing || !content) {
    return res.status(400).json({ message: 'Missing required parameters' });
  }

  if (receiver === req.user.id) {
    return res.status(400).json({ message: 'You cannot send a message to yourself' });
  }

  try {
    // Verify listing exists
    const item = await Listing.findById(listing);
    if (!item) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const newMessage = await Message.create({
      sender: req.user.id,
      receiver,
      listing,
      content
    });

    res.json(newMessage);
  } catch (err) {
    console.error('Send message error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    GET api/messages/conversations
// @desc     Get all user conversations (Inbox list)
// @access   Private
router.get('/conversations', auth, async (req, res) => {
  try {
    const conversations = await Message.getConversations(req.user.id);
    res.json(conversations);
  } catch (err) {
    console.error('Get conversations list error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    GET api/messages/thread/:userId
// @desc     Get message history between current user and target user for an item
// @access   Private
router.get('/thread/:userId', auth, async (req, res) => {
  try {
    const { listingId } = req.query;
    if (!listingId) {
      return res.status(400).json({ message: 'Missing listingId parameter' });
    }

    const messages = await Message.find({
      sender: req.user.id,
      receiver: req.params.userId,
      listing: listingId
    });

    res.json(messages);
  } catch (err) {
    console.error('Get message thread error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
