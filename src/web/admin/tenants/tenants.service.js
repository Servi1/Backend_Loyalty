const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");
const { Client } = require("pg");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const config = require("../../../config");
const bcrypt = require("bcryptjs");
const { getTenantClient } = require("../../../config/tenantManager");


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
    await execPromise(`npx prisma db push --schema=prisma/schema.tenant.prisma --accept-data-loss --skip-generate`, {
      env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
    });
  } catch (err) {
    throw new ApiError(500, `Failed to push schema to tenant DB: ${err.message}`);
  }

  // 3.5. Create initial BRAND_MANAGER and seed default order types
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

      // Seed default order types if empty
      const existingOrderTypes = await tenantPrisma.customOrderType.findMany();
      if (existingOrderTypes.length === 0) {
        await tenantPrisma.customOrderType.createMany({
          data: [
            { name: "Dine In", isActive: true },
            { name: "Takeaway", isActive: true },
            { name: "Delivery", isActive: true },
            { name: "Deliver to Car", isActive: true },
            { name: "Scheduled", isActive: true }
          ]
        });
      }
    } catch (err) {
      console.error("Failed to initialize tenant defaults:", err);
    }
  }

  // 4. Save tenant to main registry
  const { adminEmail, adminPassword, adminName, ...tenantData } = data;
  const tenant = await mainPrisma.tenant.create({
    data: {
      ...tenantData,
      dbUrl: tenantDbUrl,
    },
  });

  return tenant;
};

const update = async (id, data) => {
  const existingTenant = await getById(id);

  // Track mid-month slot additions
  const slotFields = [
    { key: "posQuantity", serviceType: "pos", priceKey: "pricePos", defaultPrice: 49.0 },
    { key: "qrTableQuantity", serviceType: "qr_table", priceKey: "priceQrTable", defaultPrice: 19.0 },
    { key: "qrCashierQuantity", serviceType: "qr_cashier", priceKey: "priceQrCashier", defaultPrice: 9.0 },
    { key: "kdsQuantity", serviceType: "kds", priceKey: "priceKds", defaultPrice: 19.0 },
    { key: "cdsQuantity", serviceType: "cds", priceKey: "priceCds", defaultPrice: 9.0 },
    { key: "branchLimit", serviceType: "branch", priceKey: "priceBranch", defaultPrice: 19.0 },
  ];

  for (const sf of slotFields) {
    if (data[sf.key] !== undefined && Number(data[sf.key]) > Number(existingTenant[sf.key] || 0)) {
      const addedQuantity = Number(data[sf.key]) - Number(existingTenant[sf.key] || 0);
      const pricePerUnit = data[sf.priceKey] !== undefined ? Number(data[sf.priceKey]) : Number(existingTenant[sf.priceKey] || sf.defaultPrice);

      try {
        await mainPrisma.tenantSlotAddon.create({
          data: {
            tenantId: id,
            serviceType: sf.serviceType,
            quantity: addedQuantity,
            pricePerUnit,
            notes: `Super Admin added +${addedQuantity} ${sf.serviceType.toUpperCase()} slot(s) mid-month`
          }
        });
      } catch (err) {
        console.error(`Failed to record slot addon for tenant ${id}:`, err.message);
      }
    }
  }

  // Track mid-month global feature license activations
  const toggleFields = [
    { key: "subBrandStory", serviceType: "brand_story", priceKey: "priceBrandStory", defaultPrice: 0.0 },
    { key: "subAppBrand", serviceType: "app_brand", priceKey: "priceAppBrand", defaultPrice: 99.0 },
    { key: "subAppServi", serviceType: "app_servi", priceKey: "priceAppServi", defaultPrice: 29.0 },
  ];

  for (const tf of toggleFields) {
    if (data[tf.key] === true && !existingTenant[tf.key]) {
      const pricePerUnit = data[tf.priceKey] !== undefined ? Number(data[tf.priceKey]) : Number(existingTenant[tf.priceKey] || tf.defaultPrice);
      try {
        await mainPrisma.tenantSlotAddon.create({
          data: {
            tenantId: id,
            serviceType: tf.serviceType,
            quantity: 1,
            pricePerUnit,
            notes: `Super Admin activated ${tf.serviceType.toUpperCase()} feature license mid-month`
          }
        });
      } catch (err) {
        console.error(`Failed to record feature addon for tenant ${id}:`, err.message);
      }
    }
  }

  return mainPrisma.tenant.update({ where: { id }, data });
};

