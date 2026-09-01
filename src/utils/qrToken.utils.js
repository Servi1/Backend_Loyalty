const crypto = require("crypto");

const SECRET_KEY_RAW = process.env.JWT_SECRET || process.env.QR_TOKEN_SECRET || "servi_secure_qr_secret_key_2026";
// Derive a consistent 32-byte key for AES-256-CBC
const AES_KEY = crypto.scryptSync(SECRET_KEY_RAW, "servi_qr_salt", 32);

/**
 * Encodes a QR payload object into an encrypted URL-safe token.
 * @param {Object} payload - { tenantId, branchId, tableId, qrCashierId, orderTypeId }
 * @returns {string} base64url encoded encrypted token
 */
function encodeQrToken(payload) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", AES_KEY, iv);
    
    const data = JSON.stringify({
      t: payload.tenantId || null,
      b: payload.branchId || null,
      tbl: payload.tableId || null,
      qrc: payload.qrCashierId || null,
      ot: payload.orderTypeId || null,
      ts: Date.now()
    });

    let encrypted = cipher.update(data, "utf8", "base64url");
    encrypted += cipher.final("base64url");

    // Format: iv:encrypted
    const ivStr = iv.toString("base64url");
    return `${ivStr}.${encrypted}`;
  } catch (err) {
    throw new Error(`Failed to encode QR token: ${err.message}`);
  }
}

/**
 * Decodes an encrypted URL-safe token back into the QR payload object.
 * @param {string} token - The iv.encrypted string
 * @returns {Object} { tenantId, branchId, tableId, qrCashierId, orderTypeId }
 */
function decodeQrToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Invalid token format");
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Malformed token string");
  }

  try {
    const [ivStr, encrypted] = parts;
    const iv = Buffer.from(ivStr, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-cbc", AES_KEY, iv);

    let decrypted = decipher.update(encrypted, "base64url", "utf8");
    decrypted += decipher.final("utf8");

    const parsed = JSON.parse(decrypted);
    return {
      tenantId: parsed.t || null,
      branchId: parsed.b || null,
      tableId: parsed.tbl || null,
      qrCashierId: parsed.qrc || null,
      orderTypeId: parsed.ot || null,
      timestamp: parsed.ts || null
    };
  } catch (err) {
    throw new Error("Invalid, tampered, or expired QR token");
  }
}

module.exports = {
  encodeQrToken,
  decodeQrToken
};
