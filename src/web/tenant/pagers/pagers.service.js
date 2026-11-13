const ApiError = require("../../../utils/ApiError");
const mainPrisma = require("../../../config/prisma");
const { getTenantClient } = require("../../../config/tenantManager");
const { sendOrderReadySms, formatForOurSms } = require("../../../services/oursms.service");
const crypto = require("crypto");

/**
 * Ensures all Pager tables, columns, and indexes exist in the databases.
 */
const ensureTables = async (db, mainClient = mainPrisma) => {
  // 1. Main database columns
  try {
    await mainClient.$executeRawUnsafe('ALTER TABLE "AppUser" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN DEFAULT true');
    await mainClient.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "subPager" BOOLEAN DEFAULT true');
    await mainClient.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pagerQuantity" INTEGER DEFAULT 5');
    await mainClient.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pricePager" DOUBLE PRECISION DEFAULT 19.0');
    await mainClient.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "cyclePager" TEXT DEFAULT \'monthly\'');
    await mainClient.$executeRawUnsafe('ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "feePager" DOUBLE PRECISION DEFAULT 0.0');
  } catch (err) {
    // Non-fatal if already exist
  }

  // 2. Tenant database tables and columns
  if (db) {
    try {
      await db.$executeRawUnsafe('ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "pagerEnabled" BOOLEAN DEFAULT true');
      await db.$executeRawUnsafe('ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "pagerSubscribedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP');

      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PagerDevice" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "nameAr" TEXT,
          "deviceKey" TEXT UNIQUE NOT NULL,
          "isActive" BOOLEAN DEFAULT true,
          "isOnline" BOOLEAN DEFAULT false,
          "lastSeenAt" TIMESTAMP(3),
          "branchId" TEXT NOT NULL,
          "expiresAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PagerTicket" (
          "id" TEXT PRIMARY KEY,
          "pagerId" TEXT NOT NULL,
          "branchId" TEXT NOT NULL,
          "phone" TEXT NOT NULL,
          "countryCode" TEXT DEFAULT '+966',
          "rawPhone" TEXT,
          "appUserId" TEXT,
          "orderNumber" TEXT,
          "status" TEXT NOT NULL DEFAULT 'WAITING',
          "waitingAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
          "preparingAt" TIMESTAMP(3),
          "readyAt" TIMESTAMP(3),
          "completedAt" TIMESTAMP(3),
          "cancelledAt" TIMESTAMP(3),
          "cancelReason" TEXT,
          "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_pagerticket_pager" ON "PagerTicket"("pagerId")');
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_pagerticket_branch" ON "PagerTicket"("branchId")');
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_pagerticket_status" ON "PagerTicket"("status")');
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "idx_pagerticket_phone" ON "PagerTicket"("phone")');
    } catch (err) {
      // Non-fatal if tables exist
    }
  }
};

const getExpirationDate = (cycle, currentExpiresAt) => {
  const baseDate = (currentExpiresAt && new Date(currentExpiresAt) > new Date())
    ? new Date(currentExpiresAt)
    : new Date();

  if (cycle === "yearly") {
    baseDate.setFullYear(baseDate.getFullYear() + 1);
  } else {
    baseDate.setDate(baseDate.getDate() + 30);
  }
  return baseDate;
};

/**
 * Normalize phone number into standard international E.164.
 * Defaults to Saudi Arabia (+966).
 */
function normalizePhoneNumber(phone, countryCode = "+966") {
  if (!phone) return "";
  let raw = String(phone).trim();
  let code = String(countryCode || "+966").trim();
  if (!code.startsWith("+")) code = "+" + code;

  // Extract digits only
  let digits = raw.replace(/\D/g, "");

  // If Saudi Arabia
  if (code === "+966") {
    if (digits.startsWith("00966")) {
      digits = digits.slice(5);
    } else if (digits.startsWith("966")) {
      digits = digits.slice(3);
    } else if (digits.startsWith("0")) {
      digits = digits.slice(1);
    }
    return "+966" + digits;
  }

  // Other country codes
  const codeDigits = code.replace(/\D/g, "");
  if (digits.startsWith(codeDigits)) {
    return "+" + digits;
  }
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return code + digits;
}

