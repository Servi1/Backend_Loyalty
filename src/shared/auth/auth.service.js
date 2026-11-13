const mainPrisma = require("../../config/prisma");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");
const { generateOtp, generateRandomOtp, isDevOtpBypass, isDevBypassEnabled } = require("../../utils/otp");
const { sendOtpSms } = require("../../services/oursms.service");
const twilio = require("twilio");
const { getTenantClient } = require("../../config/tenantManager");
const { sendPasswordResetEmail, sendLoginOtpEmail } = require("../../services/email.service");

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
  const code = generateRandomOtp(4);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  await db.otp.create({ data: { phone, code, expiresAt } });

  // Send via OurSMS first, or fallback to Twilio if configured
  if (config.oursms?.token) {
    await sendOtpSms(phone, code);
  } else if (twilioClient && config.twilio.phoneNumber) {
    await twilioClient.messages.create({
      body: `Your Servi verification code is: ${code}`,
      from: config.twilio.phoneNumber,
      to: phone,
    });
  } else {
    console.log(`[DEV] OTP for ${phone}: ${code}`);
  }

  const devBypassAllowed = isDevBypassEnabled();
  return { message: "OTP sent", devBypass: devBypassAllowed };
};

/**
 * Verify OTP and return a token + user (creates user if first login).
 */
const verifyOtp = async (db, phone, code, tenantId) => {
  const inputCode = String(code).trim();
  const isBypass = isDevOtpBypass(inputCode);

  const otp = await db.otp.findFirst({
    where: { phone, code: inputCode, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!otp && !isBypass) throw new ApiError(400, "Invalid or expired OTP");

  if (otp) {
    await db.otp.update({ where: { id: otp.id }, data: { verified: true } });
  }

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
const loginWithEmail = async (db, email, password, bypassOtp = false, tenant = null) => {
  if (tenant && tenant.isActive === false) {
    throw new ApiError(403, "Account inactive. Your brand account has been deactivated by administration. Please contact support.");
  }

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
    if (tenant && tenant.subscriptionPaused) {
      throw new ApiError(403, "Subscription paused. Your brand subscription is currently inactive. Please contact your Brand Administrator.");
    }
    if (posDevice.isActive === false) {
      throw new ApiError(403, "This POS terminal slot has been cancelled or deactivated by administration.");
    }
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

    // Mark POS device as online
    await db.$executeRawUnsafe(
      'UPDATE "PosDevice" SET "isOnline" = true, "lastSeenAt" = NOW() WHERE id = $1',
      posDevice.id
    ).catch(() => null);

    await attachUserPermissions(db, user);

    const token = jwt.sign(
      { sub: user.id, type: "user", posDeviceId: posDevice.id, deviceKey: posDevice.deviceKey },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    return { 
      token, 
      user, 
      posDevice: { 
        id: posDevice.id, 
        name: posDevice.name, 
        deviceKey: posDevice.deviceKey,
        isOnline: true,
      } 
    };
  }

  const user = await db.user.findUnique({ where: { email }, include: { branch: true, warehouse: true } });
  if (!user) throw new ApiError(401, "Invalid credentials");

  if (tenant && tenant.subscriptionPaused && user.role !== "BRAND_MANAGER") {
    throw new ApiError(403, "Subscription paused. Your brand subscription is currently inactive. Branch Manager and staff login is restricted. Please contact your Brand Administrator.");
  }

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

  // If bypassOtp is TRUE or user has no email, return token directly (Dev Mode)
  if (bypassOtp || !user.email) {
    const token = signToken(user.id, "user");
    await attachUserPermissions(db, user);
    return { token, user };
  }

  // Otherwise, generate and send 6-digit Email OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await mainPrisma.otp.create({
    data: {
      phone: `email:${user.email.toLowerCase()}`,
      code,
      expiresAt,
    },
  });

  const tempToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      userType: "tenant_user",
      tenantId: tenant ? tenant.id : null,
      purpose: "login_otp",
    },
    config.jwt.secret,
    { expiresIn: "10m" }
  );

  try {
    await sendLoginOtpEmail({
      to: user.email,
      name: user.name,
      code,
    });
  } catch (err) {
    console.error("Failed to send login OTP email:", err.message);
  }

  return {
    requireOtp: true,
    tempToken,
    email: user.email,
    message: "A 6-digit verification code has been sent to your email.",
  };
};

