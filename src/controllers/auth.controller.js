const User = require('../models/User');

exports.syncUser = async (req, res) => {
  try {
    const { clerkId, email, username } = req.body;

    if (!clerkId || !email) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // Find by Clerk ID OR Email
    let user = await User.findOne({ $or: [{ clerkId }, { email }] });

    if (user) {
      user.clerkId = clerkId; // Update ID if it was previously just an email
      await user.save();
      return res.status(200).json({ success: true, data: user });
    }

    user = await User.create({
      clerkId,
      email,
      username: username || email.split('@')[0]
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};