/**
 * Get all pagers for a tenant, optionally filtered by branch.
 */
const getAll = async (db, branchId) => {
  await ensureTables(db);
  const where = {};
  if (branchId && branchId !== "all") {
    where.branchId = branchId;
  }

  let pagers = [];
  if (where.branchId) {
    pagers = await db.$queryRawUnsafe(`
      SELECT p.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
      FROM "PagerDevice" p
      LEFT JOIN "Branch" b ON p."branchId" = b.id
      WHERE p."branchId" = $1
      ORDER BY p."createdAt" DESC
    `, where.branchId).catch(() => []);
  } else {
    pagers = await db.$queryRawUnsafe(`
      SELECT p.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
      FROM "PagerDevice" p
      LEFT JOIN "Branch" b ON p."branchId" = b.id
      ORDER BY p."createdAt" DESC
    `).catch(() => []);
  }

  if (pagers.length === 0) return pagers;

  // Hydrate active queue counts per pager
  const pagerIds = pagers.map((p) => p.id);
  const countsRows = await db.$queryRawUnsafe(`
    SELECT "pagerId", "status", COUNT(*)::int as count
    FROM "PagerTicket"
    WHERE "pagerId" = ANY($1)
      AND "status" IN ('WAITING', 'PREPARING', 'READY')
    GROUP BY "pagerId", "status"
  `, pagerIds).catch(() => []);

  const countsMap = new Map();
  for (const row of countsRows) {
    if (!countsMap.has(row.pagerId)) {
      countsMap.set(row.pagerId, { waiting: 0, preparing: 0, ready: 0, totalActive: 0 });
    }
    const current = countsMap.get(row.pagerId);
    const statusKey = String(row.status).toLowerCase();
    if (current[statusKey] !== undefined) {
      current[statusKey] = row.count;
    }
    current.totalActive += row.count;
  }

  return pagers.map((p) => ({
    ...p,
    isOnline: Boolean(p.isOnline),
    queueCounts: countsMap.get(p.id) || { waiting: 0, preparing: 0, ready: 0, totalActive: 0 },
  }));
};

/**
 * Get a single pager by ID.
 */
const getById = async (db, id) => {
  await ensureTables(db);
  const rows = await db.$queryRawUnsafe(`
    SELECT p.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr", 'isOpen', b."isOpen") as branch
    FROM "PagerDevice" p
    LEFT JOIN "Branch" b ON p."branchId" = b.id
    WHERE p."id" = $1
    LIMIT 1
  `, id).catch(() => []);

  if (!rows || rows.length === 0) {
    throw new ApiError(404, "Pager device not found");
  }
  return rows[0];
};

/**
 * Create a new Pager device.
 */
