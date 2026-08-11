const mainPrisma = require("../../config/prisma");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");
const { generateOtp } = require("../../utils/otp");
const twilio = require("twilio");

let twilioClient = null;
try {
  if (config.twilio.accountSid && config.twilio.accountSid.startsWith("AC") && config.twilio.authToken) {
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
} catch (err) {
  console.warn("⚠️  Twilio not configured — OTPs will be logged to console");
}

/**
 * Create a JWT for a user.
 */
const signToken = (userId, type = "user") =>
  jwt.sign({ sub: userId, type }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

/**
 * Send OTP to a phone number (Consumer App flow).
 */
const sendOtp = async (db, phone) => {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  await db.otp.create({ data: { phone, code, expiresAt } });

  // Send via Twilio (skip in development if not configured)
  if (twilioClient && config.twilio.phoneNumber) {
    await twilioClient.messages.create({
      body: `Your Servi verification code is: ${code}`,
      from: config.twilio.phoneNumber,
      to: phone,
    });
  } else {
    console.log(`[DEV] OTP for ${phone}: ${code}`);
  }

  return { message: "OTP sent" };
};



/**
 * Verify OTP and return a token + user (creates user if first login).
 */
const verifyOtp = async (db, phone, code, tenantId) => {
  const otp = await db.otp.findFirst({
    where: { phone, code, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) throw new ApiError(400, "Invalid or expired OTP");

  await db.otp.update({ where: { id: otp.id }, data: { verified: true } });

  let customer = await mainPrisma.appUser.findUnique({ where: { phone } });
  const isNewUser = !customer;

  if (!customer) {
    customer = await mainPrisma.appUser.create({
      data: {
        phone,
      },
    });
  }

  // Make sure global Wallet exists
  let wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customer.id } });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: {
        appUserId: customer.id,
        points: 0,
        lifetimeEarn: 0,
      },
    });
  }

  const token = signToken(customer.id, "customer");
  return { token, user: { ...customer, role: "CUSTOMER" }, isNewUser };
};

const attachUserPermissions = async (db, user) => {
  let roleIdToLookup = user.customRole;
  if (!roleIdToLookup && user.role !== "BRAND_MANAGER") {
    const roleMap = {
      BRANCH_MANAGER: "branch-manager",
      CASHIER: "cashier",
      WAITER: "waiter",
      KITCHEN: "kitchen",
      WAREHOUSE_MANAGER: "warehouse-manager"
    };
    roleIdToLookup = roleMap[user.role];
  }

  if (roleIdToLookup) {
    try {
      const roleObj = await db.customRole.findUnique({ where: { id: roleIdToLookup } });
      if (roleObj) {
        user.rolePermissions = roleObj.permissions;
        user.roleName = roleObj.name;
      }
    } catch (err) {
      console.error("Failed to load user role permissions during login:", err.message);
    }
  }
};

/**
 * B2B portal login (email + password).
 */
const loginWithEmail = async (db, email, password) => {
  // Check if the email field holds a valid POS Device Key (case-insensitive)
  const posDevice = await db.posDevice.findFirst({
    where: {
      deviceKey: {
        equals: email,
        mode: "insensitive"
      }
    }
  });
  if (posDevice) {
    if (posDevice.expiresAt && new Date(posDevice.expiresAt) < new Date()) {
      throw new ApiError(403, "This POS terminal subscription has expired. Please contact administration.");
    }
    // If a POS device key is matched, search for a CASHIER user with this pinCode in the device's branch
    const user = await db.user.findFirst({
      where: {
        branchId: posDevice.branchId,
        role: "CASHIER",
        pinCode: password,
      },
      include: { branch: true },
    });

    if (!user) throw new ApiError(401, "Invalid PIN code for this POS terminal");

    if (user.isActive === false) {
      throw new ApiError(403, "Your account has been deactivated. Please contact administration.");
    }

    if (user.branch && !user.branch.isOpen) {
      throw new ApiError(403, "This branch is currently deactivated.");
    }

    await attachUserPermissions(db, user);

    const token = signToken(user.id, "user");
    return { 
      token, 
      user, 
      posDevice: { 
        id: posDevice.id, 
        name: posDevice.name, 
        deviceKey: posDevice.deviceKey 
      } 
    };
  }

  const user = await db.user.findUnique({ where: { email }, include: { branch: true, warehouse: true } });
  if (!user) throw new ApiError(401, "Invalid credentials");

  if (user.isActive === false) {
    throw new ApiError(403, "Your account has been deactivated. Please contact administration.");
  }

  if (user.branch && !user.branch.isOpen && user.role !== "BRAND_MANAGER") {
    throw new ApiError(403, "This branch is currently deactivated.");
  }

  if (user.warehouse && !user.warehouse.isActive && user.role !== "BRAND_MANAGER") {
    throw new ApiError(403, "This warehouse is currently deactivated.");
  }

  // Check if PIN code is provided as password for cashier/waiter (direct login fallback)
  if (user.pinCode && password === user.pinCode) {
    await attachUserPermissions(db, user);
    const token = signToken(user.id, "user");
    return { token, user };
  }

  // Fallback to standard bcrypt password check
  if (!user.password) throw new ApiError(401, "Invalid credentials");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new ApiError(401, "Invalid credentials");

  const token = signToken(user.id, "user");

  await attachUserPermissions(db, user);

  return { token, user };
};

/**
 * Super Admin login (main DB).
 */
const superAdminLogin = async (email, password) => {
  const admin = await mainPrisma.superAdmin.findUnique({ where: { email } });
  if (!admin) throw new ApiError(401, "Invalid credentials");

  if (admin.status === "inactive") {
    throw new ApiError(403, "This account has been deactivated.");
  }

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) throw new ApiError(401, "Invalid credentials");

  const token = signToken(admin.id, "super_admin");

  if (admin.role && admin.role !== "super_admin") {
    try {
      const roleObj = await mainPrisma.superAdminRole.findUnique({ where: { id: admin.role } });
      if (roleObj) {
        admin.rolePermissions = roleObj.permissions;
        admin.roleName = roleObj.name;
      }
    } catch (err) {
      console.error("Failed to load admin role permissions during login:", err.message);
    }
  }

  return { token, admin };
};

/**
 * KDS login (deviceKey only).
 */
const kdsLogin = async (db, deviceKey) => {
  // Check if the deviceKey field holds a valid KDS Device Key (case-insensitive)
  const kdsDevice = await db.kdsDevice.findFirst({
    where: {
      deviceKey: {
        equals: deviceKey,
        mode: "insensitive"
      }
    }
  });
  if (!kdsDevice) {
    throw new ApiError(401, "Invalid KDS device key");
  }

  if (kdsDevice.expiresAt && new Date(kdsDevice.expiresAt) < new Date()) {
    throw new ApiError(403, "This KDS terminal subscription has expired. Please contact administration.");
  }

  // Find the KITCHEN user in this branch
  const user = await db.user.findFirst({
    where: {
      branchId: kdsDevice.branchId,
      role: "KITCHEN",
    },
    include: { branch: true },
  });

  if (!user) {
    throw new ApiError(401, "No kitchen staff user found for this KDS branch");
  }

  if (user.branch && !user.branch.isOpen) {
    throw new ApiError(403, "This branch is currently deactivated.");
  }

  const token = signToken(user.id, "user");
  return {
    token,
    user,
    kdsDevice: {
      id: kdsDevice.id,
      name: kdsDevice.name,
      deviceKey: kdsDevice.deviceKey
    }
  };
};

module.exports = { sendOtp, verifyOtp, loginWithEmail, superAdminLogin, kdsLogin };
