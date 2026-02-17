const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    clerkId: { type: String, required: true, unique: true },
    email: { type: String },
    isPro: { type: Boolean, default: false },
    streak: { type: Number, default: 0 },
    lastActiveDate: { type: Date, default: null }
});

module.exports = mongoose.model('User', UserSchema);