const remove = async (id) => {
  const tenant = await getById(id);

  if (tenant && tenant.dbUrl) {
    try {
      const urlObj = new URL(tenant.dbUrl);
      const dbName = urlObj.pathname.replace("/", "");
      if (dbName && dbName.startsWith("tenant_")) {
        const mainDbUrl = process.env.DATABASE_URL;
        const client = new Client({ connectionString: mainDbUrl });
        await client.connect();
        // Terminate existing active connections to tenant DB before dropping
        await client.query(`
          SELECT pg_terminate_backend(pg_stat_activity.pid)
          FROM pg_stat_activity
          WHERE pg_stat_activity.datname = '${dbName}'
            AND pid <> pg_backend_pid();
        `);
        await client.query(`DROP DATABASE IF EXISTS "${dbName}";`);
        await client.end();
        console.log(`Successfully dropped physical database ${dbName} for tenant ${tenant.slug}`);
      }
    } catch (err) {
      console.error(`Failed to drop physical DB for tenant ${tenant?.slug}:`, err.message);
    }
  }

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
    let amount = 0;
    const activeFeatures = [];
    
    const getMonthlyEquivalent = (price, cycleKey) => {
      const p = price !== undefined && price !== null ? Number(price) : 0.0;
      const cycle = tenant[cycleKey] || tenant.billingCycle || "monthly";
      return cycle === "yearly" ? (p / 12) : p;
    };

    if (tenant.subAppServi) { amount += getMonthlyEquivalent(tenant.priceAppServi, "cycleAppServi"); activeFeatures.push("APP servi"); }
    if (tenant.subAppBrand) { amount += getMonthlyEquivalent(tenant.priceAppBrand, "cycleAppBrand"); activeFeatures.push("APP brand"); }
    if (tenant.subPos) { amount += getMonthlyEquivalent(tenant.pricePos, "cyclePos"); activeFeatures.push("POS"); }
    if (tenant.subQrTable) { amount += getMonthlyEquivalent(tenant.priceQrTable, "cycleQrTable"); activeFeatures.push("QR Table"); }
    if (tenant.subQrCashier) { amount += getMonthlyEquivalent(tenant.priceQrCashier, "cycleQrCashier"); activeFeatures.push("QR Cashier"); }
    if (tenant.subKds) { amount += getMonthlyEquivalent(tenant.priceKds, "cycleKds"); activeFeatures.push("KDS"); }
    if (tenant.subCds) { amount += getMonthlyEquivalent(tenant.priceCds, "cycleCds"); activeFeatures.push("CDS"); }
    if (tenant.subBranch) { amount += getMonthlyEquivalent(tenant.priceBranch, "cycleBranch"); activeFeatures.push("Physical Branches"); }

    const planName = activeFeatures.length > 0 ? activeFeatures.join(", ") : "Free";

    // Calculate current month's active subscription range (e.g., September 1 to September 30)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let monthStartedAt = new Date(currentYear, currentMonth, 1);
    const tenantCreatedAt = new Date(tenant.createdAt);
    if (tenantCreatedAt > monthStartedAt) {
      monthStartedAt = tenantCreatedAt;
    }
    const monthEndsAt = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

    const startedAt = monthStartedAt;
    const endsAt = monthEndsAt;

    if (tenant.isActive) {
      totalMRR += amount;
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
          createdAt: true,
          ordersEnabled: true,
          menuEnabled: true,
          tablesEnabled: true,
          staffEnabled: true,
          qrEnabled: true,
          posEnabled: true,
          kdsEnabled: true,
          cdsEnabled: true,
          appServiEnabled: true,
          tables: {
            select: {
              id: true,
              label: true,
              createdAt: true,
              expiresAt: true,
              isActive: true
            }
          },
          posDevices: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              expiresAt: true,
              isActive: true
            }
          },
          qrCashiers: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              isActive: true
            }
          },
          _count: {
            select: {
              tables: true,
              posDevices: true,
              staff: true,
              qrCashiers: true
            }
          }
        }
      });

      // Auto-inactivate tables and POS devices that expired more than 7 days ago
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      for (const branch of dbBranches) {
        for (const t of branch.tables) {
          if (t.isActive && t.expiresAt && new Date(t.expiresAt) < sevenDaysAgo) {
            await tenantPrisma.table.update({
              where: { id: t.id },
              data: { isActive: false }
            });
            t.isActive = false;
          }
        }
        for (const p of branch.posDevices) {
          if (p.isActive && p.expiresAt && new Date(p.expiresAt) < sevenDaysAgo) {
            await tenantPrisma.posDevice.update({
              where: { id: p.id },
              data: { isActive: false }
            });
            p.isActive = false;
          }
        }
      }

      branchesList = dbBranches.map(b => {
        let bStart = new Date(currentYear, currentMonth, 1);
        if (b.createdAt && new Date(b.createdAt) > bStart) {
          bStart = new Date(b.createdAt);
        }

        const mappedTables = (b.tables || []).map(t => {
          let tStart = new Date(currentYear, currentMonth, 1);
          if (t.createdAt && new Date(t.createdAt) > tStart) {
            tStart = new Date(t.createdAt);
          }
          return {
            ...t,
            createdAt: tStart,
            expiresAt: monthEndsAt,
          };
        });

        const mappedPosDevices = (b.posDevices || []).map(p => {
          let pStart = new Date(currentYear, currentMonth, 1);
          if (p.createdAt && new Date(p.createdAt) > pStart) {
            pStart = new Date(p.createdAt);
          }
          return {
            ...p,
            createdAt: pStart,
            expiresAt: monthEndsAt,
          };
        });

        const mappedQrCashiers = (b.qrCashiers || []).map(q => {
          let qStart = new Date(currentYear, currentMonth, 1);
          if (q.createdAt && new Date(q.createdAt) > qStart) {
            qStart = new Date(q.createdAt);
          }
          return {
            ...q,
            createdAt: qStart,
            expiresAt: monthEndsAt,
          };
        });

        return {
          id: b.id,
          name: b.name,
          city: b.city || "Unknown",
          startedAt: bStart,
          endsAt: monthEndsAt,
          status: b.isOpen ? "open" : "closed",
          ordersEnabled: b.ordersEnabled,
          menuEnabled: b.menuEnabled,
          tablesEnabled: b.tablesEnabled,
          staffEnabled: b.staffEnabled,
          qrEnabled: b.qrEnabled,
          posEnabled: b.posEnabled,
          kdsEnabled: b.kdsEnabled,
          cdsEnabled: b.cdsEnabled,
          appServiEnabled: b.appServiEnabled,
          tablesCount: b._count?.tables || 0,
          posDevicesCount: b._count?.posDevices || 0,
          staffCount: b._count?.staff || 0,
          qrCashiersCount: b._count?.qrCashiers || 0,
          tables: mappedTables,
          posDevices: mappedPosDevices,
          qrCashiers: mappedQrCashiers
        };
      });
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
      branches: branchesList,
      subAppServi: tenant.subAppServi,
      subAppBrand: tenant.subAppBrand,
      subPos: tenant.subPos,
      subQrTable: tenant.subQrTable,
      subQrCashier: tenant.subQrCashier,
      subKds: tenant.subKds,
      subCds: tenant.subCds,
      kdsQuantity: tenant.kdsQuantity,
      cdsQuantity: tenant.cdsQuantity,
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
  if (filters.tenantId) {
    where.id = filters.tenantId;
  }
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  const tenants = await mainPrisma.tenant.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });

  const appUserWhere = {};
  if (filters.startDate || filters.endDate) {
    appUserWhere.createdAt = {};
    if (filters.startDate) appUserWhere.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) appUserWhere.createdAt.lte = new Date(filters.endDate);
  }
  const totalMembers = await mainPrisma.appUser.count({ where: appUserWhere });

  const programs = [];
  let totalRedemptions = 0;

  for (const tenant of tenants) {
    let membersCount = 0;
    let redemptionsCount = 0;

    try {
      const txCountWhere = { tenantId: tenant.id };
      if (filters.startDate || filters.endDate) {
        txCountWhere.createdAt = {};
        if (filters.startDate) txCountWhere.createdAt.gte = new Date(filters.startDate);
        if (filters.endDate) txCountWhere.createdAt.lte = new Date(filters.endDate);
      }
      const uniqueWallets = await mainPrisma.walletTransaction.groupBy({
        by: ['walletId'],
        where: txCountWhere
      });
      membersCount = uniqueWallets.length;

      const txWhere = { points: { lt: 0 }, tenantId: tenant.id };
      if (filters.startDate || filters.endDate) {
        txWhere.createdAt = {};
        if (filters.startDate) txWhere.createdAt.gte = new Date(filters.startDate);
        if (filters.endDate) txWhere.createdAt.lte = new Date(filters.endDate);
      }

      // Count redemptions: WalletTransaction table in main registry
      redemptionsCount = await mainPrisma.walletTransaction.count({
        where: txWhere
      });
    } catch (err) {
      console.error(`Failed to fetch loyalty stats for tenant ${tenant.slug}:`, err.message);
    }

    totalRedemptions += redemptionsCount;

    programs.push({
      id: tenant.id,
      tenantName: tenant.name,
      slug: tenant.slug,
      enabled: tenant.loyaltyEnabled,
      loyaltyAddPoints: tenant.loyaltyAddPoints,
      loyaltyRedeemPoints: tenant.loyaltyRedeemPoints,
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
    include: { slotAddons: true },
    orderBy: { createdAt: "desc" }
  });

  const invoices = [];

  const getDaysActiveInMonth = (startDate, endDate, year, month) => {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const totalDays = new Date(year, month + 1, 0).getDate();

    const activeStart = new Date(Math.max(monthStart.getTime(), startDate.getTime()));
    const cycleEnd = new Date(Math.min(monthEnd.getTime(), endDate.getTime()));

    if (activeStart > cycleEnd) {
      return { daysActive: 0, cycleActiveDays: 0, totalDays, period: "" };
    }

    // Convert to midnight calendar dates to eliminate time-of-day skew
    const startDay = new Date(activeStart.getFullYear(), activeStart.getMonth(), activeStart.getDate());
    const cycleEndDay = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth(), cycleEnd.getDate());

    const cycleDiffDays = Math.round((cycleEndDay.getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const cycleActiveDays = Math.min(totalDays, Math.max(1, cycleDiffDays));

    const now = new Date();
    const isCurrentMonth = (year === now.getFullYear() && month === now.getMonth());
    const effectiveNow = isCurrentMonth ? new Date(Math.min(monthEnd.getTime(), now.getTime())) : monthEnd;

    const elapsedEnd = new Date(Math.min(effectiveNow.getTime(), endDate.getTime()));
    const elapsedEndDay = new Date(elapsedEnd.getFullYear(), elapsedEnd.getMonth(), elapsedEnd.getDate());

    let daysActive = 0;
    if (startDay <= elapsedEndDay) {
      const elapsedDiffDays = Math.round((elapsedEndDay.getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      daysActive = Math.min(cycleActiveDays, Math.max(1, elapsedDiffDays));
    }

    const startStr = activeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = cycleEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    return {
      daysActive,
      cycleActiveDays,
      totalDays,
      period: `${startStr} - ${endStr}`
    };
  };

  for (const tenant of tenants) {
    // 1. Fetch branches and registered devices from tenant DB
    let dbBranches = [];
    let dbPosDevices = [];
    let dbKdsDevices = [];
    let dbTables = [];
    let dbQrCashiers = [];
    let dbCdsDevices = [];

    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      dbBranches = await tenantPrisma.branch.findMany({
        select: {
          id: true,
          name: true,
          createdAt: true,
          tablesEnabled: true,
          posEnabled: true,
          qrEnabled: true,
          kdsEnabled: true,
          cdsEnabled: true,
          appServiEnabled: true,
          tablesSubscribedAt: true,
          posSubscribedAt: true,
          qrSubscribedAt: true,
          kdsSubscribedAt: true,
          cdsSubscribedAt: true,
          appServiSubscribedAt: true
        }
      });
      dbPosDevices = await tenantPrisma.posDevice.findMany({ include: { branch: true }, orderBy: { createdAt: "asc" } }).catch(() => []);
      dbKdsDevices = await tenantPrisma.kdsDevice.findMany({ include: { branch: true }, orderBy: { createdAt: "asc" } }).catch(() => []);
      dbTables = await tenantPrisma.table.findMany({ include: { branch: true }, orderBy: { createdAt: "asc" } }).catch(() => []);
      dbQrCashiers = await tenantPrisma.qrCashier.findMany({ include: { branch: true }, orderBy: { createdAt: "asc" } }).catch(() => []);
      dbCdsDevices = tenantPrisma.cdsDevice ? await tenantPrisma.cdsDevice.findMany({ include: { branch: true }, orderBy: { createdAt: "asc" } }).catch(() => []) : [];
    } catch (err) {
      console.error(`Failed to fetch devices for tenant ${tenant.slug} in getInvoices:`, err.message);
    }

    // 2. Loop through calendar months since signup
    const startedAt = tenant.createdAt;
    const now = new Date();

    let currentYear = startedAt.getFullYear();
    let currentMonth = startedAt.getMonth();

    const targetYear = now.getFullYear();
    const targetMonth = now.getMonth();

    while (currentYear < targetYear || (currentYear === targetYear && currentMonth <= targetMonth)) {
      const monthStart = new Date(currentYear, currentMonth, 1);
      const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      const currentMonthEnd = monthEnd;

      let invoiceAmount = 0;
      const globalServices = [];
      const branchBreakdowns = [];

      // A. Global & Slot-based Subscription Services
      const globalServiceConfigs = [
        { flag: "subAppServi", priceKey: "priceAppServi", cycleKey: "cycleAppServi", defaultPrice: 0.0, label: "App Servi License", isSlot: false, typeKey: "app_servi" },
        { flag: "subAppBrand", priceKey: "priceAppBrand", cycleKey: "cycleAppBrand", defaultPrice: 0.0, label: "App Brand License", isSlot: false, typeKey: "app_brand" },
        { flag: "subPos", qtyKey: "posQuantity", priceKey: "pricePos", cycleKey: "cyclePos", defaultPrice: 0.0, label: "POS Terminal", isSlot: true, typeKey: "pos" },
        { flag: "subQrTable", qtyKey: "qrTableQuantity", priceKey: "priceQrTable", cycleKey: "cycleQrTable", defaultPrice: 0.0, label: "QR Table Dining", isSlot: true, typeKey: "qr_table" },
        { flag: "subQrCashier", qtyKey: "qrCashierQuantity", priceKey: "priceQrCashier", cycleKey: "cycleQrCashier", defaultPrice: 0.0, label: "QR Cashier Counter", isSlot: true, typeKey: "qr_cashier" },
        { flag: "subKds", qtyKey: "kdsQuantity", priceKey: "priceKds", cycleKey: "cycleKds", defaultPrice: 0.0, label: "KDS Kitchen Screen", isSlot: true, typeKey: "kds" },
        { flag: "subCds", qtyKey: "cdsQuantity", priceKey: "priceCds", cycleKey: "cycleCds", defaultPrice: 0.0, label: "CDS Customer Display", isSlot: true, typeKey: "cds" },
        { flag: "subBranch", qtyKey: "branchLimit", priceKey: "priceBranch", cycleKey: "cycleBranch", defaultPrice: 0.0, label: "Branch Location", isSlot: true, typeKey: "branch" },
        { flag: "subBrandStory", priceKey: "priceBrandStory", cycleKey: "cycleBrandStory", defaultPrice: 0.0, label: "Brand Story Feature", isSlot: false, typeKey: "brand_story" },
      ];

      // Track base slot counts to align add-on slots with remaining registered devices
      const baseSlotCounts = {};

      for (const gsvc of globalServiceConfigs) {
        if (tenant[gsvc.flag]) {
          const featureAddon = (tenant.slotAddons || [])
            .filter(a => a.serviceType.toLowerCase() === gsvc.typeKey)
            .sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime())[0];

          const featureSubscribedAt = featureAddon ? new Date(featureAddon.addedAt) : tenant.createdAt;
          const { daysActive, cycleActiveDays, totalDays, period } = getDaysActiveInMonth(featureSubscribedAt, currentMonthEnd, currentYear, currentMonth);

          if (cycleActiveDays > 0 || daysActive > 0) {
            const unitPrice = tenant[gsvc.priceKey] !== undefined && tenant[gsvc.priceKey] !== null ? Number(tenant[gsvc.priceKey]) : gsvc.defaultPrice;
            const serviceCycle = tenant[gsvc.cycleKey] || tenant.billingCycle || "monthly";
            const isYearly = String(serviceCycle).toLowerCase() === "yearly";

            // Monthly base price for monthly invoice calculations
            const effectiveMonthlyPrice = isYearly ? (unitPrice / 12) : unitPrice;
            
            // Subtract mid-month add-ons added in this month to get initial base slots
            const monthAddonQty = (tenant.slotAddons || [])
              .filter(a => {
                const d = new Date(a.addedAt);
                return a.serviceType.toLowerCase() === gsvc.typeKey && d.getFullYear() === currentYear && d.getMonth() === currentMonth;
              })
              .reduce((sum, a) => sum + Number(a.quantity || 0), 0);

            let yearlyDaysActive = daysActive;
            let yearlyDaysRemaining = 365 - daysActive;
            let yearlyPeriod = period;
            let yearlyTotalDays = 365;
            if (isYearly) {
              const subStart = featureSubscribedAt;
              const calendarYearEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999);
              const activeStart = new Date(Math.max(new Date(currentYear, 0, 1).getTime(), subStart.getTime()));
              
              const totalMs = Math.max(0, calendarYearEnd.getTime() - activeStart.getTime());
              yearlyTotalDays = Math.max(1, Math.ceil(totalMs / (24 * 60 * 60 * 1000)));

              const remainingMs = Math.max(0, calendarYearEnd.getTime() - now.getTime());
              yearlyDaysRemaining = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
              yearlyDaysActive = Math.max(0, yearlyTotalDays - yearlyDaysRemaining);

              const startStr = activeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const endStr = calendarYearEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              yearlyPeriod = `${startStr} - ${endStr}`;
            }

            if (gsvc.isSlot) {
              let regDevices = [];
              if (gsvc.typeKey === "pos") regDevices = dbPosDevices;
              else if (gsvc.typeKey === "kds") regDevices = dbKdsDevices;
              else if (gsvc.typeKey === "qr_table") regDevices = dbTables;
              else if (gsvc.typeKey === "qr_cashier") regDevices = dbQrCashiers;
              else if (gsvc.typeKey === "cds") regDevices = dbCdsDevices;

              const rawCurrentQty = Math.max(Number(tenant[gsvc.qtyKey] || 0), regDevices.length);
              const quantity = Math.max(0, rawCurrentQty - monthAddonQty);
              baseSlotCounts[gsvc.typeKey] = quantity;

              for (let i = 0; i < quantity; i++) {
                const singleCost = effectiveMonthlyPrice * (cycleActiveDays / totalDays);
                const assigned = regDevices[i] || null;
                const isSlotCanceled = assigned ? assigned.isActive === false : (i >= Number(tenant[gsvc.qtyKey] || 0));
                const itemCharge = isSlotCanceled ? 0.0 : parseFloat(singleCost.toFixed(2));
                if (!isSlotCanceled) {
                  invoiceAmount += itemCharge;
                }

                globalServices.push({
                  id: `${gsvc.typeKey}_slot_${i + 1}`,
                  typeKey: gsvc.typeKey,
                  slotIndex: i + 1,
                  name: `${gsvc.label} Slot #${i + 1}`,
                  isCanceled: isSlotCanceled,
                  assignedDevice: assigned ? {
                    id: assigned.id,
                    name: assigned.name || assigned.label || `Device #${i + 1}`,
                    deviceKey: assigned.deviceKey || null,
                    branchName: assigned.branch?.name || "Main Branch",
                    isActive: assigned.isActive ?? true,
                  } : null,
                  price: unitPrice,
                  billingCycle: serviceCycle,
                  isYearly,
                  monthlyTotal: parseFloat(effectiveMonthlyPrice.toFixed(2)),
                  amount: itemCharge,
                  quantity: 1,
                  daysActive,
                  totalDays,
                  yearlyDaysActive,
                  yearlyTotalDays: isYearly ? yearlyTotalDays : 365,
                  yearlyDaysRemaining,
                  period: isYearly ? yearlyPeriod : period,
                  prorated: cycleActiveDays < totalDays
                });
              }
            } else {
              const monthlyPrice = effectiveMonthlyPrice;
              const cost = monthlyPrice * (cycleActiveDays / totalDays);

              invoiceAmount += cost;
              globalServices.push({
                id: `${gsvc.typeKey}_license`,
                typeKey: gsvc.typeKey,
                slotIndex: 1,
                name: gsvc.label,
                isCanceled: false,
                price: unitPrice,
                billingCycle: serviceCycle,
                isYearly,
                monthlyTotal: parseFloat(monthlyPrice.toFixed(2)),
                amount: parseFloat(cost.toFixed(2)),
                quantity: 1,
                daysActive,
                totalDays,
                yearlyDaysActive,
                yearlyTotalDays: isYearly ? yearlyTotalDays : 365,
                yearlyDaysRemaining,
                period: isYearly ? yearlyPeriod : period,
                prorated: cycleActiveDays < totalDays
              });
            }
          }
        }
      }

      // Mid-month Slot Add-on Prorated Charges (split into separate single-slot lines)
      const serviceLabels = {
        pos: "POS Terminal",
        qr_table: "QR Table Dining",
        qr_cashier: "QR Cashier Counter",
        kds: "KDS Kitchen Screen",
        cds: "CDS Customer Display",
        branch: "Branch Location",
        app_brand: "App Brand License"
      };

      const tenantAddons = tenant.slotAddons || [];
      const addonCounts = {};
      for (const addon of tenantAddons) {
        const addedDate = new Date(addon.addedAt);
        if (addedDate.getFullYear() === currentYear && addedDate.getMonth() === currentMonth) {
          const { daysActive, cycleActiveDays, totalDays, period } = getDaysActiveInMonth(addedDate, currentMonthEnd, currentYear, currentMonth);
          if (cycleActiveDays > 0 || daysActive > 0) {
            const unitPrice = Number(addon.pricePerUnit || 0);
            const addonQty = Number(addon.quantity || 1);
            const label = serviceLabels[addon.serviceType.toLowerCase()] || addon.serviceType.toUpperCase();
            const typeKey = addon.serviceType.toLowerCase();

            let regDevices = [];
            if (typeKey === "pos") regDevices = dbPosDevices;
            else if (typeKey === "kds") regDevices = dbKdsDevices;
            else if (typeKey === "qr_table") regDevices = dbTables;

            const cycleKeyMap = {
              pos: "cyclePos",
              qr_table: "cycleQrTable",
              qr_cashier: "cycleQrCashier",
              kds: "cycleKds",
              cds: "cycleCds",
              branch: "cycleBranch",
              app_servi: "cycleAppServi",
              app_brand: "cycleAppBrand"
            };
            const cycleKey = cycleKeyMap[typeKey];
            const serviceCycle = tenant[cycleKey] || tenant.billingCycle || "monthly";
            const isYearly = String(serviceCycle).toLowerCase() === "yearly";
            const effectiveMonthlyPrice = isYearly ? (unitPrice / 12) : unitPrice;

            let yearlyDaysActive = daysActive;
            let yearlyDaysRemaining = 365 - daysActive;
            let yearlyPeriod = period;
            let yearlyTotalDays = 365;
            if (isYearly) {
              const subStart = new Date(addedDate);
              const calendarYearEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999);
              const activeStart = new Date(Math.max(new Date(currentYear, 0, 1).getTime(), subStart.getTime()));
              
              const totalMs = Math.max(0, calendarYearEnd.getTime() - activeStart.getTime());
              yearlyTotalDays = Math.max(1, Math.ceil(totalMs / (24 * 60 * 60 * 1000)));

              const remainingMs = Math.max(0, calendarYearEnd.getTime() - now.getTime());
              yearlyDaysRemaining = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
              yearlyDaysActive = Math.max(0, yearlyTotalDays - yearlyDaysRemaining);

              const startStr = activeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const endStr = calendarYearEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              yearlyPeriod = `${startStr} - ${endStr}`;
            }

            for (let i = 0; i < addonQty; i++) {
              const singleCost = effectiveMonthlyPrice * (cycleActiveDays / totalDays);
              const globalIndex = (baseSlotCounts[typeKey] || 0);
              baseSlotCounts[typeKey] = globalIndex + 1;
              const addonSeq = (addonCounts[typeKey] = (addonCounts[typeKey] || 0) + 1);
              const assigned = regDevices[globalIndex] || null;
              const isAddonCanceled = assigned ? assigned.isActive === false : false;
              const itemCharge = isAddonCanceled ? 0.0 : parseFloat(singleCost.toFixed(2));

              if (!isAddonCanceled) {
                invoiceAmount += itemCharge;
              }

              globalServices.push({
                id: `addon_${typeKey}_slot_${addonSeq}_${addedDate.getTime()}`,
                typeKey,
                slotIndex: globalIndex + 1,
                name: `Add-on: ${label} Slot #${addonSeq}`,
                isCanceled: isAddonCanceled,
                assignedDevice: assigned ? {
                  id: assigned.id,
                  name: assigned.name || assigned.label || `Device #${globalIndex + 1}`,
                  deviceKey: assigned.deviceKey || null,
                  branchName: assigned.branch?.name || "Main Branch",
                  isActive: assigned.isActive ?? true,
                } : null,
                price: unitPrice,
                billingCycle: serviceCycle,
                isYearly,
                monthlyTotal: parseFloat(effectiveMonthlyPrice.toFixed(2)),
                amount: itemCharge,
                quantity: 1,
                daysActive,
                totalDays,
                yearlyDaysActive,
                yearlyTotalDays: isYearly ? yearlyTotalDays : 365,
                yearlyDaysRemaining,
                period: isYearly ? yearlyPeriod : period,
                prorated: cycleActiveDays < totalDays
              });
            }
          }
        }
      }

      // B. Branch-level services
      for (const branch of dbBranches) {
        if (new Date(branch.createdAt) > currentMonthEnd) continue;

        const servicesList = [];
        let branchTotal = 0;

        // I. Branch Base Fee (if subBranch is enabled on tenant level)
        if (tenant.subBranch) {
          const { daysActive, cycleActiveDays, totalDays, period } = getDaysActiveInMonth(branch.createdAt, currentMonthEnd, currentYear, currentMonth);
          if (cycleActiveDays > 0 || daysActive > 0) {
            const price = tenant.priceBranch !== undefined ? tenant.priceBranch : 19.0;
            const cost = price * (cycleActiveDays / totalDays);
            branchTotal += cost;
            servicesList.push({
              name: "Branch Base Fee",
              price,
              amount: parseFloat(cost.toFixed(2)),
              daysActive,
              totalDays,
              period,
              prorated: cycleActiveDays < totalDays
            });
          }
        }

        // II. Branch Feature Toggles are enabled/disabled per branch, but slot pricing is managed globally in Section A to prevent double-billing.

        if (servicesList.length > 0) {
          invoiceAmount += branchTotal;
          branchBreakdowns.push({
            branchId: branch.id,
            branchName: branch.name,
            total: parseFloat(branchTotal.toFixed(2)),
            services: servicesList
          });
        }
      }

      // C. Service Transaction Fees breakdown (calculates total fees based on transaction rates set in tenant configuration)
      let periodOrders = [];
      try {
        periodOrders = await mainPrisma.aggregatedOrder.findMany({
          where: {
            tenantId: tenant.id,
            createdAt: { gte: monthStart, lte: currentMonthEnd },
            status: "COMPLETED"
          }
        });
      } catch (err) {
        console.error(`Failed to fetch orders for fee calculation for tenant ${tenant.slug}:`, err.message);
      }

      const feeConfigs = [
        { key: "feeAppServi", label: "APP servi", sourceMatch: (o) => o.source === "app" },
        { key: "feeAppBrand", label: "APP brand", sourceMatch: (o) => o.source === "app_brand" || o.type === "DELIVERY" },
        { key: "feePos", label: "POS Integration", sourceMatch: (o) => o.source === "pos" },
        { key: "feeQrTable", label: "QR Table Dining", sourceMatch: (o) => o.source === "qr_table" },
        { key: "feeQrCashier", label: "QR Cashier", sourceMatch: (o) => o.source === "qr_cashier" },
        { key: "feeKds", label: "KDS Screen", sourceMatch: (o) => o.source === "kds" },
        { key: "feeCds", label: "CDS Screen", sourceMatch: (o) => o.source === "cds" },
        { key: "feeBranch", label: "Physical Branches", sourceMatch: (o) => false }
      ];

      const transactionFeesList = [];
      let totalTransactionFees = 0;

      for (const fc of feeConfigs) {
        const rate = tenant[fc.key] !== undefined && tenant[fc.key] !== null ? Number(tenant[fc.key]) : 0.0;
        const matchingOrders = periodOrders.filter(fc.sourceMatch);
        const salesVolume = matchingOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
        const feeAmount = salesVolume * (rate / 100);

        if (rate > 0 || matchingOrders.length > 0 || fc.key === "feeAppServi" || fc.key === "feeAppBrand" || fc.key === "feePos") {
          totalTransactionFees += feeAmount;
          transactionFeesList.push({
            name: fc.label,
            feeRate: rate,
            ordersCount: matchingOrders.length,
            salesVolume: parseFloat(salesVolume.toFixed(2)),
            feeAmount: parseFloat(feeAmount.toFixed(2))
          });
        }
      }

      // Only generate invoice if there are active features/services
      const activeFeatures = [];
      if (tenant.subAppServi) activeFeatures.push("APP servi");
      if (tenant.subAppBrand) activeFeatures.push("APP brand");
      if (tenant.subPos) activeFeatures.push("POS");
      if (tenant.subQrTable) activeFeatures.push("QR Table");
      if (tenant.subQrCashier) activeFeatures.push("QR Cashier");
      if (tenant.subKds) activeFeatures.push("KDS");
      if (tenant.subCds) activeFeatures.push("CDS");
      const planName = activeFeatures.length > 0 ? activeFeatures.join(", ") : "Free";

      const startPeriodStr = new Date(Math.max(monthStart.getTime(), startedAt.getTime())).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const endPeriodStr = currentMonthEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      const invoiceDate = new Date(currentYear, currentMonth, 1);
      let match = true;
      if (filters.startDate && invoiceDate < new Date(filters.startDate)) match = false;
      if (filters.endDate && invoiceDate > new Date(filters.endDate)) match = false;

      if (match) {
        const totalBilledAmount = invoiceAmount + totalTransactionFees;
        invoices.push({
          id: `INV-${tenant.slug.toUpperCase()}-${currentYear}${String(currentMonth + 1).padStart(2, "0")}`,
          tenantId: tenant.id,
          tenantName: tenant.name,
          plan: planName,
          period: `${startPeriodStr} - ${endPeriodStr}`,
          amount: parseFloat(totalBilledAmount.toFixed(2)),
          subscriptionAmount: parseFloat(invoiceAmount.toFixed(2)),
          status: tenant.isActive ? "paid" : "overdue",
          createdAt: new Date(currentYear, currentMonth, 1),
          breakdown: {
            globalServices,
            branches: branchBreakdowns,
            transactionFees: transactionFeesList,
            totalTransactionFees: parseFloat(totalTransactionFees.toFixed(2))
          }
        });
      }

      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
    }
  }

  // Sort invoices by date descending
  invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return invoices;
};

