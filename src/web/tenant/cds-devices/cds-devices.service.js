const ApiError = require("../../../utils/ApiError");

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

const ensureTable = async (db) => {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CdsDevice" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "nameAr" TEXT,
      "deviceKey" TEXT UNIQUE NOT NULL,
      "isActive" BOOLEAN DEFAULT true,
      "branchId" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
    );
  `).catch(() => null);
};

const getAll = async (db, branchId) => {
  await ensureTable(db);
  const where = {};
  if (branchId && branchId !== "all") {
    where.branchId = branchId;
  }

  // Auto-inactivate CDS devices that expired > 7 days ago
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (db.cdsDevice) {
    const expiredActiveDevices = await db.cdsDevice.findMany({
      where: {
        isActive: true,
        expiresAt: { lt: sevenDaysAgo }
      }
    }).catch(() => []);

    if (expiredActiveDevices.length > 0) {
      await db.cdsDevice.updateMany({
        where: { id: { in: expiredActiveDevices.map(k => k.id) } },
        data: { isActive: false }
      }).catch(() => null);
    }

    return db.cdsDevice.findMany({
      where,
      include: { branch: true },
      orderBy: { createdAt: "desc" }
    }).catch(() => []);
  }

  // Fallback to raw queries if client not regenerated
  let rows = [];
  if (where.branchId) {
    rows = await db.$queryRawUnsafe(`
      SELECT c.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
      FROM "CdsDevice" c
      LEFT JOIN "Branch" b ON c."branchId" = b.id
      WHERE c."branchId" = $1
      ORDER BY c."createdAt" DESC
    `, where.branchId).catch(() => []);
  } else {
    rows = await db.$queryRawUnsafe(`
      SELECT c.*, json_build_object('id', b.id, 'name', b.name, 'nameAr', b."nameAr") as branch
      FROM "CdsDevice" c
      LEFT JOIN "Branch" b ON c."branchId" = b.id
      ORDER BY c."createdAt" DESC
    `).catch(() => []);
  }
  return rows;
};

const create = async (db, data, cycle) => {
  await ensureTable(db);
  const branch = await db.branch.findUnique({ where: { id: data.branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");

  // Generate unique 8-digit random number
  let deviceKey = "";
  let isUnique = false;
  while (!isUnique) {
    deviceKey = Math.floor(10000000 + Math.random() * 90000000).toString();
    if (db.cdsDevice) {
      const existing = await db.cdsDevice.findUnique({ where: { deviceKey } }).catch(() => null);
      if (!existing) isUnique = true;
    } else {
      const existing = await db.$queryRawUnsafe('SELECT id FROM "CdsDevice" WHERE "deviceKey" = $1', deviceKey).catch(() => []);
      if (existing.length === 0) isUnique = true;
    }
  }

  const expiresAt = getExpirationDate(cycle);

  if (db.cdsDevice) {
    return db.cdsDevice.create({
      data: {
        name: data.name,
        nameAr: data.nameAr || null,
        deviceKey,
        isActive: data.isActive !== undefined ? data.isActive : true,
        branchId: data.branchId,
        expiresAt
      },
      include: { branch: true }
    });
  }

  // Fallback insert
  const crypto = require("crypto");
  const id = crypto.randomUUID();
  const isActive = data.isActive !== undefined ? data.isActive : true;
  await db.$executeRawUnsafe(
    'INSERT INTO "CdsDevice" ("id", "name", "nameAr", "deviceKey", "isActive", "branchId", "expiresAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())',
    id, data.name, data.nameAr || null, deviceKey, isActive, data.branchId, expiresAt
  );

  return {
    id,
    name: data.name,
    nameAr: data.nameAr || null,
    deviceKey,
    isActive,
    branchId: data.branchId,
    expiresAt,
    branch: { id: branch.id, name: branch.name, nameAr: branch.nameAr }
  };
};

const renew = async (db, id, cycle) => {
  await ensureTable(db);
  let device = null;
  if (db.cdsDevice) {
    device = await db.cdsDevice.findUnique({ where: { id } }).catch(() => null);
  } else {
    const rows = await db.$queryRawUnsafe('SELECT * FROM "CdsDevice" WHERE id = $1', id).catch(() => []);
    device = rows[0] || null;
  }
  if (!device) throw new ApiError(404, "CDS Device not found");

  const expiresAt = getExpirationDate(cycle, device.expiresAt);

  if (db.cdsDevice) {
    return db.cdsDevice.update({
      where: { id },
      data: { expiresAt, isActive: true },
      include: { branch: true }
    });
  }

  await db.$executeRawUnsafe('UPDATE "CdsDevice" SET "expiresAt" = $1, "isActive" = true, "updatedAt" = NOW() WHERE id = $2', expiresAt, id);
  return { ...device, expiresAt, isActive: true };
};

const update = async (db, id, data) => {
  await ensureTable(db);
  let device = null;
  if (db.cdsDevice) {
    device = await db.cdsDevice.findUnique({ where: { id } }).catch(() => null);
  } else {
    const rows = await db.$queryRawUnsafe('SELECT * FROM "CdsDevice" WHERE id = $1', id).catch(() => []);
    device = rows[0] || null;
  }
  if (!device) throw new ApiError(404, "CDS Device not found");

  if (db.cdsDevice) {
    return db.cdsDevice.update({
      where: { id },
      data,
      include: { branch: true }
    });
  }

  const updates = [];
  const params = [];
  let paramIdx = 1;
  if (data.name !== undefined) {
    updates.push(`"name" = $${paramIdx++}`);
    params.push(data.name);
  }
  if (data.nameAr !== undefined) {
    updates.push(`"nameAr" = $${paramIdx++}`);
    params.push(data.nameAr);
  }
  if (data.isActive !== undefined) {
    updates.push(`"isActive" = $${paramIdx++}`);
    params.push(data.isActive);
  }
  if (data.branchId !== undefined) {
    updates.push(`"branchId" = $${paramIdx++}`);
    params.push(data.branchId);
  }
  if (data.expiresAt !== undefined) {
    updates.push(`"expiresAt" = $${paramIdx++}`);
    params.push(data.expiresAt);
  }
  updates.push(`"updatedAt" = NOW()`);
  params.push(id);

  await db.$executeRawUnsafe(`UPDATE "CdsDevice" SET ${updates.join(", ")} WHERE id = $${paramIdx}`, ...params);
  return { ...device, ...data };
};

const remove = async (db, id) => {
  await ensureTable(db);
  if (db.cdsDevice) {
    return db.cdsDevice.delete({ where: { id } });
  }
  return db.$executeRawUnsafe('DELETE FROM "CdsDevice" WHERE id = $1', id);
};

module.exports = {
  getAll,
  create,
  renew,
  update,
  remove,
};