const create = async (db, tenant, data) => {
  await ensureTables(db);

  if (tenant?.subPager === false) {
    throw new ApiError(403, "Pager feature is deactivated for your subscription.");
  }

  const limit = tenant.pagerQuantity !== undefined && tenant.pagerQuantity !== null ? Number(tenant.pagerQuantity) : 5;
  if (limit > 0) {
    const countRows = await db.$queryRawUnsafe('SELECT COUNT(*)::int as count FROM "PagerDevice"');
    const currentCount = countRows[0]?.count || 0;
    if (currentCount >= limit) {
      throw new ApiError(400, `You have reached the maximum limit of ${limit} Pager device(s) for your subscription. Please purchase additional licenses in Market.`);
    }
  }

  const branch = await db.branch.findUnique({ where: { id: data.branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");
  if (branch.pagerEnabled === false) {
    throw new ApiError(400, "Pager feature is deactivated for this branch.");
  }

  // Generate unique 8-digit deviceKey
  let deviceKey = "";
  let isUnique = false;
  while (!isUnique) {
    deviceKey = Math.floor(10000000 + Math.random() * 90000000).toString();
    const existing = await db.$queryRawUnsafe('SELECT id FROM "PagerDevice" WHERE "deviceKey" = $1', deviceKey).catch(() => []);
    if (existing.length === 0) isUnique = true;
  }

  const expiresAt = getExpirationDate(tenant.cyclePager);
  const id = crypto.randomUUID();
  const isActive = data.isActive !== undefined ? Boolean(data.isActive) : true;

  await db.$executeRawUnsafe(`
    INSERT INTO "PagerDevice" ("id", "name", "nameAr", "deviceKey", "isActive", "branchId", "expiresAt", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
  `, id, data.name.trim(), data.nameAr ? data.nameAr.trim() : null, deviceKey, isActive, data.branchId, expiresAt);

  return {
    id,
    name: data.name.trim(),
    nameAr: data.nameAr ? data.nameAr.trim() : null,
    deviceKey,
    isActive,
    isOnline: false,
    lastSeenAt: null,
    branchId: data.branchId,
    expiresAt,
    branch: { id: branch.id, name: branch.name, nameAr: branch.nameAr },
  };
};

/**
 * Renew pager device license.
 */
const renew = async (db, id, cycle) => {
  await ensureTables(db);
  const pager = await getById(db, id);
  const expiresAt = getExpirationDate(cycle, pager.expiresAt);

  await db.$executeRawUnsafe(`
    UPDATE "PagerDevice"
    SET "expiresAt" = $1, "isActive" = true, "updatedAt" = NOW()
    WHERE "id" = $2
  `, expiresAt, id);

  return { ...pager, expiresAt, isActive: true };
};

/**
 * Update pager device.
 */
const update = async (db, id, data) => {
  await ensureTables(db);
  const pager = await getById(db, id);

  const updates = [];
  const params = [];
  let paramIdx = 1;

  if (data.name !== undefined) {
    updates.push(`"name" = $${paramIdx++}`);
    params.push(data.name.trim());
  }
  if (data.nameAr !== undefined) {
    updates.push(`"nameAr" = $${paramIdx++}`);
    params.push(data.nameAr ? data.nameAr.trim() : null);
  }
  if (data.isActive !== undefined) {
    updates.push(`"isActive" = $${paramIdx++}`);
    params.push(Boolean(data.isActive));
  }
  if (data.branchId !== undefined) {
    const branch = await db.branch.findUnique({ where: { id: data.branchId } });
    if (!branch) throw new ApiError(404, "Branch not found");
    updates.push(`"branchId" = $${paramIdx++}`);
    params.push(data.branchId);
  }

  if (updates.length > 0) {
    updates.push(`"updatedAt" = NOW()`);
    params.push(id);
    await db.$executeRawUnsafe(`
      UPDATE "PagerDevice"
      SET ${updates.join(", ")}
      WHERE "id" = $${paramIdx}
    `, ...params);
  }

  return getById(db, id);
};

/**
 * Get tickets queue for a pager.
 */
const getTickets = async (db, pagerId, filter = "active") => {
  await ensureTables(db);

  let statusClause = "";
  if (filter === "active") {
    statusClause = `AND "status" IN ('WAITING', 'PREPARING', 'READY')`;
  } else if (filter && filter !== "all") {
    statusClause = `AND "status" = '${filter.toUpperCase()}'`;
  }

  const rows = await db.$queryRawUnsafe(`
    SELECT t.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
    FROM "PagerTicket" t
    LEFT JOIN "Branch" b ON t."branchId" = b.id
    WHERE t."pagerId" = $1 ${statusClause}
    ORDER BY 
      CASE t."status"
        WHEN 'WAITING' THEN 1
        WHEN 'PREPARING' THEN 2
        WHEN 'READY' THEN 3
        ELSE 4
      END ASC,
      t."waitingAt" ASC
  `, pagerId).catch(() => []);

  return rows;
};

/**
 * Update ticket status with strict server-side transition validation.
 */
const updateTicketStatus = async (db, mainClient, pagerId, ticketId, body, tenant, io) => {
  await ensureTables(db, mainClient);

  const rows = await db.$queryRawUnsafe(`
    SELECT t.*, b.name as "branchName", b."nameAr" as "branchNameAr"
    FROM "PagerTicket" t
    LEFT JOIN "Branch" b ON t."branchId" = b.id
    WHERE t."id" = $1 AND t."pagerId" = $2
    LIMIT 1
  `, ticketId, pagerId);

  if (!rows || rows.length === 0) {
    throw new ApiError(404, "Ticket not found for this pager");
  }

  const ticket = rows[0];
  const targetStatus = String(body.status || "").toUpperCase();

  // Validate Allowed Transitions:
  // WAITING -> PREPARING (requires orderNumber) or CANCELLED
  // PREPARING -> READY or CANCELLED
  // READY -> COLLECTED or CANCELLED
  if (ticket.status === "COLLECTED" || ticket.status === "CANCELLED") {
    throw new ApiError(400, "Ticket is already completed or cancelled and cannot be changed.");
  }

  if (targetStatus === "PREPARING") {
    if (ticket.status !== "WAITING") {
      throw new ApiError(400, `Cannot move to PREPARING from current status "${ticket.status}".`);
    }
    const orderNum = body.orderNumber ? String(body.orderNumber).trim() : null;
    if (!orderNum) {
      throw new ApiError(400, "Order number is required to move ticket to Preparing.");
    }

    await db.$executeRawUnsafe(`
      UPDATE "PagerTicket"
      SET "status" = 'PREPARING', "orderNumber" = $1, "preparingAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = $2
    `, orderNum, ticketId);
  } else if (targetStatus === "READY") {
    if (ticket.status !== "PREPARING") {
      throw new ApiError(400, `Cannot move to READY from current status "${ticket.status}". Ticket must be in PREPARING status first.`);
    }

    await db.$executeRawUnsafe(`
      UPDATE "PagerTicket"
      SET "status" = 'READY', "readyAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = $1
    `, ticketId);

    // Send SMS Notification to customer phone
    try {
      await sendOrderReadySms(ticket.phone, ticket.orderNumber, tenant.name, ticket.branchName);
    } catch (smsErr) {
      console.warn("[PAGER SMS NOTICE]", smsErr.message);
    }
  } else if (targetStatus === "COLLECTED") {
    if (ticket.status !== "READY") {
      throw new ApiError(400, `Cannot mark COLLECTED from current status "${ticket.status}". Ticket must be READY first.`);
    }

    await db.$executeRawUnsafe(`
      UPDATE "PagerTicket"
      SET "status" = 'COLLECTED', "completedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = $1
    `, ticketId);
  } else if (targetStatus === "CANCELLED") {
    const reason = body.cancelReason ? String(body.cancelReason).trim() : "Cancelled by staff";
    await db.$executeRawUnsafe(`
      UPDATE "PagerTicket"
      SET "status" = 'CANCELLED', "cancelledAt" = NOW(), "cancelReason" = $1, "updatedAt" = NOW()
      WHERE "id" = $2
    `, reason, ticketId);
  } else {
    throw new ApiError(400, `Invalid status transition: "${targetStatus}".`);
  }

  // Fetch updated ticket
  const updatedRows = await db.$queryRawUnsafe(`
    SELECT t.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
    FROM "PagerTicket" t
    LEFT JOIN "Branch" b ON t."branchId" = b.id
    WHERE t."id" = $1
    LIMIT 1
  `, ticketId);
  const updated = updatedRows[0];

  // Emit Socket.IO live events
  if (io) {
    // 1. Direct customer room
    io.to(`pager-ticket:${ticketId}`).emit("pager:ticket_updated", updated);
    // 2. Location Pager room (for Brand Admin)
    io.to(`pager:${pagerId}`).emit("pager:ticket_updated", updated);
    // 3. Branch room
    io.to(`branch:${ticket.branchId}`).emit("pager:ticket_updated", updated);
    // 4. Tenant room
    if (tenant?.id) {
      io.to(`tenant:${tenant.id}`).emit("pager:ticket_updated", updated);
    }
  }

  return updated;
};

/**
 * Get active branch orders for staff to pick from when assigning order number.
 */
const getBranchActiveOrders = async (db, branchId) => {
  await ensureTables(db);
  const orders = await db.order.findMany({
    where: {
      branchId,
      status: {
        in: ["PENDING", "PREPARING", "ACCEPTED"]
      }
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customerName: true,
      customerPhone: true,
      total: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20
  }).catch(() => []);

  return orders;
};

// ─── PUBLIC CUSTOMER ENDPOINTS LOGIC ──────────────────────────────────────

/**
 * Find pager and associated tenant by pagerId.
 */
const findPagerAndTenant = async (pagerId, mainClient = mainPrisma) => {
  const tenants = await mainClient.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, logoUrl: true, dbUrl: true, bannerUrl: true }
  });

  for (const tenant of tenants) {
    try {
      const tdb = getTenantClient(tenant.dbUrl);
      await ensureTables(tdb, mainClient);
      const rows = await tdb.$queryRawUnsafe(`
        SELECT p.*, b.name as "branchName", b."nameAr" as "branchNameAr", b.address as "branchAddress", b.city as "branchCity"
        FROM "PagerDevice" p
        LEFT JOIN "Branch" b ON p."branchId" = b.id
        WHERE p."id" = $1
        LIMIT 1
      `, pagerId).catch(() => []);

      if (rows && rows.length > 0) {
        return {
          pager: rows[0],
          tenant,
          tenantDb: tdb
        };
      }
    } catch {
      // Continue to next tenant
    }
  }

  throw new ApiError(404, "Pager not found or invalid QR code.");
};

/**
 * Get public pager details for customer landing page.
 */
const getPublicPagerInfo = async (pagerId) => {
  const { pager, tenant } = await findPagerAndTenant(pagerId);

  return {
    pagerId: pager.id,
    pagerName: pager.name,
    pagerNameAr: pager.nameAr,
    isActive: Boolean(pager.isActive),
    brand: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      bannerUrl: tenant.bannerUrl,
    },
    branch: {
      id: pager.branchId,
      name: pager.branchName,
      nameAr: pager.branchNameAr,
      address: pager.branchAddress,
      city: pager.branchCity,
    }
  };
};

