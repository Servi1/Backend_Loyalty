const mainPrisma = require("../../config/prisma");
const { getTenantClient } = require("../../config/tenantManager");

/**
 * Determine customer tier based on points.
 */
const getTier = (points) => {
  if (points >= 3000) return "gold";
  if (points >= 1000) return "silver";
  return "bronze";
};

/**
 * Sync a customer to the main aggregated customer database.
 */
const syncToAggregatedCustomer = async (db, tenantId, userId) => {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!user || user.role !== "CUSTOMER") return;

    const points = user.wallet?.points || 0;
    const tier = getTier(points);

    await mainPrisma.aggregatedCustomer.upsert({
      where: {
        tenantId_customerId: {
          tenantId,
          customerId: userId,
        },
      },
      create: {
        id: `${tenantId}_${userId}`,
        tenantId,
        customerId: userId,
        name: user.name || "Walk-in Customer",
        phone: user.phone || null,
        email: user.email || null,
        points,
        tier,
        joinedAt: user.createdAt,
      },
      update: {
        name: user.name || "Walk-in Customer",
        phone: user.phone || null,
        email: user.email || null,
        points,
        tier,
        updatedAt: new Date(),
      },
    });

    // Global sync across all brands if customer has identifier
    if (user.phone || user.email) {
      const siblingMatches = await mainPrisma.aggregatedCustomer.findMany({
        where: {
          OR: [
            user.phone ? { phone: user.phone } : null,
            user.email ? { email: user.email } : null,
          ].filter(Boolean),
          NOT: {
            tenantId,
            customerId: userId,
          },
        },
        include: { tenant: true }
      });

      for (const sibling of siblingMatches) {
        try {
          await mainPrisma.aggregatedCustomer.update({
            where: { id: sibling.id },
            data: { points, tier, updatedAt: new Date() }
          });

          const siblingDb = getTenantClient(sibling.tenant.dbUrl);
          await siblingDb.wallet.updateMany({
            where: { userId: sibling.customerId },
            data: { points }
          });
        } catch (siblingErr) {
          console.error(`Failed to propagate loyalty points to sibling tenant ${sibling.tenantId}:`, siblingErr.message);
        }
      }
    }
  } catch (err) {
    console.error(`Failed to sync customer ${userId} to super admin aggregated registry:`, err.message);
  }
};

/**
 * Backfill and synchronize all customer records across all active tenants.
 */
const syncAllTenantCustomers = async () => {
  console.log("🔄 Starting aggregated customers synchronization...");
  try {
    const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
    let totalSync = 0;

    for (const tenant of tenants) {
      try {
        const tenantPrisma = getTenantClient(tenant.dbUrl);
        const customers = await tenantPrisma.user.findMany({
          where: { role: "CUSTOMER" },
          include: { wallet: true },
        });

        for (const customer of customers) {
          const points = customer.wallet?.points || 0;
          const tier = getTier(points);

          await mainPrisma.aggregatedCustomer.upsert({
            where: {
              tenantId_customerId: {
                tenantId: tenant.id,
                customerId: customer.id,
              },
            },
            create: {
              id: `${tenant.id}_${customer.id}`,
              tenantId: tenant.id,
              customerId: customer.id,
              name: customer.name || "Walk-in Customer",
              phone: customer.phone || null,
              email: customer.email || null,
              points,
              tier,
              joinedAt: customer.createdAt,
            },
            update: {
              name: customer.name || "Walk-in Customer",
              phone: customer.phone || null,
              email: customer.email || null,
              points,
              tier,
              updatedAt: new Date(),
            },
          });
          totalSync++;
        }
      } catch (err) {
        console.error(`Failed to sync customers for tenant ${tenant.name}:`, err.message);
      }
    }

    console.log(`✅ Synchronized ${totalSync} customers across all tenants.`);
  } catch (err) {
    console.error("Error during aggregated customers synchronization:", err.message);
  }
};

module.exports = {
  syncToAggregatedCustomer,
  syncAllTenantCustomers,
};