/**
 * Super Admin login (main DB).
 */
const superAdminLogin = async (email, password, bypassOtp = false) => {
  const admin = await mainPrisma.superAdmin.findUnique({ where: { email } });
  if (!admin) throw new ApiError(401, "Invalid credentials");

  if (admin.status === "inactive") {
    throw new ApiError(403, "This account has been deactivated.");
  }

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) throw new ApiError(401, "Invalid credentials");

  // If bypassOtp is TRUE, return token directly (Dev Mode)
  if (bypassOtp) {
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
  }

  // Otherwise, generate and send 6-digit Email OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await mainPrisma.otp.create({
    data: {
      phone: `email:${admin.email.toLowerCase()}`,
      code,
      expiresAt,
    },
  });

  const tempToken = jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      userType: "super_admin",
      purpose: "login_otp",
    },
    config.jwt.secret,
    { expiresIn: "10m" }
  );

  try {
    await sendLoginOtpEmail({
      to: admin.email,
      name: admin.name,
      code,
    });
  } catch (err) {
    console.error("Failed to send super admin login OTP email:", err.message);
  }

  return {
    requireOtp: true,
    tempToken,
    email: admin.email,
    message: "A 6-digit verification code has been sent to your email.",
  };
};

/**
 * KDS login (deviceKey only).
 */
