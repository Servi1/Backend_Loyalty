const mainPrisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");
const { Client } = require("pg");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const config = require("../../config");
const bcrypt = require("bcryptjs");
const { getTenantClient } = require("../../config/tenantManager");

const getAll = async () => mainPrisma.tenant.findMany();

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

const getLoyaltyOverview = async () => {
  const tenants = await mainPrisma.tenant.findMany({
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

      // Count members: user table where role === 'CUSTOMER'
      membersCount = await tenantPrisma.user.count({
        where: {
          role: "CUSTOMER"
        }
      });

      // Count redemptions: WalletTransaction table where points is negative
      redemptionsCount = await tenantPrisma.walletTransaction.count({
        where: {
          points: {
            lt: 0
          }
        }
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

module.exports = { getAll, getById, create, update, remove, getOverview, getSubscriptions, getLoyaltyOverview };
