const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");

const getAll = async () => prisma.tenant.findMany({ include: { _count: { select: { branches: true } } } });

const getById = async (id) => {
  const tenant = await prisma.tenant.findUnique({ where: { id }, include: { branches: true } });
  if (!tenant) throw new ApiError(404, "Tenant not found");
  return tenant;
};

const create = async (data) => prisma.tenant.create({ data });

const update = async (id, data) => {
  await getById(id);
  return prisma.tenant.update({ where: { id }, data });
};

const remove = async (id) => {
  await getById(id);
  return prisma.tenant.delete({ where: { id } });
};

module.exports = { getAll, getById, create, update, remove };