const kdsLogin = async (db, deviceKey, tenant = null) => {
  if (tenant && tenant.isActive === false) {
    throw new ApiError(403, "Account inactive. Your brand account has been deactivated by administration. Please contact support.");
  }
  if (tenant && tenant.subscriptionPaused) {
    throw new ApiError(403, "Subscription paused. Your brand subscription is currently inactive. Please contact your Brand Administrator.");
  }

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

  if (kdsDevice.isActive === false) {
    throw new ApiError(403, "This KDS terminal slot has been cancelled or deactivated by administration.");
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

  // Mark KDS device as online
  await db.$executeRawUnsafe(
    'UPDATE "KdsDevice" SET "isOnline" = true, "lastSeenAt" = NOW() WHERE id = $1',
    kdsDevice.id
  ).catch(() => null);

  const token = jwt.sign(
    { sub: user.id, type: "user", kdsDeviceId: kdsDevice.id, deviceKey: kdsDevice.deviceKey },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
  return {
    token,
    user,
    kdsDevice: {
      id: kdsDevice.id,
      name: kdsDevice.name,
      deviceKey: kdsDevice.deviceKey,
      isOnline: true,
    }
  };
};

/**
 * KDS logout (marks KDS device offline).
 */
const kdsLogout = async (db, { deviceKey, kdsDeviceId, deviceId } = {}) => {
  if (!db) throw new ApiError(400, "Tenant context is required");
  const targetId = kdsDeviceId || deviceId;
  let devKey = deviceKey;
  if (targetId) {
    const existing = await db.kdsDevice.findUnique({ where: { id: targetId } }).catch(() => null);
    if (existing) devKey = existing.deviceKey;
    await db.$executeRawUnsafe(
      'UPDATE "KdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE id = $1',
      targetId
    );
    return { message: "KDS device logged out", isOnline: false, deviceId: targetId, deviceKey: devKey, type: "kds" };
  }
  if (deviceKey) {
    const existing = await db.kdsDevice.findFirst({
      where: { deviceKey: { equals: String(deviceKey).trim(), mode: "insensitive" } }
    }).catch(() => null);
    await db.$executeRawUnsafe(
      'UPDATE "KdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE LOWER("deviceKey") = LOWER($1)',
      String(deviceKey).trim()
    );
    return { message: "KDS device logged out", isOnline: false, deviceId: existing?.id, deviceKey, type: "kds" };
  }
  throw new ApiError(400, "deviceKey or kdsDeviceId is required");
};

/**
 * POS logout (marks POS device offline).
 */
const posLogout = async (db, { deviceKey, posDeviceId, deviceId } = {}) => {
  if (!db) throw new ApiError(400, "Tenant context is required");
  const targetId = posDeviceId || deviceId;
  let devKey = deviceKey;
  if (targetId) {
    const existing = await db.posDevice.findUnique({ where: { id: targetId } }).catch(() => null);
    if (existing) devKey = existing.deviceKey;
    await db.$executeRawUnsafe(
      'UPDATE "PosDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE id = $1',
      targetId
    );
    return { message: "POS device logged out", isOnline: false, deviceId: targetId, deviceKey: devKey, type: "pos" };
  }
  if (deviceKey) {
    const existing = await db.posDevice.findFirst({
      where: { deviceKey: { equals: String(deviceKey).trim(), mode: "insensitive" } }
    }).catch(() => null);
    await db.$executeRawUnsafe(
      'UPDATE "PosDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE LOWER("deviceKey") = LOWER($1)',
      String(deviceKey).trim()
    );
    return { message: "POS device logged out", isOnline: false, deviceId: existing?.id, deviceKey, type: "pos" };
  }
  throw new ApiError(400, "deviceKey or posDeviceId is required");
};

/**
 * Generic device logout (POS / KDS / CDS).
 */
const deviceLogout = async (db, payload = {}) => {
  if (!db) return { message: "Logged out", isOnline: false };
  const { type, deviceKey, deviceId, kdsDeviceId, posDeviceId, cdsDeviceId } = payload;

  if (type === "kds" || kdsDeviceId) {
    return kdsLogout(db, { deviceKey, kdsDeviceId: kdsDeviceId || deviceId });
  }
  if (type === "pos" || posDeviceId) {
    return posLogout(db, { deviceKey, posDeviceId: posDeviceId || deviceId });
  }
  if (type === "cds" || cdsDeviceId) {
    const targetId = cdsDeviceId || deviceId;
    let devKey = deviceKey;
    if (targetId) {
      const existing = await db.cdsDevice.findUnique({ where: { id: targetId } }).catch(() => null);
      if (existing) devKey = existing.deviceKey;
      await db.$executeRawUnsafe('UPDATE "CdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE id = $1', targetId).catch(() => null);
      return { message: "CDS device logged out", isOnline: false, deviceId: targetId, deviceKey: devKey, type: "cds" };
    } else if (deviceKey) {
      const existing = await db.cdsDevice.findFirst({
        where: { deviceKey: { equals: String(deviceKey).trim(), mode: "insensitive" } }
      }).catch(() => null);
      await db.$executeRawUnsafe('UPDATE "CdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE LOWER("deviceKey") = LOWER($1)', String(deviceKey).trim()).catch(() => null);
      return { message: "CDS device logged out", isOnline: false, deviceId: existing?.id, deviceKey, type: "cds" };
    }
    return { message: "CDS device logged out", isOnline: false, type: "cds" };
  }

  // If no explicit type specified, mark matching deviceKey/deviceId offline across all device tables
  if (deviceId) {
    await db.$executeRawUnsafe('UPDATE "KdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE id = $1', deviceId).catch(() => null);
    await db.$executeRawUnsafe('UPDATE "PosDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE id = $1', deviceId).catch(() => null);
    await db.$executeRawUnsafe('UPDATE "CdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE id = $1', deviceId).catch(() => null);
    return { message: "Device logged out", isOnline: false, deviceId };
  }
  if (deviceKey) {
    const key = String(deviceKey).trim();
    await db.$executeRawUnsafe('UPDATE "KdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE LOWER("deviceKey") = LOWER($1)', key).catch(() => null);
    await db.$executeRawUnsafe('UPDATE "PosDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE LOWER("deviceKey") = LOWER($1)', key).catch(() => null);
    await db.$executeRawUnsafe('UPDATE "CdsDevice" SET "isOnline" = false, "lastSeenAt" = NOW() WHERE LOWER("deviceKey") = LOWER($1)', key).catch(() => null);
    return { message: "Device logged out", isOnline: false, deviceKey };
  }
  return { message: "Device logged out", isOnline: false };
};


/**
 * Request a password reset link sent to email.
 */
const requestPasswordReset = async ({ email, tenantId, origin }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new ApiError(400, "Please provide a valid email address.");
  }

  let userTarget = null;
  let userType = null;
  let targetTenant = null;

  // 1. Check Super Admin in main database
  const superAdmin = await mainPrisma.superAdmin.findUnique({
    where: { email: normalizedEmail }
  });

  if (superAdmin) {
    if (superAdmin.status === "inactive") {
      throw new ApiError(403, "This account is inactive. Please contact system support.");
    }
    userTarget = superAdmin;
    userType = "super_admin";
  } else {
    // 2. Check tenant users
    // If tenantId/companyNo is provided, check that specific tenant first
    if (tenantId) {
      const cleanTenantId = String(tenantId).trim();
      const tenant = await mainPrisma.tenant.findFirst({
        where: {
          isActive: true,
          OR: [{ id: cleanTenantId }, { slug: cleanTenantId }]
        }
      });
      if (tenant) {
        try {
          const tenantDb = getTenantClient(tenant.dbUrl);
          const user = await tenantDb.user.findUnique({
            where: { email: normalizedEmail },
            include: { branch: true }
          });
          if (user) {
            userTarget = user;
            userType = "tenant_user";
            targetTenant = tenant;
          }
        } catch (err) {
          console.error("Error looking up user in tenant DB:", err.message);
        }
      }
    }

    // If still not found, search across active tenants
    if (!userTarget) {
      const activeTenants = await mainPrisma.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true, slug: true, dbUrl: true }
      });

      for (const t of activeTenants) {
        try {
          const tDb = getTenantClient(t.dbUrl);
          const u = await tDb.user.findUnique({
            where: { email: normalizedEmail },
            include: { branch: true }
          });
          if (u) {
            userTarget = u;
            userType = "tenant_user";
            targetTenant = t;
            break;
          }
        } catch (_e) {
          // Continue to next tenant if connection fails
        }
      }
    }
  }

  if (!userTarget) {
    throw new ApiError(404, "No account was found with this email address.");
  }

  if (userTarget.isActive === false) {
    throw new ApiError(403, "This account is inactive. Please contact administration.");
  }

  // Generate single-use reset JWT token embedded with password fingerprint
  const pHash = (userTarget.password || "").slice(-8);
  const resetToken = jwt.sign(
    {
      sub: userTarget.id,
      email: userTarget.email,
      name: userTarget.name || "",
      userType,
      tenantId: targetTenant ? targetTenant.id : null,
      pHash,
      purpose: "password_reset",
    },
    config.jwt.secret,
    { expiresIn: "1h" }
  );

  let baseUrl = origin || process.env.FRONTEND_URL;
  if (!baseUrl) {
    baseUrl = "http://localhost:8080";
  }
  baseUrl = baseUrl.replace(/\/+$/, "");
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

  await sendPasswordResetEmail({
    to: userTarget.email,
    name: userTarget.name,
    resetLink,
  });

  return {
    success: true,
    message: "A password reset link has been sent to your email address.",
  };
};

