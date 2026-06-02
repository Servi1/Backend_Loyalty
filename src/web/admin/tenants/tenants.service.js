const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");
const { Client } = require("pg");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const config = require("../../../config");
const bcrypt = require("bcryptjs");
const { getTenantClient } = require("../../../config/tenantManager");
const { syncToAggregatedCustomer } = require("../../../shared/customers/customers.service");

const getAll = async (filters = {}) => {
  const where = {};
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  const tenants = await mainPrisma.tenant.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });

  const enrichedTenants = [];
  for (const tenant of tenants) {
    let branchesCount = 0;
    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      branchesCount = await tenantPrisma.branch.count();
    } catch (err) {
      console.error(`Failed to get branches count for tenant ${tenant.name}:`, err.message);
    }
    enrichedTenants.push({
      ...tenant,
      _count: {
        branches: branchesCount
      }
    });
  }

  return enrichedTenants;
};

const getById = async (id) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new ApiError(404, "Tenant not found");
  return tenant;
};

const create = async (data) => {
  // 0. Pre-check: Ensure slug is unique before doing heavy database creation
  const existingTenant = await mainPrisma.tenant.findUnique({ where: { slug: data.slug } });
  if (existingTenant) {
    throw new ApiError(400, "A brand with this slug already exists. Please choose a different Company No.");
  }

  // 1. Generate DB name based on slug
  const dbName = `tenant_${data.slug.replace(/[^a-zA-Z0-9]/g, "_")}_db`;
  
  // Extract base connection string from main database URL
  // e.g., postgresql://postgres:root@localhost:5432/servio_main?schema=public
  // becomes postgresql://postgres:root@localhost:5432
  const mainDbUrl = process.env.DATABASE_URL;
  const baseUrl = mainDbUrl.substring(0, mainDbUrl.lastIndexOf("/"));
  const tenantDbUrl = `${baseUrl}/${dbName}?schema=public`;

  // 2. Connect to the default DB to create the new database
  const client = new Client({ connectionString: mainDbUrl });
  
  try {
    await client.connect();
    // In PostgreSQL, CREATE DATABASE cannot run inside a transaction block
    await client.query(`CREATE DATABASE ${dbName}`);
  } catch (err) {
    if (err.code !== "42P04") { // 42P04 = duplicate_database
      throw new ApiError(500, `Failed to create physical database: ${err.message}`);
    }
  } finally {
    await client.end();
  }

  // 3. Push schema to the new database
  try {
    console.log(`Pushing schema to ${dbName}...`);
    // Run prisma db push using the specific schema and injecting the URL
    await execPromise(`npx prisma db push --schema=prisma/schema.tenant.prisma`, {
      env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
    });
  } catch (err) {
    throw new ApiError(500, `Failed to push schema to tenant DB: ${err.message}`);
  }

  // 3.5. Create initial BRAND_MANAGER
  if (data.adminEmail && data.adminPassword) {
    try {
      const tenantPrisma = getTenantClient(tenantDbUrl);
      const hashedPassword = await bcrypt.hash(data.adminPassword, 10);
      const existingUser = await tenantPrisma.user.findUnique({
        where: { email: data.adminEmail }
      });
      if (!existingUser) {
        await tenantPrisma.user.create({
          data: {
            email: data.adminEmail,
            password: hashedPassword,
            name: "Brand Admin",
            role: "BRAND_MANAGER",
          }
        });
      } else {
        await tenantPrisma.user.update({
          where: { email: data.adminEmail },
          data: { password: hashedPassword }
        });
      }
    } catch (err) {
      console.error("Failed to create initial admin user:", err);
    }
  }

  // 4. Save tenant to main registry
  const { adminEmail, adminPassword, ...tenantData } = data;
  const tenant = await mainPrisma.tenant.create({
    data: {
      ...tenantData,
      dbUrl: tenantDbUrl,
    },
  });

  return tenant;
};

const update = async (id, data) => {
  await getById(id);
  return mainPrisma.tenant.update({ where: { id }, data });
};

const remove = async (id) => {
  await getById(id);
  // Optional: drop the database physically, or leave it for safety
  return mainPrisma.tenant.delete({ where: { id } });
};