/**
 * Public join action: Customer submits phone number to join queue.
 */
const submitCustomerTicket = async (pagerId, body, mainClient = mainPrisma, io) => {
  const { pager, tenant, tenantDb } = await findPagerAndTenant(pagerId, mainClient);

  if (!pager.isActive) {
    throw new ApiError(400, "This pager is currently inactive. Please speak with the counter staff.");
  }

  const rawPhone = String(body.phone || "").trim();
  const countryCode = String(body.countryCode || "+966").trim();

  if (!rawPhone) {
    throw new ApiError(400, "Phone number is required.");
  }

  const normalizedPhone = normalizePhoneNumber(rawPhone, countryCode);
  if (!normalizedPhone || normalizedPhone.length < 9) {
    throw new ApiError(400, "Please provide a valid mobile phone number.");
  }

  // Check / Link Servi Account (AppUser)
  // Normalizes the number, checks whether a Servi account already exists for it,
  // and links the ticket to that account if so, or creates a new phone-only Servi account
  // marked as unverified so it can be claimed/verified later.
  let appUser = await mainClient.appUser.findFirst({
    where: {
      OR: [
        { phone: normalizedPhone },
        { phone: normalizedPhone.replace("+", "") },
        { phone: rawPhone.replace(/\D/g, "") },
      ]
    }
  });

  if (!appUser) {
    try {
      appUser = await mainClient.appUser.create({
        data: {
          phone: normalizedPhone,
        }
      });
      // Explicitly mark as unverified so it can be claimed/verified later
      await mainClient.$executeRawUnsafe(
        'UPDATE "AppUser" SET "isVerified" = false WHERE "id" = $1',
        appUser.id
      ).catch(() => null);
    } catch {
      // In case of concurrent creation
      appUser = await mainClient.appUser.findFirst({ where: { phone: normalizedPhone } });
    }

    if (appUser) {
      await mainClient.wallet.create({
        data: {
          appUserId: appUser.id,
          points: 0,
          lifetimeEarn: 0
        }
      }).catch(() => null);
    }
  }

  // Check if customer already has an active ticket for this pager
  const existingActive = await tenantDb.$queryRawUnsafe(`
    SELECT t.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
    FROM "PagerTicket" t
    LEFT JOIN "Branch" b ON t."branchId" = b.id
    WHERE t."pagerId" = $1
      AND t."phone" = $2
      AND t."status" IN ('WAITING', 'PREPARING', 'READY')
    ORDER BY t."createdAt" DESC
    LIMIT 1
  `, pagerId, normalizedPhone);

  if (existingActive && existingActive.length > 0) {
    return {
      ticket: existingActive[0],
      isExisting: true,
      brand: { id: tenant.id, name: tenant.name, logoUrl: tenant.logoUrl },
    };
  }

  // Create new ticket
  const ticketId = crypto.randomUUID();
  await tenantDb.$executeRawUnsafe(`
    INSERT INTO "PagerTicket" (
      "id", "pagerId", "branchId", "phone", "countryCode", "rawPhone",
      "appUserId", "status", "waitingAt", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, 'WAITING', NOW(), NOW(), NOW()
    )
  `, ticketId, pager.id, pager.branchId, normalizedPhone, countryCode, rawPhone, appUser?.id || null);

  const createdRows = await tenantDb.$queryRawUnsafe(`
    SELECT t.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
    FROM "PagerTicket" t
    LEFT JOIN "Branch" b ON t."branchId" = b.id
    WHERE t."id" = $1
    LIMIT 1
  `, ticketId);
  const createdTicket = createdRows[0];

  // Real-time notification to staff
  if (io) {
    io.to(`pager:${pager.id}`).emit("pager:ticket_created", createdTicket);
    io.to(`branch:${pager.branchId}`).emit("pager:ticket_created", createdTicket);
    io.to(`tenant:${tenant.id}`).emit("pager:ticket_created", createdTicket);
  }

  return {
    ticket: createdTicket,
    isExisting: false,
    brand: { id: tenant.id, name: tenant.name, logoUrl: tenant.logoUrl },
  };
};