const getSuperAdminOrders = async ({ tenantId, startDate, endDate, status, page = 1, limit = 20 }) => {
  // Ensure 100% real-time accuracy by reconciling any un-synced tenant orders
  await syncAllTenantOrders().catch(err => console.error("[REAL-TIME SYNC] Order reconciliation warning:", err.message));

  const where = {};
  if (status) where.status = status;
  if (tenantId) {
    if (typeof tenantId === "string" && tenantId.includes(",")) {
      where.tenantId = { in: tenantId.split(",").map(t => t.trim()) };
    } else if (Array.isArray(tenantId)) {
      where.tenantId = { in: tenantId };
    } else {
      where.tenantId = tenantId;
    }
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

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

  const formattedOrders = orders.map((order) => {
    const resolvedFee = (order.feeRate !== undefined && order.feeRate !== null && !isNaN(Number(order.feeRate)))
      ? Number(order.feeRate)
      : resolveTenantFeeRate(order.tenant, order.source);
    return {
      ...order,
      feeRate: resolvedFee
    };
  });

  return {
    total,
    orders: formattedOrders,
    page,
    limit
  };
};

const resolveTenantFeeRate = (tenant, source) => {
  if (!tenant) return 0.0;
  const src = (source || "pos").toLowerCase();
  if (src === "app") return Number(tenant.feeAppServi !== undefined && tenant.feeAppServi !== null ? tenant.feeAppServi : 0.0);
  if (src === "app_brand") return Number(tenant.feeAppBrand !== undefined && tenant.feeAppBrand !== null ? tenant.feeAppBrand : 0.0);
  if (src === "pos") return Number(tenant.feePos !== undefined && tenant.feePos !== null ? tenant.feePos : 0.0);
  if (src === "qr_table") return Number(tenant.feeQrTable !== undefined && tenant.feeQrTable !== null ? tenant.feeQrTable : 0.0);
  if (src === "qr_cashier") return Number(tenant.feeQrCashier !== undefined && tenant.feeQrCashier !== null ? tenant.feeQrCashier : 0.0);
  if (src === "kds") return Number(tenant.feeKds !== undefined && tenant.feeKds !== null ? tenant.feeKds : 0.0);
  if (src === "cds") return Number(tenant.feeCds !== undefined && tenant.feeCds !== null ? tenant.feeCds : 0.0);
  return 0.0;
};

const resolveCustomerName = (order, appUsersMap = null) => {
  if (order.notes) {
    const match = order.notes.match(/Customer:\s*([^|]+)/i);
    if (match && match[1].trim()) return match[1].trim();
  }
  if (order.customerId) {
    if (appUsersMap && appUsersMap.has(order.customerId)) {
      const u = appUsersMap.get(order.customerId);
      if (u) return u.name || u.phone || "Customer Walk-in";
    }
  }
  if (order.customerPhone) return order.customerPhone;
  return "Customer Walk-in";
};

const syncAllTenantOrders = async () => {
  console.log("🔄 Starting aggregated orders synchronization...");
  try {
    const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
    let totalSynced = 0;

    const appUsers = await mainPrisma.appUser.findMany();
    const appUsersMap = new Map(appUsers.map(u => [u.id, u]));

    for (const tenant of tenants) {
      try {
        const tenantDb = getTenantClient(tenant.dbUrl);
        const orders = await tenantDb.order.findMany({
          include: { branch: true }
        });

        for (const order of orders) {
          const resolvedFee = (order.feeRate !== undefined && order.feeRate !== null && !isNaN(Number(order.feeRate)))
            ? Number(order.feeRate)
            : resolveTenantFeeRate(tenant, order.source);

          const cName = resolveCustomerName(order, appUsersMap);
          const cPhone = order.customerPhone || (order.customerId ? appUsersMap.get(order.customerId)?.phone : null) || null;

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
              customerName: cName,
              customerPhone: cPhone,
              branchName: order.branch?.name || "Register Terminal",
              feeRate: resolvedFee,
              source: order.source || "pos",
              paymentMethod: order.paymentMethod || null,
              pointsRedeemed: order.pointsRedeemed ?? null,
              staffId: order.staffId || null,
              staffName: order.staffName || null,
              selectedSlot: order.selectedSlot || null,
              selectedSlotDate: order.selectedSlotDate || null,
              createdAt: order.createdAt,
              updatedAt: order.updatedAt,
            },
            update: {
              status: order.status,
              total: order.total,
              notes: order.notes,
              customerName: cName,
              customerPhone: cPhone,
              branchName: order.branch?.name || "Register Terminal",
              feeRate: resolvedFee,
              source: order.source || "pos",
              paymentMethod: order.paymentMethod || null,
              pointsRedeemed: order.pointsRedeemed ?? null,
              staffId: order.staffId || null,
              staffName: order.staffName || null,
              selectedSlot: order.selectedSlot || null,
              selectedSlotDate: order.selectedSlotDate || null,
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

const getCustomerTier = (wallet, tenant = null, customer = null) => {
  if (tenant && Array.isArray(tenant.loyaltyTiers) && tenant.loyaltyTiers.length > 0) {
    const loyaltyService = require("../../tenant/loyalty/loyalty.service");
    const tierObj = loyaltyService.getCustomerTierDetails(customer, wallet, tenant.loyaltyTiers);
    if (tierObj && tierObj.name) return tierObj.name;
  }
  if (wallet && wallet.tier) return wallet.tier;
  const points = wallet?.points || 0;
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
    ];
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const tenants = await mainPrisma.tenant.findMany({ select: { id: true, name: true } });

  const [customers, total] = await Promise.all([
    mainPrisma.appUser.findMany({
      where,
      include: {
        wallets: {
          include: {
            tenant: { select: { id: true, name: true } },
            transactions: {
              orderBy: { createdAt: "asc" }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    mainPrisma.appUser.count({ where }),
  ]);

  return {
    customers: customers.map((c) => {
      const activeWallets = c.wallets || [];
      const primaryWallet = activeWallets[0] || null;
      let tenantName = primaryWallet?.tenant?.name || "Servi Platform";
      let tenantId = primaryWallet?.tenantId || null;
      const totalPoints = activeWallets.reduce((acc, w) => acc + (w.points || 0), 0);

      return {
        id: c.id,
        customerId: c.id,
        tenantId,
        name: c.name || "Unnamed",
        phone: c.phone,
        email: c.email,
        tenantName,
        points: totalPoints,
        wallets: activeWallets.map(w => ({
          tenantId: w.tenantId,
          tenantName: w.tenant?.name || "Global",
          points: w.points,
          tier: getCustomerTier(w)
        })),
        tier: getCustomerTier(primaryWallet),
        joinedAt: c.createdAt,
      };
    }),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getSuperAdminCustomerDetails = async (tenantId, customerId) => {
  const targetTenantId = (tenantId && tenantId !== "null" && tenantId !== "undefined" && tenantId !== "all")
    ? tenantId
    : null;

  const tenant = targetTenantId
    ? await mainPrisma.tenant.findUnique({ where: { id: targetTenantId } })
    : null;

  const customer = await mainPrisma.appUser.findUnique({
    where: { id: customerId }
  });
  if (!customer) throw new ApiError(404, "Customer not found");

  // Fetch all wallets belonging to this customer
  let customerWallets = await mainPrisma.wallet.findMany({
    where: { appUserId: customerId },
    include: {
      tenant: { select: { id: true, name: true } },
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });

  let wallet = null;
  if (targetTenantId) {
    wallet = customerWallets.find((w) => w.tenantId === targetTenantId) || null;
    if (!wallet) {
      try {
        wallet = await mainPrisma.wallet.create({
          data: {
            appUserId: customerId,
            tenantId: targetTenantId,
            points: 0,
            lifetimeEarn: 0,
          },
          include: {
            tenant: { select: { id: true, name: true } },
            transactions: { orderBy: { createdAt: "desc" }, take: 100 },
          },
        });
        customerWallets.push(wallet);
      } catch (e) {
        console.error("Failed to auto-create wallet in customer details:", e.message);
      }
    }
  } else {
    wallet = customerWallets[0] || null;
  }

  // Construct phone variations for flexible matching (+966550505994, 966550505994, 0550505994, 550505994)
  const phoneVariations = [];
  if (customer.phone) {
    const clean = customer.phone.trim().replace(/\s+/g, "");
    const digitsOnly = clean.replace(/\D/g, "");
    const withoutPlus = clean.replace(/^\+/, "");
    const last9 = digitsOnly.length >= 9 ? digitsOnly.slice(-9) : digitsOnly;

    phoneVariations.push(clean, withoutPlus, digitsOnly, `+966${last9}`, `966${last9}`, `0${last9}`, last9);
  }
  const uniquePhones = Array.from(new Set(phoneVariations)).filter(Boolean);

  const rawOrders = [];
  // Determine list of tenants to search: if tenant is specified, search it; otherwise search all active tenants
  const targetTenants = tenant ? [tenant] : await mainPrisma.tenant.findMany();

  for (const t of targetTenants) {
    try {
      const tenantPrisma = getTenantClient(t.dbUrl);
      const OR = [
        { customerId },
        { userId: customerId },
      ];
      if (uniquePhones.length > 0) {
        OR.push({ customerPhone: { in: uniquePhones } });
      }

      const tenantOrders = await tenantPrisma.order.findMany({
        where: { OR },
        include: {
          branch: true,
          items: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      tenantOrders.forEach((o) => {
        rawOrders.push({
          ...o,
          tenantId: t.id,
          tenantName: t.name,
          loyaltyEarnRate: t.loyaltyEarnRate,
        });
      });
    } catch (err) {
      console.error(`Failed to fetch orders from tenant ${t.slug} for customer details:`, err.message);
    }
  }

  const orders = rawOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const visits = orders.map((o) => ({
    id: `v_${o.id}`,
    date: new Date(o.createdAt).toISOString().slice(0, 10),
    branch: o.branch?.name || "Register Terminal",
    city: o.branch?.city || "Riyadh",
  }));

  // Collect transactions for display from database
  let allTransactions = [];
  if (targetTenantId && wallet) {
    allTransactions = wallet.transactions || [];
  } else {
    customerWallets.forEach((w) => {
      if (Array.isArray(w.transactions)) {
        allTransactions.push(...w.transactions);
      }
    });
    allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const ordersMap = new Map();
  orders.forEach((o) => {
    if (o.orderNumber) ordersMap.set(o.orderNumber, o);
    if (o.id) ordersMap.set(o.id, o);
  });

  const seenTxKeys = new Set();
  const pointsHistory = [];

  for (const t of allTransactions) {
    const orderRef = t.orderNumber || t.orderId;
    const key = orderRef ? `${t.walletId}_${orderRef}_${t.points}` : t.id;
    if (seenTxKeys.has(key)) continue;
    seenTxKeys.add(key);

    const desc = (t.description || "").toLowerCase();
    let type = t.points >= 0 ? "earned" : "redeemed";

    if (desc.includes("refund") || desc.includes("reverse")) {
      type = "refunded";
    } else if (desc.includes("gift sent") || desc.includes("transferred to") || desc.includes("transfer out")) {
      type = "transferred";
    } else if (desc.includes("claimed gift") || desc.includes("transferred from") || desc.includes("received gift")) {
      type = "received";
    }

    const linkedOrder = orderRef ? ordersMap.get(orderRef) : null;
    const txDate = linkedOrder?.createdAt || t.createdAt;

    pointsHistory.push({
      id: t.id,
      date: new Date(txDate).toISOString().slice(0, 10),
      type,
      points: Math.abs(t.points),
      rawPoints: t.points,
      reason: t.description || "Loyalty points transaction",
    });
  }

  const orderHistory = orders.map((o) => {
    const earnPointsTx = allTransactions.find(
      (tx) => tx.points > 0 &&
              ((tx.orderNumber && tx.orderNumber === o.orderNumber) ||
               (tx.orderId && tx.orderId === o.id) ||
               (tx.description && tx.description.includes(o.orderNumber)))
    );
    let pointsEarned = 0;
    if ((o.status || "").toUpperCase() === "COMPLETED" && (o.paymentMethod || "").toLowerCase() !== "points") {
      if (earnPointsTx) {
        pointsEarned = Math.abs(earnPointsTx.points);
      }
    }

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      date: new Date(o.createdAt).toISOString().slice(0, 10),
      branch: o.branch?.name || "Register Terminal",
      branchName: o.branch?.name || "Register Terminal",
      tenantName: o.tenantName || tenant?.name || "Servi Platform",
      source: o.source || "pos",
      type: o.type || "DINE_IN",
      status: o.status || "COMPLETED",
      paymentMethod: o.paymentMethod || "cash",
      items: o.items ? o.items.reduce((acc, item) => acc + item.quantity, 0) : 0,
      itemsList: (o.items || []).map((i) => ({
        id: i.id,
        quantity: i.quantity,
        price: Number(i.price || 0),
        name: i.name || "Item",
      })),
      total: Number(o.total || 0),
      pointsEarned,
    };
  });

  const displayPoints = targetTenantId && wallet
    ? (wallet.points || 0)
    : customerWallets.reduce((acc, w) => acc + (w.points || 0), 0);

  return {
    id: customer.id,
    customerId: customer.id,
    tenantId: tenant?.id || null,
    name: customer.name || "Unnamed",
    phone: customer.phone,
    email: customer.email,
    tenantName: tenant?.name || "Servi Platform",
    points: displayPoints,
    wallets: customerWallets.map((w) => ({
      tenantId: w.tenantId,
      tenantName: w.tenant?.name || "Global",
      points: w.points,
      tier: getCustomerTier(w, tenant, customer),
    })),
    tier: getCustomerTier(wallet, tenant, customer),
    joinedAt: customer.createdAt,
    pointsHistory,
    orders: orderHistory,
    visits,
  };
};

const normalizeSaudiPhone = (rawPhone) => {
  if (!rawPhone) return "";
  let digits = rawPhone.toString().trim().replace(/[\s\-\(\)]/g, "");
  if (digits.startsWith("00966")) {
    digits = "+966" + digits.substring(5);
  }
  if (digits.startsWith("+966")) {
    let rest = digits.substring(4);
    if (rest.startsWith("0")) rest = rest.substring(1);
    return "+966" + rest;
  }
  if (digits.startsWith("966")) {
    let rest = digits.substring(3);
    if (rest.startsWith("0")) rest = rest.substring(1);
    return "+966" + rest;
  }
  if (digits.startsWith("0")) {
    digits = digits.substring(1);
  }
  if (/^5\d{8}$/.test(digits)) {
    return "+966" + digits;
  }
  if (!digits.startsWith("+") && digits.length >= 9) {
    return "+966" + digits;
  }
  return digits.startsWith("+") ? digits : `+${digits}`;
};

const addSuperAdminCustomer = async ({ tenantId, name, phone, email, points = 0, tier }) => {
  const targetTenantId = (tenantId && tenantId !== "null" && tenantId !== "undefined" && tenantId !== "all")
    ? tenantId
    : null;

  const tenant = targetTenantId ? await mainPrisma.tenant.findUnique({ where: { id: targetTenantId } }) : null;

  if (!phone) throw new ApiError(400, "Phone number is required");
  const normalizedPhone = normalizeSaudiPhone(phone);

  let customer = await mainPrisma.appUser.findUnique({ where: { phone: normalizedPhone } });
  if (customer) {
    throw new ApiError(400, "Customer with this phone already exists");
  } else {
    customer = await mainPrisma.appUser.create({
      data: { name, phone: normalizedPhone, email },
    });
  }

  // Create/update brand-specific wallet
  let wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: customer.id, tenantId: targetTenantId },
  });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: {
        appUserId: customer.id,
        tenantId: targetTenantId,
        points,
        lifetimeEarn: points,
        tier: tier || "bronze",
      },
    });
  } else {
    const updateData = {};
    if (points > 0) {
      updateData.points = { increment: points };
      updateData.lifetimeEarn = { increment: points };
    }
    if (tier) {
      updateData.tier = tier;
    }
    if (Object.keys(updateData).length > 0) {
      wallet = await mainPrisma.wallet.update({
        where: { id: wallet.id },
        data: updateData,
      });
    }
  }

  if (points > 0) {
    await mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points,
        description: "Starting balance (Admin enrolled)",
        tenantId: targetTenantId,
      },
    });
  }

  return {
    id: customer.id,
    customerId: customer.id,
    tenantId: targetTenantId,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    tenantName: tenant?.name || "Servi Platform",
    points: wallet.points,
    tier: getCustomerTier(wallet),
    joinedAt: customer.createdAt,
  };
};

const bulkUploadSuperAdminCustomers = async ({ tenantId, customers }) => {
  if (!Array.isArray(customers) || customers.length === 0) {
    throw new ApiError(400, "No customer data provided for bulk upload");
  }

  // Resolve target brand(s)
  let targetTenantIds = [];
  if (tenantId && tenantId !== "null" && tenantId !== "undefined" && tenantId !== "all") {
    const tenant = await mainPrisma.tenant.findFirst({
      where: { OR: [{ id: tenantId }, { slug: tenantId }] }
    });
    if (tenant) {
      targetTenantIds = [tenant.id];
    }
  }

  // If no specific brand selected or "all", apply to all active brands
  if (targetTenantIds.length === 0) {
    const activeTenants = await mainPrisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true }
    });
    targetTenantIds = activeTenants.map(t => t.id);
  }

  let createdCount = 0;
  let updatedCount = 0;
  const errors = [];

  for (let i = 0; i < customers.length; i++) {
    const row = customers[i];
    const rowNum = i + 1;
    const name = (row.name || "").trim() || "Unnamed Customer";
    const rawPhone = row.phone || row["phone no"] || row.phone_number || row["phone_number"] || row.mobile || "";

    if (!rawPhone) {
      errors.push(`Row ${rowNum}: Phone number is required`);
      continue;
    }

    const formatSaudiPhone = (raw) => {
      if (!raw) return "";
      let digits = raw.toString().trim().replace(/\D/g, "");
      while (digits.length > 9) {
        if (digits.startsWith("966")) {
          digits = digits.substring(3);
        } else if (digits.startsWith("0")) {
          digits = digits.substring(1);
        } else {
          break;
        }
      }
      if (digits.startsWith("0")) {
        digits = digits.substring(1);
      }
      if (digits.length === 9) {
        return "+966" + digits;
      }
      return raw.toString().startsWith("+") ? raw.toString().trim() : `+${digits}`;
    };

    const normalizedPhone = formatSaudiPhone(rawPhone);
    const points = Math.max(0, Number(row.points) || 0);
    const tier = (row.tier || "bronze").toString().trim().toLowerCase();
    const rawEmail = (row.email || "").trim();
    const email = (rawEmail && rawEmail.includes("@")) ? rawEmail : null;

    try {
      let customer = await mainPrisma.appUser.findUnique({ where: { phone: normalizedPhone } });
      if (!customer) {
        let safeEmail = email;
        if (safeEmail) {
          const existingEmail = await mainPrisma.appUser.findUnique({ where: { email: safeEmail } });
          if (existingEmail) safeEmail = null;
        }
        customer = await mainPrisma.appUser.create({
          data: { name, phone: normalizedPhone, email: safeEmail },
        });
        createdCount++;
      } else {
        if (name && name !== "Unnamed Customer" && customer.name !== name) {
          customer = await mainPrisma.appUser.update({
            where: { id: customer.id },
            data: { name },
          });
        }
        updatedCount++;
      }

      // Create or update brand wallet for each target brand
      for (const tId of targetTenantIds) {
        let wallet = await mainPrisma.wallet.findFirst({
          where: { appUserId: customer.id, tenantId: tId },
        });
        if (!wallet) {
          wallet = await mainPrisma.wallet.create({
            data: {
              appUserId: customer.id,
              tenantId: tId,
              points,
              lifetimeEarn: points,
              tier: tier || "bronze",
            },
          });
        } else {
          const updateData = {};
          if (points > 0) {
            updateData.points = { increment: points };
            updateData.lifetimeEarn = { increment: points };
          }
          if (tier) {
            updateData.tier = tier;
          }
          wallet = await mainPrisma.wallet.update({
            where: { id: wallet.id },
            data: updateData,
          });
        }

        if (points > 0) {
          await mainPrisma.walletTransaction.create({
            data: {
              walletId: wallet.id,
              points,
              description: "Bulk Upload by Super Admin",
              tenantId: tId,
            },
          });
        }
      }
    } catch (err) {
      console.error(`Error processing bulk row ${rowNum}:`, err.message);
      errors.push(`Row ${rowNum} (${name}): ${err.message}`);
    }
  }

  return {
    success: true,
    total: customers.length,
    createdCount,
    updatedCount,
    errors,
    message: `Successfully processed ${createdCount + updatedCount} customers (${createdCount} new accounts created).`,
  };
};

const adjustSuperAdminCustomerPoints = async (tenantId, customerId, { action = "add", mode = "delta", points = 0, tier, reason }) => {
  const customer = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  const targetTenantId = (tenantId && tenantId !== "null" && tenantId !== "undefined" && tenantId !== "all")
    ? tenantId
    : null;

  const tenant = targetTenantId ? await mainPrisma.tenant.findUnique({ where: { id: targetTenantId } }) : null;

  let wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: customer.id, tenantId: targetTenantId },
  });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customer.id, tenantId: targetTenantId, points: 0, lifetimeEarn: 0, tier: tier || "bronze" },
    });
  }

  let deltaPoints = 0;
  let newTotalPoints = wallet.points;

  if (action === "add") {
    deltaPoints = Math.max(0, Number(points) || 0);
    newTotalPoints = wallet.points + deltaPoints;
  } else if (action === "adjust") {
    if (mode === "set") {
      const target = Math.max(0, Number(points) || 0);
      deltaPoints = target - wallet.points;
      newTotalPoints = target;
    } else {
      deltaPoints = Number(points) || 0;
      newTotalPoints = Math.max(0, wallet.points + deltaPoints);
    }
  }

  const updateData = { points: newTotalPoints };
  if (deltaPoints > 0) {
    updateData.lifetimeEarn = { increment: deltaPoints };
  }
  if (tier) {
    updateData.tier = tier;
  }

  wallet = await mainPrisma.wallet.update({
    where: { id: wallet.id },
    data: updateData,
  });

  if (deltaPoints !== 0) {
    await mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points: deltaPoints,
        description: reason || (action === "add" ? "Points added by Super Admin" : "Points adjusted by Super Admin"),
        tenantId: targetTenantId,
      },
    });
  }

  return {
    id: customer.id,
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    tenantName: tenant?.name || "Servi Platform",
    points: wallet.points,
    tier: getCustomerTier(wallet),
  };
};

