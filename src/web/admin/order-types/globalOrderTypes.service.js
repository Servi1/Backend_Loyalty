const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const defaultOrderTypes = ["Dine In", "Takeaway", "Delivery", "Deliver to Car", "Scheduled"];

const seedDefaultOrderTypesIfEmpty = async () => {
  const count = await mainPrisma.globalOrderType.count();
  if (count === 0) {
    console.log("Seeding default global order types...");
    for (const name of defaultOrderTypes) {
      await mainPrisma.globalOrderType.create({ data: { name, isActive: true } });
    }
  }
};

const getAll = async () => {
  await seedDefaultOrderTypesIfEmpty();
  return mainPrisma.globalOrderType.findMany({
    orderBy: { createdAt: "asc" }
  });
};

const create = async (data) => {
  if (!data.name) {
    throw new ApiError(400, "Order Type name is required");
  }
  const existing = await mainPrisma.globalOrderType.findUnique({
    where: { name: data.name }
  });
  if (existing) {
    throw new ApiError(400, "Order Type name already exists");
  }
  return mainPrisma.globalOrderType.create({
    data: {
      name: data.name,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true
    }
  });
};

const update = async (id, data) => {
  const existing = await mainPrisma.globalOrderType.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Order Type not found");
  }
  
  if (data.name) {
    const nameCheck = await mainPrisma.globalOrderType.findUnique({
      where: { name: data.name }
    });
    if (nameCheck && nameCheck.id !== id) {
      throw new ApiError(400, "Order Type name already exists");
    }
  }

  return mainPrisma.globalOrderType.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : existing.name,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : existing.isActive
    }
  });
};

const remove = async (id) => {
  const existing = await mainPrisma.globalOrderType.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Order Type not found");
  }
  await mainPrisma.globalOrderType.delete({ where: { id } });
  return { success: true };
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
