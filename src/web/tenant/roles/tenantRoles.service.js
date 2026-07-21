const ApiError = require("../../../utils/ApiError");

const defaultBrandRoles = [
  {
    id: "branch-manager",
    name: "Store Manager",
    level: 20,
    description: "Manage daily branch operations, staff, and view analytics reports.",
    color: "Blue",
    permissions: {
      overview: ["view"],
      orders: ["view", "update"],
      menu: ["view", "update_item"],
      branches: ["view", "manage_tables"],
      staff: ["view", "create", "update"],
      reports: ["view"],
    },
  },
  {
    id: "cashier",
    name: "Cashier",
    level: 50,
    description: "Process customer transactions, view menu, and handle orders.",
    color: "Green",
    permissions: {
      overview: ["view"],
      orders: ["view", "create", "update"],
      menu: ["view"],
      branches: ["view"],
      staff: [],
      reports: ["view"],
    },
  },
  {
    id: "waiter",
    name: "Waiter",
    level: 60,
    description: "Take customer orders, view menu items, and manage table service.",
    color: "Orange",
    permissions: {
      overview: ["view"],
      orders: ["view", "create"],
      menu: ["view"],
      branches: [],
      staff: [],
      roles: [],
      design: [],
      reports: [],
    },
  },
  {
    id: "kitchen",
    name: "Kitchen Staff",
    level: 70,
    description: "View incoming orders, update order preparation status.",
    color: "Indigo",
    permissions: {
      overview: ["view"],
      orders: ["view", "update"],
      menu: ["view"],
      branches: [],
      staff: [],
      roles: [],
      design: [],
      reports: [],
    },
  },
  {
    id: "warehouse-manager",
    name: "Warehouse Manager",
    level: 30,
    description: "Manage product requests, warehouse inventory, and replenishment operations.",
    color: "Purple",
    permissions: {
      productRequests: ["view", "update"],
      inventory: ["view", "update"],
    },
  },
];

const seedDefaultTenantRolesIfEmpty = async (db) => {
  for (const r of defaultBrandRoles) {
    const existing = await db.customRole.findUnique({ where: { id: r.id } });
    if (!existing) {
      console.log(`Seeding missing default Tenant role: ${r.name}...`);
      await db.customRole.create({ data: r });
    } else if (r.id === "warehouse-manager") {
      await db.customRole.update({
        where: { id: r.id },
        data: { permissions: r.permissions }
      });
    }
  }
};

const getAll = async (db) => {
  await seedDefaultTenantRolesIfEmpty(db);
  return db.customRole.findMany({
    orderBy: { level: "asc" }
  });
};

const getById = async (db, id) => {
  await seedDefaultTenantRolesIfEmpty(db);
  const role = await db.customRole.findUnique({ where: { id } });
  if (!role) throw new ApiError(404, "Role not found");
  return role;
};

const create = async (db, data) => {
  const existing = await db.customRole.findUnique({
    where: { name: data.name }
  });
  if (existing) {
    throw new ApiError(400, "Role name already exists");
  }

  return db.customRole.create({
    data: {
      name: data.name,
      level: data.level || 50,
      description: data.description,
      color: data.color || "Orange",
      permissions: data.permissions || {}
    }
  });
};

const update = async (db, id, data) => {
  const existing = await db.customRole.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Role not found");

  return db.customRole.update({
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

const remove = async (db, id) => {
  const existing = await db.customRole.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Role not found");

  if (id === "branch-manager" || id === "cashier" || id === "waiter" || id === "kitchen" || id === "warehouse-manager") {
    throw new ApiError(400, "System default roles cannot be deleted");
  }

  await db.customRole.delete({ where: { id } });
  return { success: true };
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};