/**
 * Verify validity of a password reset token.
 */
const verifyResetToken = async (token) => {
  if (!token) {
    throw new ApiError(400, "Reset token is required.");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new ApiError(400, "This password reset link has expired. Please request a new one.");
    }
    throw new ApiError(400, "Invalid reset token.");
  }

  if (decoded.purpose !== "password_reset") {
    throw new ApiError(400, "Invalid token purpose.");
  }

  if (decoded.userType === "super_admin") {
    const admin = await mainPrisma.superAdmin.findUnique({
      where: { id: decoded.sub }
    });
    if (!admin) {
      throw new ApiError(404, "User account no longer exists.");
    }
    if ((admin.password || "").slice(-8) !== decoded.pHash) {
      throw new ApiError(400, "This password reset link has already been used.");
    }
    return {
      valid: true,
      email: admin.email,
      name: admin.name,
      userType: "super_admin"
    };
  } else if (decoded.userType === "tenant_user") {
    if (!decoded.tenantId) {
      throw new ApiError(400, "Invalid tenant token.");
    }
    const tenant = await mainPrisma.tenant.findUnique({
      where: { id: decoded.tenantId }
    });
    if (!tenant) {
      throw new ApiError(404, "Tenant organization not found.");
    }
    const tenantDb = getTenantClient(tenant.dbUrl);
    const user = await tenantDb.user.findUnique({
      where: { id: decoded.sub }
    });
    if (!user) {
      throw new ApiError(404, "User account no longer exists.");
    }
    if ((user.password || "").slice(-8) !== decoded.pHash) {
      throw new ApiError(400, "This password reset link has already been used.");
    }
    return {
      valid: true,
      email: user.email,
      name: user.name,
      userType: "tenant_user",
      companyNo: tenant.slug || tenant.id
    };
  }

  throw new ApiError(400, "Unknown user type.");
};

