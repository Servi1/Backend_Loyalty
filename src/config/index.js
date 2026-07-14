require("dotenv").config();

const getAppImageURL = (imagePath) => {
  try {
    if (!imagePath) return imagePath;
    if (typeof imagePath !== "string") return imagePath;
    if (/^https?:\/\//i.test(imagePath)) {
      return imagePath;
    }
    const baseUrl = process.env.IMAGE_BASE_URL || "https://test2-api.servi.sa";
    const cleanPath = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
    return `${baseUrl}${cleanPath}`;
  } catch (error) {
    console.error("Error resolving app image URL:", error);
    return imagePath;
  }
};

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  jwt: {
    secret: process.env.JWT_SECRET || "fallback_secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },
  cors: {
    origin: "*",
  },
  getAppImageURL,
};

