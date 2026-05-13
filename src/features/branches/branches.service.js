const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");

const getByTenant = async (tenantId) =>
  prisma.branch.findMany({ where: { tenantId }, include: { _count: { select: { tables: true, orders: true } } } });

const getById = async (id) => {
  const branch = await prisma.branch.findUnique({ where: { id }, include: { tables: true } });
  if (!branch) throw new ApiError(404, "Branch not found");
  return branch;
};

const create = async (data) => prisma.branch.create({ data });

const update = async (id, data) => {
  await getById(id);
  return prisma.branch.update({ where: { id }, data });
};

const remove = async (id) => {
  await getById(id);
  return prisma.branch.delete({ where: { id } });
};

module.exports = { getByTenant, getById, create, update, remove };