/**
 * Get public ticket status by ticketId.
 */
const getPublicTicketStatus = async (ticketId, mainClient = mainPrisma) => {
  const tenants = await mainClient.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, logoUrl: true, dbUrl: true }
  });

  for (const tenant of tenants) {
    try {
      const tdb = getTenantClient(tenant.dbUrl);
      const rows = await tdb.$queryRawUnsafe(`
        SELECT t.*, 
               p.name as "pagerName",
               json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
        FROM "PagerTicket" t
        LEFT JOIN "PagerDevice" p ON t."pagerId" = p.id
        LEFT JOIN "Branch" b ON t."branchId" = b.id
        WHERE t."id" = $1
        LIMIT 1
      `, ticketId).catch(() => []);

      if (rows && rows.length > 0) {
        return {
          ticket: rows[0],
          brand: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            logoUrl: tenant.logoUrl,
          }
        };
      }
    } catch {
      // Continue
    }
  }

  throw new ApiError(404, "Ticket not found");
};

module.exports = {
  ensureTables,
  getAll,
  getById,
  create,
  renew,
  update,
  getTickets,
  updateTicketStatus,
  getBranchActiveOrders,
  getPublicPagerInfo,
  submitCustomerTicket,
  getPublicTicketStatus,
  normalizePhoneNumber,
};
