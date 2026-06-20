const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { Listing } = require('../models/Listing');

// @route    GET api/listings
// @desc     Get all listings with filters
// @access   Public
router.get('/', async (req, res) => {
  try {
    const { search, category, transactionType, status, owner } = req.query;
    const listings = await Listing.find({ search, category, transactionType, status, owner });
    res.json(listings);
  } catch (err) {
    console.error('Get listings error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    GET api/listings/:id
// @desc     Get listing by ID
// @access   Public
router.get('/:id', async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    res.json(listing);
  } catch (err) {
    console.error('Get listing by ID error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    POST api/listings
// @desc     Create a listing
// @access   Private
router.post('/', auth, async (req, res) => {
  const { title, description, category, transactionType, price, imageUrl, hostel } = req.body;

  if (!title || !description || !category || !transactionType || price === undefined || !imageUrl || !hostel) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    const newListing = await Listing.create({
      title,
      description,
      category,
      transactionType,
      price,
      imageUrl,
      hostel,
      owner: req.user.id,
      status: 'Available'
    });
    res.json(newListing);
  } catch (err) {
    console.error('Create listing error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    PUT api/listings/:id
// @desc     Update a listing (edit details or mark status)
// @access   Private
router.put('/:id', auth, async (req, res) => {
  const { title, description, category, transactionType, price, imageUrl, hostel, status } = req.body;

  try {
    let listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Verify ownership
    const ownerId = listing.owner._id ? listing.owner._id.toString() : listing.owner.toString();
    if (ownerId !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized to update this listing' });
    }

    // Build update object
    const updateFields = {};
    if (title) updateFields.title = title;
    if (description) updateFields.description = description;
    if (category) updateFields.category = category;
    if (transactionType) updateFields.transactionType = transactionType;
    if (price !== undefined) updateFields.price = price;
    if (imageUrl) updateFields.imageUrl = imageUrl;
    if (hostel) updateFields.hostel = hostel;
    if (status) updateFields.status = status;

    const updatedListing = await Listing.findByIdAndUpdate(req.params.id, updateFields);
    res.json(updatedListing);
  } catch (err) {
    console.error('Update listing error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    DELETE api/listings/:id
// @desc     Delete a listing
// @access   Private
router.delete('/:id', auth, async (req, res) => {
  try {
    let listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Verify ownership
    const ownerId = listing.owner._id ? listing.owner._id.toString() : listing.owner.toString();
    if (ownerId !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized to delete this listing' });
    }

    await Listing.findByIdAndDelete(req.params.id);
    res.json({ message: 'Listing removed successfully' });
  } catch (err) {
    console.error('Delete listing error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
