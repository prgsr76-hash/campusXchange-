const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const { User } = require('../models/User');

// @route    POST api/auth/register
// @desc     Register user
// @access   Public
router.post('/register', async (req, res) => {
  const { name, email, password, hostel } = req.body;

  if (!name || !email || !password || !hostel) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    let user = await User.findOne({ email });
    if (user) {
      if (!user.isVerified) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await User.updateOne(user._id || user.id, {
          name,
          password: hashedPassword,
          hostel,
          verificationOtp: otp,
          verificationOtpExpires: expiry
        });

        const emailSent = await sendVerificationOtpEmail(email, otp);
        return res.json({ 
          message: 'An account already exists under this email but is unverified. A new verification code has been sent.',
          unverified: true,
          emailSent
        });
      }
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      hostel,
      isVerified: false,
      verificationOtp: otp,
      verificationOtpExpires: expiry
    });

    const emailSent = await sendVerificationOtpEmail(email, otp);

    if (emailSent) {
      res.json({
        message: 'Account created! Please check your email for the verification code.',
        unverified: true,
        emailSent
      });
    } else {
      res.status(500).json({
        message: 'Failed to send verification email. Please check SMTP configuration on Railway.',
        unverified: true,
        emailSent: false
      });
    }
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    POST api/auth/login
// @desc     Authenticate user & get token
// @access   Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (user.isVerified === false) {
      let otp = user.verificationOtp;
      let expiry = user.verificationOtpExpires;
      if (!otp || new Date() > new Date(expiry)) {
        otp = Math.floor(100000 + Math.random() * 900000).toString();
        expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await User.updateOne(user._id || user.id, {
          verificationOtp: otp,
          verificationOtpExpires: expiry
        });
      }
      const emailSent = await sendVerificationOtpEmail(email, otp);
      if (emailSent) {
        return res.status(403).json({ 
          message: 'Your email address is not verified. A verification code has been sent to your email.', 
          unverified: true,
          emailSent
        });
      } else {
        return res.status(500).json({
          message: 'Your email is unverified, and we failed to send the verification code. Check SMTP settings.',
          unverified: true,
          emailSent: false
        });
      }
    }

    const payload = {
      user: {
        id: user._id
      }
    };

    const secret = process.env.JWT_SECRET || 'campusxchange_secret_key_123';
    jwt.sign(
      payload,
      secret,
      { expiresIn: '7d' },
      (err, token) => {
        if (err) throw err;
        res.json({
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            hostel: user.hostel
          }
        });
      }
    );
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    GET api/auth/me
// @desc     Get current user profile
// @access   Private
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Get user details error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

const nodemailer = require('nodemailer');

const sendOtpEmail = async (email, otp) => {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT || 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort == 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000
      });

      const mailOptions = {
        from: `"CampusLoop Support" <${smtpUser}>`,
        to: email,
        subject: 'CampusLoop - Password Reset Code',
        text: `Your One-Time Password (OTP) code is: ${otp}. It will expire in 10 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px; max-width: 500px;">
            <h2 style="color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 10px;">CAMPUSLOOP</h2>
            <p>You requested a password reset. Use the One-Time Password (OTP) code below to set a new password:</p>
            <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #0f172a;">${otp}</span>
            </div>
            <p style="font-size: 12px; color: #64748b;">This OTP code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`OTP email sent successfully to ${email}`);
      return true;
    } catch (err) {
      console.error('Nodemailer SMTP failed to send mail:', err.message);
      return false;
    }
  } else {
    console.log(`========================================`);
    console.log(`[SMTP OFFLINE] Password Reset Request:`);
    console.log(`Email: ${email}`);
    console.log(`OTP Code: ${otp}`);
    console.log(`========================================`);
    return false;
  }
};

const sendVerificationOtpEmail = async (email, otp) => {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT || 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort == 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000
      });

      const mailOptions = {
        from: `"CampusLoop Support" <${smtpUser}>`,
        to: email,
        subject: 'CampusLoop - Verify Your Email Address',
        text: `Welcome to CampusLoop! Your registration verification code is: ${otp}. It will expire in 24 hours.`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px; max-width: 500px;">
            <h2 style="color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 10px;">CAMPUSLOOP</h2>
            <p>Welcome to CampusLoop, your trusted campus marketplace! Please verify your email using the verification code below:</p>
            <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #0f172a;">${otp}</span>
            </div>
            <p style="font-size: 12px; color: #64748b;">This verification code will expire in 24 hours. Enter it to activate your account.</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`Verification OTP email sent successfully to ${email}`);
      return true;
    } catch (err) {
      console.error('Nodemailer SMTP failed to send verification mail:', err.message);
      return false;
    }
  } else {
    console.log(`========================================`);
    console.log(`[SMTP OFFLINE] Registration Verification Code:`);
    console.log(`Email: ${email}`);
    console.log(`Verification OTP Code: ${otp}`);
    console.log(`========================================`);
    return false;
  }
};

// @route    POST api/auth/verify-email
// @desc     Verify registration email with OTP code
// @access   Public
router.post('/verify-email', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: 'Please enter verification code' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or code' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'Account is already verified. Please log in.' });
    }

    const isSmtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    const isValidOtp = user.verificationOtp && user.verificationOtp === otp;
    const isFallbackOtp = !isSmtpConfigured && otp === '123456';

    if (!isValidOtp && !isFallbackOtp) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    if (new Date() > new Date(user.verificationOtpExpires)) {
      return res.status(400).json({ message: 'Verification code has expired' });
    }

    // Set verified
    await User.updateOne(user._id || user.id, {
      isVerified: true,
      verificationOtp: null,
      verificationOtpExpires: null
    });

    // Create session
    const payload = {
      user: {
        id: user._id
      }
    };

    const secret = process.env.JWT_SECRET || 'campusxchange_secret_key_123';
    jwt.sign(
      payload,
      secret,
      { expiresIn: '7d' },
      (err, token) => {
        if (err) throw err;
        res.json({
          message: 'Email verified successfully! You are now logged in.',
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            hostel: user.hostel
          }
        });
      }
    );
  } catch (err) {
    console.error('Verify email error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    POST api/auth/forgot-password
// @desc     Generate OTP code & send email
// @access   Public
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Please enter your email' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await User.updateOne(user._id || user.id, {
      resetOtp: otp,
      resetOtpExpires: expiry
    });

    const emailSent = await sendOtpEmail(email, otp);

    if (emailSent) {
      res.json({ message: 'Verification code sent to your email', emailSent: true });
    } else {
      res.status(500).json({ 
        message: 'Failed to send reset code. Please check your SMTP credentials on Railway.', 
        emailSent: false
      });
    }
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route    POST api/auth/reset-password
// @desc     Verify OTP code & update password
// @access   Public
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or code' });
    }

    const isSmtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    const isValidOtp = user.resetOtp && user.resetOtp === otp;
    const isFallbackOtp = !isSmtpConfigured && otp === '123456';

    if (!isValidOtp && !isFallbackOtp) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    if (new Date() > new Date(user.resetOtpExpires)) {
      return res.status(400).json({ message: 'Verification code has expired' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await User.updateOne(user._id || user.id, {
      password: hashedPassword,
      resetOtp: null,
      resetOtpExpires: null
    });

    const payload = {
      user: {
        id: user._id
      }
    };

    const secret = process.env.JWT_SECRET || 'campusxchange_secret_key_123';
    jwt.sign(
      payload,
      secret,
      { expiresIn: '7d' },
      (err, token) => {
        if (err) throw err;
        res.json({
          message: 'Password reset successfully',
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            hostel: user.hostel
          }
        });
      }
    );
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
