const mainPrisma = require("../src/config/prisma");
const walletService = require("../src/app/wallet/wallet.service");
const tenantsService = require("../src/web/admin/tenants/tenants.service");

async function seedAllPointsHistoryTypes() {
  console.log("🌱 Seeding all 4 Points History Types (earned, transferred, received, redeemed)...\n");

  const bk = await mainPrisma.tenant.findFirst({ where: { slug: "burgerking" } });

  // 1. Get customer Faisal
  const faisal = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555123456" },
        { phone: "966555123456" }
      ]
    }
  });

  // 2. Get customer Omar
  const omar = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555987654" },
        { phone: "966555987654" }
      ]
    }
  });

  if (!faisal || !omar) {
    console.error("❌ Customer Faisal or Omar not found!");
    process.exit(1);
  }

  // Ensure wallets exist
  const faisalWallet = await mainPrisma.wallet.findUnique({ where: { appUserId: faisal.id } });
  const omarWallet = await mainPrisma.wallet.findUnique({ where: { appUserId: omar.id } });

  // Step A: Ensure Faisal has enough points
  if (faisalWallet.points < 200) {
    await mainPrisma.wallet.update({
      where: { id: faisalWallet.id },
      data: { points: { increment: 200 }, lifetimeEarn: { increment: 200 } }
    });
  }

  if (omarWallet.points < 200) {
    await mainPrisma.wallet.update({
      where: { id: omarWallet.id },
      data: { points: { increment: 200 }, lifetimeEarn: { increment: 200 } }
    });
  }

  // Step B: Faisal sends 50 points to Omar -> 'transferred' type for Faisal
  console.log("1️⃣ Creating 'transferred' points transaction (Faisal -> Omar)...");
  await walletService.transferPoints(null, bk.id, faisal.id, {
    recipientPhone: omar.phone,
    points: 50,
    message: "Enjoy coffee on me!"
  });

  // Step C: Omar sends 60 points to Faisal & Faisal claims it -> 'received' type for Faisal
  console.log("2️⃣ Creating 'received' points transaction (Omar -> Faisal)...");
  await walletService.transferPoints(null, bk.id, omar.id, {
    recipientPhone: "966555123456",
    points: 60,
    message: "Thanks! Here are points back for lunch!"
  });

  const omarGifts = await walletService.getGifts(null, faisal.id);
  const giftToClaim = omarGifts.find(g => !g.claimed);

  if (giftToClaim) {
    await walletService.claimGift(null, bk.id, faisal.id, giftToClaim.id);
  }

  // Step D: Create a 'redeemed' points transaction for Faisal
  console.log("3️⃣ Creating 'redeemed' points transaction for Faisal...");
  await mainPrisma.walletTransaction.create({
    data: {
      walletId: faisalWallet.id,
      points: -40,
      description: "Redeemed 40 points for free dessert on Order SRV-551291",
      tenantId: bk.id
    }
  });

  await mainPrisma.wallet.update({
    where: { id: faisalWallet.id },
    data: { points: { decrement: 40 } }
  });

  // Step E: Fetch Faisal's Points History via Super Admin service
  const faisalDetails = await tenantsService.getSuperAdminCustomerDetails(bk.id, faisal.id);

  console.log("\n========================================================");
  console.log(`📜 ALL POINTS HISTORY TYPES FOR ${faisal.name.toUpperCase()}`);
  console.log("========================================================");
  console.table(faisalDetails.pointsHistory.slice(0, 10));

  console.log("\n✨ All 4 points history types (earned, transferred, received, redeemed) seeded & verified!");
}

seedAllPointsHistoryTypes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Points history seed failed:", err);
    process.exit(1);
  });
