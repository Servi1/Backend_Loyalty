/**
 * Generate a random N-digit numeric OTP code.
 */
const generateOtp = (length = 6) => {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
};

module.exports = { generateOtp };
