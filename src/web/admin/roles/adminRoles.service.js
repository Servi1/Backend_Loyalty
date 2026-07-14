const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const defaultRoles = [
  {
    id: "admin-role-1",
    name: "Platform Owner",
    level: 1,
    description: "Full platform administrative control, billing, subscriptions, and system settings.",
    color: "Orange",
    permissions: {
      overview: ["view", "create", "update", "delete"],
      tenants: ["view", "create", "update", "delete"],
      orders: ["view", "create", "update", "delete"],
      users: ["view", "create", "update", "delete"],
      roles: ["view", "create", "update", "delete"],
      billing: ["view", "create", "update", "delete"],
      subscriptions: ["view", "create", "update", "delete"],
      loyalty: ["view", "create", "update", "delete"],
      loyaltyCustomers: ["view", "create", "update", "delete"],
      appBrands: ["view", "create", "update", "delete"],
      reports: ["view", "create", "update", "delete"],
      settings: ["view", "create", "update", "delete"],
    },
  },
  {
    id: "admin-role-2",
    name: "Support Representative",
    level: 15,
    description: "Manage tenants, view reports, and configure customer loyalty settings.",
    color: "Blue",
    permissions: {
      overview: ["view"],
      tenants: ["view", "update"],
      orders: ["view"],
      users: ["view"],
      roles: ["view"],
      billing: ["view"],
      subscriptions: ["view"],
      loyalty: ["view", "update"],
      loyaltyCustomers: ["view", "create", "update"],
      appBrands: ["view"],
      reports: ["view"],
      settings: [],
    },
  },
  {
    id: "admin-role-3",
    name: "Financial Auditor",
    level: 30,
    description: "View-only access to platform billing, invoices, and subscription plans.",
    color: "Green",
    permissions: {
      overview: ["view"],
      tenants: ["view"],
      orders: [],
      users: [],
      roles: [],
      billing: ["view"],
      subscriptions: ["view"],
      loyalty: [],
      loyaltyCustomers: [],
      appBrands: [],
      reports: ["view"],
      settings: [],
    },
  },
];

const seedDefaultRolesIfEmpty = async () => {
  const count = await mainPrisma.superAdminRole.count();
  if (count === 0) {
    console.log("Seeding default Super Admin roles...");
    for (const r of defaultRoles) {
      await mainPrisma.superAdminRole.create({ data: r });
    }
  }
};

const getAll = async () => {
  await seedDefaultRolesIfEmpty();
  return mainPrisma.superAdminRole.findMany({
    orderBy: { level: "asc" }
  });
};

const getById = async (id) => {
  await seedDefaultRolesIfEmpty();
  const role = await mainPrisma.superAdminRole.findUnique({ where: { id } });
  if (!role) throw new ApiError(404, "Role not found");
  return role;
};

const create = async (data) => {
  const existing = await mainPrisma.superAdminRole.findUnique({
    where: { name: data.name }
  });
  if (existing) {
    throw new ApiError(400, "Role name already exists");
  }

  return mainPrisma.superAdminRole.create({
    data: {
      name: data.name,
      level: data.level || 50,
      description: data.description,
      color: data.color || "Orange",
      permissions: data.permissions || {}
    }
  });
};

const update = async (id, data) => {
  const existing = await mainPrisma.superAdminRole.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Role not found");

  return mainPrisma.superAdminRole.update({
    where: { id },
    data: {
      name: data.name,
      level: data.level,
      description: data.description,
      color: data.color,
      permissions: data.permissions
    }
  });
};

const remove = async (id) => {
  const existing = await mainPrisma.superAdminRole.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Role not found");

  if (id === "admin-role-1" || id === "admin-role-2" || id === "admin-role-3") {
    throw new ApiError(400, "System default roles cannot be deleted");
  }

  await mainPrisma.superAdminRole.delete({ where: { id } });
  return { success: true };
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};