/**
 * Reset password using validated reset token.
 */
const resetPassword = async ({ token, newPassword }) => {
  if (!token) {
    throw new ApiError(400, "Reset token is required.");
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters long.");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new ApiError(400, "This password reset link has expired. Please request a new one.");
    }
    throw new ApiError(400, "Invalid reset token.");
  }

  if (decoded.purpose !== "password_reset") {
    throw new ApiError(400, "Invalid token purpose.");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  if (decoded.userType === "super_admin") {
    const admin = await mainPrisma.superAdmin.findUnique({
      where: { id: decoded.sub }
    });
    if (!admin) {
      throw new ApiError(404, "Super Admin account not found.");
    }
    if ((admin.password || "").slice(-8) !== decoded.pHash) {
      throw new ApiError(400, "This password reset link has already been used.");
    }

    await mainPrisma.superAdmin.update({
      where: { id: admin.id },
      data: { password: hashedPassword }
    });

    return {
      success: true,
      userType: "super_admin",
      message: "Password reset successfully. You can now log in to the Super Admin portal."
    };
  } else if (decoded.userType === "tenant_user") {
    const tenant = await mainPrisma.tenant.findUnique({
      where: { id: decoded.tenantId }
    });
    if (!tenant) {
      throw new ApiError(404, "Tenant organization not found.");
    }
    const tenantDb = getTenantClient(tenant.dbUrl);
    const user = await tenantDb.user.findUnique({
      where: { id: decoded.sub }
    });
    if (!user) {
      throw new ApiError(404, "User account not found.");
    }
    if ((user.password || "").slice(-8) !== decoded.pHash) {
      throw new ApiError(400, "This password reset link has already been used.");
    }

    await tenantDb.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    return {
      success: true,
      userType: "tenant_user",
      companyNo: tenant.slug || tenant.id,
      message: "Password reset successfully. You can now log in with your new password."
    };
  }

  throw new ApiError(400, "Unknown user type.");
};


/**
 * Verify Email Login OTP and issue final auth token.
 */