const deleteSuperAdminCustomer = async (tenantId, customerId) => {
  await mainPrisma.appUser.delete({
    where: { id: customerId }
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
    tenantName: "Servi Platform",
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

const getSuperAdminOrderDetail = async (tenantId, orderId) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Tenant not found");

  let order = null;
  try {
    const tenantPrisma = getTenantClient(tenant.dbUrl);
    order = await tenantPrisma.order.findFirst({
      where: {
        OR: [
          { id: orderId },
          { orderNumber: orderId }
        ]
      },
      include: {
        items: {
          include: {
            menuItem: true
          }
        },
        branch: true,
        user: true,
        customOrderType: true
      }
    });
  } catch (err) {
    console.warn(`[getSuperAdminOrderDetail] Tenant DB query warning: ${err.message}`);
  }

  // Fall back to main database AggregatedOrder if order record was missing from tenant database
  if (!order) {
    const aggOrder = await mainPrisma.aggregatedOrder.findFirst({
      where: {
        tenantId,
        OR: [
          { id: `${tenantId}_${orderId}` },
          { orderId: orderId },
          { orderNumber: orderId }
        ]
      }
    });

    if (aggOrder) {
      order = {
        id: aggOrder.orderId,
        orderNumber: aggOrder.orderNumber,
        status: aggOrder.status,
        type: aggOrder.type,
        total: aggOrder.total,
        notes: aggOrder.notes,
        feeRate: aggOrder.feeRate,
        source: aggOrder.source,
        paymentMethod: aggOrder.paymentMethod,
        createdAt: aggOrder.createdAt,
        updatedAt: aggOrder.updatedAt,
        user: aggOrder.customerName ? { name: aggOrder.customerName, phone: aggOrder.customerPhone } : null,
        branch: aggOrder.branchName ? { name: aggOrder.branchName } : null,
        items: []
      };
    }
  }

  if (!order) throw new ApiError(404, "Order not found");

  // Calculate points earned for this order if COMPLETED and paid via Cash, Card, Apple Pay, etc.
  let pointsEarned = 0;
  const pm = (order.paymentMethod || "").toLowerCase();
  const isPointsPayment = pm === "points" || (order.notes && (order.notes.includes("Paid by Loyalty Points") || order.notes.includes("Points Payment")));

  if (!isPointsPayment && (order.status || "").toUpperCase() === "COMPLETED") {
    const earnTx = await mainPrisma.walletTransaction.findFirst({
      where: {
        points: { gt: 0 },
        OR: [
          { orderId: order.id },
          { orderNumber: order.orderNumber },
          { description: { contains: order.orderNumber } }
        ]
      }
    });

    if (earnTx) {
      pointsEarned = Math.abs(earnTx.points);
    } else if (order.loyaltyEarnRate !== undefined && order.loyaltyEarnRate !== null && Number(order.loyaltyEarnRate) > 0) {
      pointsEarned = Math.floor(Number(order.total || 0) * Number(order.loyaltyEarnRate));
    } else {
      pointsEarned = 0;
    }
  }

  return {
    ...order,
    pointsEarned,
    pointsRedeemed: order.pointsRedeemed ?? (isPointsPayment ? Math.ceil(Number(order.total || 0) * 10) : null),
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      loyaltyEnabled: tenant.loyaltyEnabled ?? true,
      loyaltyEarnRate: Number(tenant.loyaltyEarnRate || 1.0)
    }
  };
};

const getSyncStatus = async ({ startDate, endDate } = {}) => {
  const tenants = await mainPrisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      dbUrl: true,
      lastOrderSyncAt: true
    }
  });

  const dateFilter = {};
  if (startDate || endDate) {
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
  }

  const statusList = [];
  for (const tenant of tenants) {
    let tenantOrdersCount = 0;
    let isOnline = true;
    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      const where = {};
      if (startDate || endDate) {
        where.createdAt = dateFilter;
      }
      tenantOrdersCount = await tenantPrisma.order.count({ where });
    } catch (err) {
      console.error(`Failed to connect or query orders for tenant ${tenant.name}:`, err.message);
      isOnline = false;
    }

    const aggWhere = { tenantId: tenant.id };
    if (startDate || endDate) {
      aggWhere.createdAt = dateFilter;
    }
    const aggregatedOrdersCount = await mainPrisma.aggregatedOrder.count({
      where: aggWhere
    });

    statusList.push({
      id: tenant.id,
      name: tenant.name,
      lastOrderSyncAt: tenant.lastOrderSyncAt,
      tenantOrdersCount: isOnline ? tenantOrdersCount : null,
      aggregatedOrdersCount,
      isOnline
    });
  }

  return statusList;
};

