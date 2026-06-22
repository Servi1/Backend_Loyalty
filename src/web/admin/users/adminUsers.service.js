const mainPrisma = require("../../../config/prisma");
const bcrypt = require("bcryptjs");
const ApiError = require("../../../utils/ApiError");

const getAll = async () => {
  return mainPrisma.superAdmin.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (data) => {
  const existing = await mainPrisma.superAdmin.findUnique({
    where: { email: data.email }
  });
  if (existing) {
    throw new ApiError(400, "Email is already registered");
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);

  return mainPrisma.superAdmin.create({
    data: {
      name: data.name,
      email: data.email,
      password: hashedPassword,
      role: data.role || "super_admin",
      status: data.status || "active"
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true
    }
  });
};

const update = async (id, data) => {
  const existing = await mainPrisma.superAdmin.findUnique({
    where: { id }
  });
  if (!existing) {
    throw new ApiError(404, "User not found");
  }

  const updateData = {
    name: data.name,
    email: data.email,
    role: data.role,
    status: data.status
  };

  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }

  return mainPrisma.superAdmin.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true
    }
  });
};

const remove = async (id) => {
  const existing = await mainPrisma.superAdmin.findUnique({
    where: { id }
  });
  if (!existing) {
    throw new ApiError(404, "User not found");
  }

  await mainPrisma.superAdmin.delete({
    where: { id }
  });

  return { success: true };
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
