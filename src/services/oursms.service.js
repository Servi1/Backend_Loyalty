const axios = require("axios");

/**
 * Normalizes any phone number into the standard Saudi format required by OurSMS:
 * 9665XXXXXXXX (12 digits total, no "+", no "00", no leading "0").
 *
 * Examples:
 *  "0501234567"   -> "966501234567"
 *  "+966501234567" -> "966501234567"
 *  "501234567"    -> "966501234567"
 *  "966501234567" -> "966501234567"
 */
function formatForOurSms(phone) {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");

  // If starts with 00966 -> strip 00
  if (digits.startsWith("00966")) {
    digits = digits.slice(2);
  }
  // If starts with 05 -> replace 0 with 966
  else if (digits.startsWith("05")) {
    digits = "966" + digits.slice(1);
  }
  // If starts with 5 and is 9 digits long -> prefix 966
  else if (digits.startsWith("5") && digits.length === 9) {
    digits = "966" + digits;
  }
  // If already starts with 966 -> keep it
  else if (!digits.startsWith("966") && digits.length > 0) {
    digits = "966" + digits;
  }

  return digits;
}

/**
 * Sends an OTP SMS via OurSMS API (https://api.oursms.com/msgs/sms).
 *
 * @param {string} phone - Recipient phone number
 * @param {string} otpCode - Generated OTP code
 * @returns {Promise<{ success: boolean, data?: any, error?: any, mocked?: boolean }>}
 */
async function sendOtpSms(phone, otpCode) {
  const token = process.env.OURSMS_API_TOKEN;
  const isEnabled = process.env.OURSMS_ENABLED !== "false" && process.env.OURSMS_ENABLED !== false;
  const senderName = process.env.OURSMS_SENDER_NAME || "oursms";

  // If disabled, token is missing, or placeholder token remains, mock gracefully in console
  if (!isEnabled || !token || token.trim() === "" || token.includes("XXXXX") || token.includes("your_oursms")) {
    console.log(`[OURSMS-MOCK] SMS simulated (token not configured or disabled). Phone: ${phone}, OTP: ${otpCode}`);
    return { success: true, mocked: true };
  }

  const destPhone = formatForOurSms(phone);
  if (!destPhone || destPhone.length < 10) {
    console.warn(`[OURSMS] Invalid destination address for SMS: ${phone} -> ${destPhone}`);
    return { success: false, error: "Invalid destination address format" };
  }

  const payload = {
    src: senderName,
    dests: [destPhone],
    body: `Your Servi verification code is: ${otpCode}`,
    priority: 1,
    msgClass: "transactional",
  };

  try {
    const res = await axios.post("https://api.oursms.com/msgs/sms", payload, {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    console.log(`[OURSMS] SMS dispatched to ${destPhone}, jobId: ${res.data?.jobId || "N/A"}`);
    return { success: true, data: res.data };
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    console.error(`[OURSMS ERROR] Failed to send SMS to ${destPhone}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

module.exports = {
  formatForOurSms,
  sendOtpSms,
};