const syncTenantOrders = async (tenantId) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Tenant not found");

  const tenantDb = getTenantClient(tenant.dbUrl);
  const orders = await tenantDb.order.findMany({
    include: { user: true, branch: true }
  });

  const tenantOrderIds = orders.map((o) => o.id);

  // Delete stale aggregated orders in the main DB that do not exist in the tenant DB anymore
  await mainPrisma.aggregatedOrder.deleteMany({
    where: {
      tenantId: tenant.id,
      orderId: { notIn: tenantOrderIds }
    }
  });

  // Also keep the main Order table aligned
  await mainPrisma.order.deleteMany({
    where: {
      tenantId: tenant.id,
      id: { notIn: tenantOrderIds }
    }
  });

  const appUsers = await mainPrisma.appUser.findMany();
  const appUsersMap = new Map(appUsers.map(u => [u.id, u]));

  let syncedCount = 0;
  for (const order of orders) {
    const cName = resolveCustomerName(order, appUsersMap);
    const cPhone = order.customerPhone || (order.customerId ? appUsersMap.get(order.customerId)?.phone : null) || null;
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
        customerName: cName,
        customerPhone: cPhone,
        branchName: order.branch?.name || "Register Terminal",
        feeRate: order.feeRate || 0.0,
        source: order.source || "pos",
        paymentMethod: order.paymentMethod || null,
        pointsRedeemed: order.pointsRedeemed ?? null,
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      update: {
        status: order.status,
        total: order.total,
        notes: order.notes,
        customerName: cName,
        customerPhone: cPhone,
        branchName: order.branch?.name || "Register Terminal",
        feeRate: order.feeRate || 0.0,
        source: order.source || "pos",
        paymentMethod: order.paymentMethod || null,
        pointsRedeemed: order.pointsRedeemed ?? null,
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        updatedAt: order.updatedAt,
      }
    });
    syncedCount++;
  }

  const syncDate = new Date();
  await mainPrisma.tenant.update({
    where: { id: tenant.id },
    data: { lastOrderSyncAt: syncDate }
  });

  return {
    syncedCount,
    lastOrderSyncAt: syncDate
  };
};

