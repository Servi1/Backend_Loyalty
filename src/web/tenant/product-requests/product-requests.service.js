const ApiError = require("../../../utils/ApiError");

const getAll = async (db, filters = {}) => {
  const where = {};
  if (filters.branchId) {
    where.branchId = filters.branchId;
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.warehouseId) {
    where.warehouseId = filters.warehouseId;
  }

  return db.productRequest.findMany({
    where,
    include: {
      warehouse: {
        select: {
          id: true,
          name: true,
          location: true
        }
      },
      branch: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (db, data) => {
  if (!data.type || !["Restock", "New product"].includes(data.type)) {
    throw new ApiError(400, "Invalid request type");
  }
  if (!data.details) {
    throw new ApiError(400, "Request details are required");
  }
  if (!data.warehouseId) {
    throw new ApiError(400, "Warehouse target is required");
  }
  if (!data.branchId) {
    throw new ApiError(400, "Branch origin is required");
  }

  // Validate existence
  const warehouse = await db.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new ApiError(404, "Warehouse not found");

  const branch = await db.branch.findUnique({ where: { id: data.branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");

  return db.productRequest.create({
    data: {
      type: data.type,
      details: data.details,
      reason: data.reason || null,
      warehouseId: data.warehouseId,
      branchId: data.branchId,
      status: "Pending"
    },
    include: {
      warehouse: true,
      branch: true
    }
  });
};

const updateStatus = async (db, id, status) => {
  const request = await db.productRequest.findUnique({ where: { id } });
  if (!request) throw new ApiError(404, "Product request not found");

  if (!["Pending", "Approved", "Fulfilled", "Rejected"].includes(status)) {
    throw new ApiError(400, "Invalid status");
  }

  return db.productRequest.update({
    where: { id },
    data: { status },
    include: {
      warehouse: true,
      branch: true
    }
  });
};

const remove = async (db, id) => {
  const request = await db.productRequest.findUnique({ where: { id } });
  if (!request) throw new ApiError(404, "Product request not found");

  return db.productRequest.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  updateStatus,
  remove
};