const getOverview = async () => {
  const tenants = await mainPrisma.tenant.findMany();
  
  let totalOrders = 0;
  let totalRevenue = 0;
  let totalUsers = 0;
  let totalLocations = 0;
  
  const tenantsOverview = [];
  
  for (const tenant of tenants) {
    let ordersCount = 0;
    let revenueSum = 0;
    let locationsCount = 0;
    let usersCount = 0;
    
    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      
      const [oCount, oSum, lCount, uCount] = await Promise.all([
        tenantPrisma.order.count(),
        tenantPrisma.order.aggregate({
          where: { status: "COMPLETED" },
          _sum: { total: true }
        }),
        tenantPrisma.branch.count(),
        tenantPrisma.user.count()
      ]);
      
      ordersCount = oCount;
      revenueSum = oSum._sum.total || 0;
      locationsCount = lCount;
      usersCount = uCount;
    } catch (err) {
      console.error(`Failed to fetch stats for tenant ${tenant.slug}:`, err.message);
    }
    
    totalOrders += ordersCount;
    totalRevenue += revenueSum;
    totalLocations += locationsCount;
    totalUsers += usersCount;
    
    tenantsOverview.push({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan || "free",
      logo: tenant.name.charAt(0),
      ordersThisMonth: ordersCount,
      revenueThisMonth: revenueSum,
      locationsCount: locationsCount,
      status: tenant.isActive ? "active" : "inactive"
    });
  }

  return {
    platformStats: {
      totalOrders,
      totalRevenue,
      activeTenants: tenants.filter(t => t.isActive).length,
      totalUsers
    },
    tenants: tenantsOverview,
    totalLocations
  };
};

const getSubscriptions = async () => {
  const tenants = await mainPrisma.tenant.findMany({
    orderBy: { createdAt: "desc" }
  });

  const subsList = [];
  let totalMRR = 0;
  let expiringSoonCount = 0;

  for (const tenant of tenants) {
    const planName = (tenant.plan || "starter").toLowerCase();
    let amount = 0;
    if (planName === "starter") amount = 99;
    else if (planName === "growth" || planName === "professional") amount = 199;
    else if (planName === "enterprise") amount = 499;

    const startedAt = tenant.createdAt;
    const isYearly = tenant.billingCycle === "yearly";
    const cycleDays = isYearly ? 365 : 30;
    const endsAt = new Date(startedAt.getTime() + cycleDays * 24 * 60 * 60 * 1000);

    // Compute monthly equivalent for MRR
    const monthlyEquivalent = isYearly ? Math.round(amount / 12) : amount;
    if (tenant.isActive) {
      totalMRR += monthlyEquivalent;
    }

    // Check if expiring in 30 days
    const remainingDays = Math.ceil((endsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (tenant.isActive && remainingDays > 0 && remainingDays <= 30) {
      expiringSoonCount++;
    }

    let branchesList = [];
    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      const dbBranches = await tenantPrisma.branch.findMany({
        select: {
          id: true,
          name: true,
          city: true,
          isOpen: true,
          createdAt: true
        }
      });
      branchesList = dbBranches.map(b => ({
        id: b.id,
        name: b.name,
        city: b.city || "Unknown",
        startedAt: b.createdAt,
        endsAt: endsAt,
        status: b.isOpen ? "open" : "closed"
      }));
    } catch (err) {
      console.error(`Failed to fetch branches for tenant ${tenant.slug} sub:`, err.message);
    }

    subsList.push({
      tenantId: tenant.id,
      tenantName: tenant.name,
      logo: tenant.name.charAt(0),
      plan: planName,
      status: tenant.isActive ? "active" : "canceled",
      billingCycle: tenant.billingCycle || "monthly",
      amount: amount,
      startedAt: startedAt,
      endsAt: endsAt,
      branches: branchesList
    });
  }

  return {
    total: tenants.length,
    active: tenants.filter(t => t.isActive).length,
    expiringSoon: expiringSoonCount,
    mrr: totalMRR,
    subscriptions: subsList
  };
};

const getLoyaltyOverview = async (filters = {}) => {
  const where = {};
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  const tenants = await mainPrisma.tenant.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });

  const programs = [];
  let totalMembers = 0;
  let totalRedemptions = 0;

  for (const tenant of tenants) {
    let membersCount = 0;
    let redemptionsCount = 0;

    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);

      const customerWhere = { role: "CUSTOMER" };
      if (filters.startDate || filters.endDate) {
        customerWhere.createdAt = {};
        if (filters.startDate) customerWhere.createdAt.gte = new Date(filters.startDate);
        if (filters.endDate) customerWhere.createdAt.lte = new Date(filters.endDate);
      }

      // Count members: user table where role === 'CUSTOMER'
      membersCount = await tenantPrisma.user.count({
        where: customerWhere
      });

      const txWhere = { points: { lt: 0 } };
      if (filters.startDate || filters.endDate) {
        txWhere.createdAt = {};
        if (filters.startDate) txWhere.createdAt.gte = new Date(filters.startDate);
        if (filters.endDate) txWhere.createdAt.lte = new Date(filters.endDate);
      }

      // Count redemptions: WalletTransaction table where points is negative
      redemptionsCount = await tenantPrisma.walletTransaction.count({
        where: txWhere
      });
    } catch (err) {
      console.error(`Failed to fetch loyalty stats for tenant ${tenant.slug}:`, err.message);
    }

    totalMembers += membersCount;
    totalRedemptions += redemptionsCount;

    programs.push({
      id: tenant.id,
      tenantName: tenant.name,
      slug: tenant.slug,
      enabled: tenant.loyaltyEnabled,
      earnRate: tenant.loyaltyEarnRate,
      redeemRate: tenant.loyaltyRedeemRate,
      membersCount,
      redemptions: redemptionsCount,
      type: "points"
    });
  }

  return {
    totalMembers,
    totalRedemptions,
    programs
  };
};

