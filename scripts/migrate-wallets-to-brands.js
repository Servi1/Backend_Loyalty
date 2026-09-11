const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const mainPrisma = new MainPrismaClient();

async function migrateWalletsToBrands() {
  console.log("=== Starting Loyalty Wallets Migration to Brand-Specific Wallets ===");

  try {
    // 1. Fetch all transactions that have a tenantId
    const transactions = await mainPrisma.walletTransaction.findMany({
      where: { tenantId: { not: null } },
      include: {
        wallet: true,
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(`Found ${transactions.length} transactions linked to specific tenants.`);

    // Map to group points by (appUserId, tenantId)
    const walletMap = new Map();

    for (const tx of transactions) {
      if (!tx.wallet || !tx.wallet.appUserId || !tx.tenantId) continue;
      const appUserId = tx.wallet.appUserId;
      const tenantId = tx.tenantId;
      const key = `${appUserId}_${tenantId}`;

      if (!walletMap.has(key)) {
        walletMap.set(key, { appUserId, tenantId, points: 0, lifetimeEarn: 0 });
      }

      const record = walletMap.get(key);
      record.points += tx.points;
      if (tx.points > 0) {
        record.lifetimeEarn += tx.points;
      }
    }

    console.log(`Processing ${walletMap.size} brand-specific customer wallets...`);

    let createdCount = 0;
    let updatedCount = 0;

    for (const [key, data] of walletMap.entries()) {
      const safePoints = Math.max(0, data.points);

      const existing = await mainPrisma.wallet.findFirst({
        where: { appUserId: data.appUserId, tenantId: data.tenantId },
      });

      if (!existing) {
        const newWallet = await mainPrisma.wallet.create({
          data: {
            appUserId: data.appUserId,
            tenantId: data.tenantId,
            points: safePoints,
            lifetimeEarn: data.lifetimeEarn,
          },
        });

        // Re-link transactions for this tenant to the new brand wallet
        await mainPrisma.walletTransaction.updateMany({
          where: {
            tenantId: data.tenantId,
            wallet: { appUserId: data.appUserId },
          },
          data: { walletId: newWallet.id },
        });

        createdCount++;
      } else {
        await mainPrisma.wallet.update({
          where: { id: existing.id },
          data: {
            points: safePoints,
            lifetimeEarn: Math.max(existing.lifetimeEarn, data.lifetimeEarn),
          },
        });
        updatedCount++;
      }
    }

    console.log(`✅ Migration Complete! Created ${createdCount} brand wallets, updated ${updatedCount} wallets.`);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
  } finally {
    await mainPrisma.$disconnect();
  }
}

migrateWalletsToBrands();
