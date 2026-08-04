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
  smtp2go: {
    apiKey: process.env.SMTP2GO_API_KEY,
    sender: process.env.SMTP2GO_SENDER_EMAIL || "no-reply@servi.sa",
  },
  metaWhatsapp: {
    token: process.env.META_WHATSAPP_API_TOKEN,
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    templateName: process.env.META_WHATSAPP_REMINDER_TEMPLATE || "appointment_reminder",
  },
  cors: {
    origin: "*",
  },
  getAppImageURL,
};

