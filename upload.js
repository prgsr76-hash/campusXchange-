const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const auth = require('../middleware/auth');

// Configure Multer local storage fallback
const localUploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(localUploadsDir)) {
  fs.mkdirSync(localUploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, localUploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Images only (jpeg, jpg, png, webp)'));
    }
  }
});

// Configure Cloudinary if credentials are provided
let isCloudinaryConfigured = false;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  isCloudinaryConfigured = true;
  console.log('Cloudinary storage engine configured successfully.');
} else {
  console.log('Cloudinary credentials missing in env. Local image upload fallback active.');
}

// @route    POST api/upload
// @desc     Upload listing image
// @access   Private
router.post('/', auth, (req, res) => {
  upload.single('image')(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: `Multer upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    try {
      if (isCloudinaryConfigured) {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'campusxchange',
          transformation: [{ width: 800, height: 600, crop: 'limit' }]
        });

        // Delete temporary local file
        fs.unlinkSync(req.file.path);

        res.json({ imageUrl: result.secure_url });
      } else {
        // Return local relative URL
        const relativeUrl = `/uploads/${req.file.filename}`;
        res.json({ imageUrl: relativeUrl });
      }
    } catch (uploadErr) {
      console.error('Image upload processing error:', uploadErr.message);
      // Clean up local file in case of failure
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ message: 'Upload failed', error: uploadErr.message });
    }
  });
});

module.exports = router;
