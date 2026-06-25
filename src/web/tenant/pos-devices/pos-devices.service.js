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

const getAll = async (db, branchId) => {
  const where = {};
  if (branchId && branchId !== "all") {
    where.branchId = branchId;
  }

  // Auto-inactivate POS devices that expired > 7 days ago
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const expiredActiveDevices = await db.posDevice.findMany({
    where: {
      isActive: true,
      expiresAt: {
        lt: sevenDaysAgo
      }
    }
  });

  if (expiredActiveDevices.length > 0) {
    await db.posDevice.updateMany({
      where: {
        id: {
          in: expiredActiveDevices.map(p => p.id)
        }
      },
      data: {
        isActive: false
      }
    });
  }

  return db.posDevice.findMany({
    where,
    include: {
      branch: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (db, data, cycle) => {
  const branch = await db.branch.findUnique({ where: { id: data.branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");

  // Generate unique 8-digit random number
  let deviceKey = "";
  let isUnique = false;
  while (!isUnique) {
    deviceKey = Math.floor(10000000 + Math.random() * 90000000).toString();
    const existing = await db.posDevice.findUnique({ where: { deviceKey } });
    if (!existing) {
      isUnique = true;
    }
  }

  const expiresAt = getExpirationDate(cycle);

  return db.posDevice.create({
    data: {
      name: data.name,
      deviceKey,
      isActive: data.isActive !== undefined ? data.isActive : true,
      branchId: data.branchId,
      expiresAt
    },
    include: {
      branch: true
    }
  });
};

const renew = async (db, id, cycle) => {
  const device = await db.posDevice.findUnique({ where: { id } });
  if (!device) throw new ApiError(404, "POS Device not found");

  const expiresAt = getExpirationDate(cycle, device.expiresAt);

  return db.posDevice.update({
    where: { id },
    data: {
      expiresAt,
      isActive: true
    },
    include: {
      branch: true
    }
  });
};

const update = async (db, id, data) => {
  const device = await db.posDevice.findUnique({ where: { id } });
  if (!device) throw new ApiError(404, "POS Device not found");

  return db.posDevice.update({
    where: { id },
    data,
    include: {
      branch: true
    }
  });
};

const remove = async (db, id) => {
  const device = await db.posDevice.findUnique({ where: { id } });
  if (!device) throw new ApiError(404, "POS Device not found");
  return db.posDevice.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  renew,
  update,
  remove,
};