const verifyLoginOtp = async ({ tempToken, code }) => {
  if (!tempToken) {
    throw new ApiError(400, "Verification session token is required.");
  }
  if (!code) {
    throw new ApiError(400, "Please enter the 6-digit verification code.");
  }

  let decoded;
  try {
    decoded = jwt.verify(tempToken, config.jwt.secret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new ApiError(400, "Verification code session expired. Please sign in again.");
    }
    throw new ApiError(400, "Invalid verification session.");
  }

  if (decoded.purpose !== "login_otp") {
    throw new ApiError(400, "Invalid token purpose.");
  }

  const inputCode = String(code).trim();
  const isBypass = isDevOtpBypass(inputCode);

  const otpRecord = await mainPrisma.otp.findFirst({
    where: {
      phone: `email:${decoded.email.toLowerCase()}`,
      code: inputCode,
      verified: false,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord && !isBypass) {
    throw new ApiError(400, "Invalid or expired verification code.");
  }

  if (otpRecord) {
    await mainPrisma.otp.update({
      where: { id: otpRecord.id },
      data: { verified: true },
    });
  }

  if (decoded.userType === "super_admin") {
    const admin = await mainPrisma.superAdmin.findUnique({ where: { id: decoded.sub } });
    if (!admin) throw new ApiError(404, "Super Admin account not found.");
    if (admin.status === "inactive") throw new ApiError(403, "This account has been deactivated.");

    const token = signToken(admin.id, "super_admin");

    if (admin.role && admin.role !== "super_admin") {
      try {
        const roleObj = await mainPrisma.superAdminRole.findUnique({ where: { id: admin.role } });
        if (roleObj) {
          admin.rolePermissions = roleObj.permissions;
          admin.roleName = roleObj.name;
        }
      } catch (err) {
        console.error("Failed to load admin role permissions:", err.message);
      }
    }

    return { token, admin, userType: "super_admin" };
  } else if (decoded.userType === "tenant_user") {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: decoded.tenantId } });
    if (!tenant) throw new ApiError(404, "Tenant organization not found.");
    if (!tenant.isActive) throw new ApiError(403, "Account inactive. Your brand account has been deactivated by administration. Please contact support.");

    let subscriptionPaused = Boolean(tenant.subscriptionPaused);
    try {
      const pauseRows = await mainPrisma.$queryRawUnsafe(
        'SELECT "subscriptionPaused" FROM "Tenant" WHERE "id" = $1 LIMIT 1',
        tenant.id
      );
      if (Array.isArray(pauseRows) && pauseRows[0] && pauseRows[0].subscriptionPaused !== undefined) {
        subscriptionPaused = Boolean(pauseRows[0].subscriptionPaused);
      }
    } catch {
      // Ignore fallback
    }
    tenant.subscriptionPaused = subscriptionPaused;

    const tenantDb = getTenantClient(tenant.dbUrl);
    const user = await tenantDb.user.findUnique({
      where: { id: decoded.sub },
      include: { branch: true, warehouse: true },
    });
    if (!user) throw new ApiError(404, "User account not found.");
    if (user.isActive === false) throw new ApiError(403, "Your account has been deactivated.");

    if (tenant.subscriptionPaused && user.role !== "BRAND_MANAGER") {
      throw new ApiError(403, "Subscription paused. Your brand subscription is currently inactive. Branch Manager and staff login is restricted. Please contact your Brand Administrator.");
    }

    const token = signToken(user.id, "user");
    await attachUserPermissions(tenantDb, user);

    return { token, user, tenant, userType: "tenant_user" };
  }

  throw new ApiError(400, "Unknown user type.");
};

/**
 * Resend Email Login OTP.
 */
const resendLoginOtp = async ({ tempToken }) => {
  if (!tempToken) {
    throw new ApiError(400, "Verification session token is required.");
  }

  let decoded;
  try {
    decoded = jwt.verify(tempToken, config.jwt.secret);
  } catch (err) {
    throw new ApiError(400, "Verification session expired. Please sign in again.");
  }

  if (decoded.purpose !== "login_otp") {
    throw new ApiError(400, "Invalid token purpose.");
  }

  let name = "";
  if (decoded.userType === "super_admin") {
    const admin = await mainPrisma.superAdmin.findUnique({ where: { id: decoded.sub } });
    if (admin) name = admin.name;
  } else if (decoded.userType === "tenant_user" && decoded.tenantId) {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: decoded.tenantId } });
    if (tenant) {
      const tenantDb = getTenantClient(tenant.dbUrl);
      const user = await tenantDb.user.findUnique({ where: { id: decoded.sub } });
      if (user) name = user.name;
    }
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await mainPrisma.otp.create({
    data: {
      phone: `email:${decoded.email.toLowerCase()}`,
      code,
      expiresAt,
    },
  });

  await sendLoginOtpEmail({
    to: decoded.email,
    name,
    code,
  });

  return {
    success: true,
    message: "A new verification code has been sent to your email.",
  };
};

module.exports = { sendOtp, verifyOtp, loginWithEmail, superAdminLogin, kdsLogin, kdsLogout, posLogout, deviceLogout, requestPasswordReset, verifyResetToken, resetPassword, verifyLoginOtp, resendLoginOtp };
