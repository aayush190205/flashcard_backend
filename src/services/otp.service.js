const crypto = require("crypto");

/**
 * Generates a 6-digit numeric OTP
 * @returns {string}
 */
exports.generateOTP = () => {
  // Secure random generation
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Validates the OTP (Simple string comparison for now)
 * @param {string} inputOtp 
 * @param {string} storedOtp 
 * @returns {boolean}
 */
exports.verifyOTP = (inputOtp, storedOtp) => {
  return inputOtp === storedOtp;
};