const toggleSlot = async (tenantId, serviceType, slotIndex, active, deviceId) => {
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Tenant not found");

  const isBoolActive = active === true || active === "true";

  const qtyKeyMap = {
    pos: "posQuantity",
    qr_table: "qrTableQuantity",
    qr_cashier: "qrCashierQuantity",
    kds: "kdsQuantity",
    cds: "cdsQuantity",
    branch: "branchLimit",
  };

  const fieldKey = qtyKeyMap[serviceType?.toLowerCase()];
  if (!fieldKey) return { tenantId, serviceType, slotIndex, active: isBoolActive };

  const currentQty = Number(tenant[fieldKey] || 1);
  let newQty = currentQty;

  if (!isBoolActive && currentQty > 0) {
    newQty = Math.max(0, currentQty - 1);
  } else if (isBoolActive) {
    newQty = currentQty + 1;
  }

  const flagKeyMap = {
    pos: "subPos",
    qr_table: "subQrTable",
    qr_cashier: "subQrCashier",
    kds: "subKds",
    cds: "subCds",
    branch: "subBranch",
  };

  const subFlagKey = flagKeyMap[serviceType?.toLowerCase()];
  const updateData = { [fieldKey]: newQty };
  if (subFlagKey) {
    updateData[subFlagKey] = newQty > 0;
  }

  await mainPrisma.tenant.update({
    where: { id: tenantId },
    data: updateData,
  });

  // Also update physical hardware device isActive status if assigned
  if (tenant.dbUrl && (deviceId || slotIndex)) {
    try {
      const tenantPrisma = getTenantClient(tenant.dbUrl);
      const sType = serviceType?.toLowerCase();
      
      let targetDeviceId = deviceId;
      if (!targetDeviceId) {
        if (sType === "pos") {
          const dev = await tenantPrisma.posDevice.findMany({ orderBy: { createdAt: "asc" } });
          if (dev[slotIndex - 1]) targetDeviceId = dev[slotIndex - 1].id;
        } else if (sType === "kds") {
          const dev = await tenantPrisma.kdsDevice.findMany({ orderBy: { createdAt: "asc" } });
          if (dev[slotIndex - 1]) targetDeviceId = dev[slotIndex - 1].id;
        } else if (sType === "qr_table") {
          const dev = await tenantPrisma.table.findMany({ orderBy: { createdAt: "asc" } });
          if (dev[slotIndex - 1]) targetDeviceId = dev[slotIndex - 1].id;
        } else if (sType === "qr_cashier") {
          const dev = await tenantPrisma.qrCashier.findMany({ orderBy: { createdAt: "asc" } });
          if (dev[slotIndex - 1]) targetDeviceId = dev[slotIndex - 1].id;
        }
      }

      if (targetDeviceId) {
        if (sType === "pos") {
          await tenantPrisma.posDevice.update({ where: { id: targetDeviceId }, data: { isActive: isBoolActive } }).catch((err) => console.error("Error updating posDevice isActive:", err.message));
        } else if (sType === "kds") {
          await tenantPrisma.kdsDevice.update({ where: { id: targetDeviceId }, data: { isActive: isBoolActive } }).catch((err) => console.error("Error updating kdsDevice isActive:", err.message));
        } else if (sType === "qr_table") {
          await tenantPrisma.table.update({ where: { id: targetDeviceId }, data: { isActive: isBoolActive } }).catch((err) => console.error("Error updating table isActive:", err.message));
        } else if (sType === "qr_cashier") {
          await tenantPrisma.qrCashier.update({ where: { id: targetDeviceId }, data: { isActive: isBoolActive } }).catch((err) => console.error("Error updating qrCashier isActive:", err.message));
        }
      }
    } catch (err) {
      console.error("[TOGGLE SLOT] Failed to update tenant device isActive:", err.message);
    }
  }

  return {
    tenantId,
    serviceType,
    slotIndex,
    active: isBoolActive,
    previousQuantity: currentQty,
    newQuantity: newQty,
  };
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
  getSuperAdminOrderDetail,
  syncAllTenantOrders,
  getSuperAdminCustomers,
  getSuperAdminCustomerDetails,
  addSuperAdminCustomer,
  deleteSuperAdminCustomer,
  bulkUploadSuperAdminCustomers,
  adjustSuperAdminCustomerPoints,
  getTenantUsers,
  getAllSystemUsers,
  getSyncStatus,
  syncTenantOrders,
  toggleSlot,
};