const getInvoices = async (filters = {}) => {
  const where = {};
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  const tenants = await mainPrisma.tenant.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });

  const invoices = [];

  for (const tenant of tenants) {
    const planName = (tenant.plan || "starter").toLowerCase();
    let amount = 0;
    if (planName === "starter") amount = 99;
    else if (planName === "growth" || planName === "professional") amount = 199;
    else if (planName === "enterprise") amount = 499;

    const startedAt = tenant.createdAt;
    const isYearly = tenant.billingCycle === "yearly";
    const intervalMs = isYearly ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;

    const now = Date.now();
    let cycleStart = startedAt.getTime();
    let periodIndex = 1;

    // Generate invoices for all cycles from signup until now
    while (cycleStart < now) {
      const cycleEnd = cycleStart + intervalMs;
      const startStr = new Date(cycleStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const endStr = new Date(cycleEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      let status = "paid";
      // If it is the current active cycle
      if (now >= cycleStart && now < cycleEnd) {
        if (!tenant.isActive) {
          status = "overdue";
        } else {
          status = "paid";
        }
      }

      const invoiceDate = new Date(cycleStart);
      let match = true;
      if (filters.startDate && invoiceDate < new Date(filters.startDate)) match = false;
      if (filters.endDate && invoiceDate > new Date(filters.endDate)) match = false;

      if (match) {
        invoices.push({
          id: `INV-${tenant.slug.toUpperCase()}-${1000 + periodIndex}`,
          tenantName: tenant.name,
          plan: tenant.plan || "Starter",
          period: `${startStr} - ${endStr}`,
          amount: amount,
          status: status,
          createdAt: new Date(cycleStart)
        });
      }

      cycleStart = cycleEnd;
      periodIndex++;
    }

    // If no invoices were generated (registered in future/edge cases)
    if (invoices.length === 0) {
      const cycleEnd = cycleStart + intervalMs;
      const startStr = new Date(cycleStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const endStr = new Date(cycleEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      
      const invoiceDate = startedAt;
      let match = true;
      if (filters.startDate && invoiceDate < new Date(filters.startDate)) match = false;
      if (filters.endDate && invoiceDate > new Date(filters.endDate)) match = false;

      if (match) {
        invoices.push({
          id: `INV-${tenant.slug.toUpperCase()}-1001`,
          tenantName: tenant.name,
          plan: tenant.plan || "Starter",
          period: `${startStr} - ${endStr}`,
          amount: amount,
          status: tenant.isActive ? "paid" : "overdue",
          createdAt: startedAt
        });
      }
    }
  }

  // Sort invoices by date descending
  invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return invoices;
};

const getSuperAdminOrders = async ({ status, page = 1, limit = 20 }) => {
  const where = {};
  if (status) where.status = status;

  const skip = (page - 1) * limit;
  const [total, orders] = await Promise.all([
    mainPrisma.aggregatedOrder.count({ where }),
    mainPrisma.aggregatedOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { tenant: true }
    })
  ]);

  return {
    total,
    orders,
    page,
    limit
  };
};

const syncAllTenantOrders = async () => {
  console.log("🔄 Starting aggregated orders synchronization...");
  try {
    const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
    let totalSynced = 0;

    for (const tenant of tenants) {
      try {
        const tenantDb = getTenantClient(tenant.dbUrl);
        const orders = await tenantDb.order.findMany({
          include: { user: true, branch: true }
        });

        for (const order of orders) {
          await mainPrisma.aggregatedOrder.upsert({
            where: { id: `${tenant.id}_${order.id}` },
            create: {
              id: `${tenant.id}_${order.id}`,
              tenantId: tenant.id,
              orderId: order.id,
              orderNumber: order.orderNumber,
              status: order.status,
              type: order.type,
              total: order.total,
              notes: order.notes,
              customerName: order.user?.name || order.user?.phone || "Customer Walk-in",
              branchName: order.branch?.name || "Register Terminal",
              createdAt: order.createdAt,
              updatedAt: order.updatedAt,
            },
            update: {
              status: order.status,
              total: order.total,
              notes: order.notes,
              customerName: order.user?.name || order.user?.phone || "Customer Walk-in",
              branchName: order.branch?.name || "Register Terminal",
              updatedAt: order.updatedAt,
            }
          });
          totalSynced++;
        }
      } catch (err) {
        console.error(`Failed to sync orders for tenant ${tenant.name}:`, err.message);
      }
    }
    console.log(`✅ Synchronized ${totalSynced} orders across all tenants.`);
  } catch (error) {
    console.error("Failed to run order sync:", error.message);
  }
};

const getTier = (points) => {
  if (points >= 3000) return "gold";
  if (points >= 1000) return "silver";
  return "bronze";
};

const getSuperAdminCustomers = async ({ search = "", page = 1, limit = 10, startDate, endDate }) => {
  const skip = (page - 1) * limit;
  const where = {};

  if (search) {
    const cleanSearch = search.trim();
    where.OR = [
      { name: { contains: cleanSearch, mode: "insensitive" } },
      { phone: { contains: cleanSearch, mode: "insensitive" } },
      { email: { contains: cleanSearch, mode: "insensitive" } },
      { tenant: { name: { contains: cleanSearch, mode: "insensitive" } } },
    ];
  }

  if (startDate || endDate) {
    where.joinedAt = {};
    if (startDate) where.joinedAt.gte = new Date(startDate);
    if (endDate) where.joinedAt.lte = new Date(endDate);
  }

  const [customers, total] = await Promise.all([
    mainPrisma.aggregatedCustomer.findMany({
      where,
      include: { tenant: true },
      orderBy: { joinedAt: "desc" },
      skip,
      take: limit,
    }),
    mainPrisma.aggregatedCustomer.count({ where }),
  ]);

  return {
    customers: customers.map((c) => ({
      id: c.id,
      customerId: c.customerId,
      tenantId: c.tenantId,
      name: c.name,
      phone: c.phone,
      email: c.email,
      tenantName: c.tenant?.name || "Unknown Brand",
      points: c.points,
      tier: c.tier,
      joinedAt: c.joinedAt,
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getSuperAdminCustomerDetails = async (tenantId, customerId) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Tenant not found");

  const tenantPrisma = getTenantClient(tenant.dbUrl);
  const user = await tenantPrisma.user.findUnique({
    where: { id: customerId },
    include: {
      wallet: {
        include: {
          transactions: { orderBy: { createdAt: "desc" }, take: 50 },
        },
      },
      orders: {
        include: {
          items: { include: { menuItem: true } },
          branch: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!user || user.role !== "CUSTOMER") {
    throw new ApiError(404, "Customer not found");
  }

  // Deterministic visits derived from orders since there is no native visit table
  const visits = user.orders.map((o) => ({
    id: `v_${o.id}`,
    date: o.createdAt.toISOString().slice(0, 10),
    branch: o.branch?.name || "Downtown Flagship",
    city: o.branch?.city || "Riyadh",
    duration: `${Math.floor(20 + (o.total % 40))} min`,
  }));

  const pointsHistory = (user.wallet?.transactions || []).map((t) => ({
    id: t.id,
    date: t.createdAt.toISOString().slice(0, 10),
    type: t.points > 0 ? "earned" : "redeemed",
    points: Math.abs(t.points),
    reason: t.description || "Loyalty points transaction",
  }));

  const orderHistory = user.orders.map((o) => {
    const earnPointsTx = (user.wallet?.transactions || []).find(
      (tx) => tx.description && tx.description.includes(o.orderNumber)
    );
    const pointsEarned = earnPointsTx ? Math.abs(earnPointsTx.points) : Math.floor(o.total * tenant.loyaltyEarnRate);

    return {
      id: o.id,
      date: o.createdAt.toISOString().slice(0, 10),
      branch: o.branch?.name || "Register Terminal",
      items: o.items.reduce((acc, item) => acc + item.quantity, 0),
      total: o.total,
      pointsEarned,
    };
  });

  return {
    id: user.id,
    customerId: user.id,
    tenantId: tenant.id,
    name: user.name || "Walk-in Customer",
    phone: user.phone || null,
    email: user.email || null,
    tenantName: tenant.name,
    points: user.wallet?.points || 0,
    tier: getTier(user.wallet?.points || 0),
    joinedAt: user.createdAt,
    pointsHistory,
    orders: orderHistory,
    visits,
  };
};

const addSuperAdminCustomer = async ({ tenantId, name, phone, email, points = 0 }) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Tenant not found");

  const tenantPrisma = getTenantClient(tenant.dbUrl);

  // Check if user already exists
  let user = await tenantPrisma.user.findFirst({
    where: {
      OR: [
        phone ? { phone } : null,
        email ? { email } : null,
      ].filter(Boolean),
    },
  });

  if (user) {
    throw new ApiError(400, "Customer with this phone or email already exists in this brand");
  }

  // Create user
  user = await tenantPrisma.user.create({
    data: {
      name,
      phone,
      email,
      role: "CUSTOMER",
    },
  });

  // Create wallet
  const wallet = await tenantPrisma.wallet.create({
    data: {
      userId: user.id,
      points,
      lifetimeEarn: points,
    },
  });

  if (points > 0) {
    await tenantPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points,
        description: "Starting balance (Admin enrolled)",
      },
    });
  }

  // Sync
  await syncToAggregatedCustomer(tenantPrisma, tenant.id, user.id);

  return {
    id: `${tenant.id}_${user.id}`,
    customerId: user.id,
    tenantId: tenant.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    tenantName: tenant.name,
    points,
    tier: getTier(points),
    joinedAt: user.createdAt,
  };
};

const deleteSuperAdminCustomer = async (tenantId, customerId) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Tenant not found");

  const tenantPrisma = getTenantClient(tenant.dbUrl);
  
  try {
    const wallet = await tenantPrisma.wallet.findUnique({ where: { userId: customerId } });
    if (wallet) {
      await tenantPrisma.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
      await tenantPrisma.wallet.delete({ where: { id: wallet.id } });
    }
    await tenantPrisma.user.delete({ where: { id: customerId } });
  } catch (err) {
    console.error("Failed to delete user manually:", err.message);
    throw new ApiError(500, "Failed to delete customer from tenant database");
  }

  await mainPrisma.aggregatedCustomer.deleteMany({
    where: { tenantId, customerId }
  });
};

const getTenantUsers = async (tenantId) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Tenant not found");

  const tenantPrisma = getTenantClient(tenant.dbUrl);
  return tenantPrisma.user.findMany({
    orderBy: { createdAt: "desc" }
  });
};

const getAllSystemUsers = async (filters = {}) => {
  const where = {};
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  const superAdmins = await mainPrisma.superAdmin.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });

  const mergedUsers = superAdmins.map((admin) => ({
    id: admin.id,
    name: admin.name || "Super Admin",
    email: admin.email,
    role: "super_admin",
    tenantName: "Servio Platform",
    status: "active",
    lastActive: admin.createdAt,
    createdAt: admin.createdAt,
  }));

  const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });

  for (const tenant of tenants) {
    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      const staffUsers = await tenantPrisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" }
      });

      const tenantMapped = staffUsers.map((su) => ({
        id: su.id,
        name: su.name || "Staff Member",
        email: su.email || "",
        role: su.role.toLowerCase(),
        tenantName: tenant.name,
        status: "active",
        lastActive: su.createdAt,
        createdAt: su.createdAt,
      }));

      mergedUsers.push(...tenantMapped);
    } catch (err) {
      console.error(`Failed to fetch staff users for tenant ${tenant.name}:`, err.message);
    }
  }

  return mergedUsers;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getOverview,
  getSubscriptions,
  getLoyaltyOverview,
  getInvoices,
  getSuperAdminOrders,
  syncAllTenantOrders,
  getSuperAdminCustomers,
  getSuperAdminCustomerDetails,
  addSuperAdminCustomer,
  deleteSuperAdminCustomer,
  getTenantUsers,
  getAllSystemUsers,
};

