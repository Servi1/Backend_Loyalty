const mainPrisma = require("../src/config/prisma");
const walletService = require("../src/app/wallet/wallet.service");
const tenantsService = require("../src/web/admin/tenants/tenants.service");

async function testLoyaltyTransfer() {
  console.log("🧪 Testing Peer-to-Peer Loyalty Points Transfer...\n");

  const bk = await mainPrisma.tenant.findFirst({ where: { slug: "burgerking" } });

  // 1. Get sender customer (Faisal)
  const sender = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555123456" },
        { phone: "966555123456" },
        { name: { contains: "Faisal" } }
      ]
    }
  });

  if (!sender) {
    console.error("❌ Sender customer (Faisal) not found!");
    process.exit(1);
  }

  // 2. Find or create recipient customer (Omar)
  let recipient = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555987654" },
        { phone: "966555987654" }
      ]
    }
  });

  if (!recipient) {
    recipient = await mainPrisma.appUser.create({
      data: {
        phone: "+966555987654",
        name: "Omar Recipient Customer",
        email: "omar.test@burgerking.com"
      }
    });
  }

  let recipientWallet = await mainPrisma.wallet.findUnique({ where: { appUserId: recipient.id } });
  if (!recipientWallet) {
    recipientWallet = await mainPrisma.wallet.create({
      data: { appUserId: recipient.id, points: 0, lifetimeEarn: 0 }
    });
  }

  // Fetch initial wallets
  const senderWalletInitial = await walletService.getWallet(null, sender.id);
  const recipientWalletInitial = await walletService.getWallet(null, recipient.id);

  console.log(`👤 Sender: ${sender.name} (${sender.phone}) | Initial Balance: ${senderWalletInitial.points} pts`);
  console.log(`👤 Recipient: ${recipient.name} (${recipient.phone}) | Initial Balance: ${recipientWalletInitial.points} pts\n`);

  const pointsToTransfer = 100;
  console.log(`🎁 Initiating transfer of ${pointsToTransfer} points from ${sender.name} to ${recipient.phone}...`);

  // 3. Initiate Transfer
  await walletService.transferPoints(
    null,
    bk.id,
    sender.id,
    {
      recipientPhone: recipient.phone,
      points: pointsToTransfer,
      message: "Enjoy your treat points!"
    }
  );

  console.log(`✅ Transfer created! Fetching pending gifts for ${recipient.name}...`);

  // 4. Recipient fetches pending gifts
  const gifts = await walletService.getGifts(null, recipient.id);
  const pendingGift = gifts.find(g => !g.claimed);

  if (!pendingGift) {
    console.error("❌ Pending gift not found for recipient!");
    process.exit(1);
  }

  console.log(`📥 Claiming gift ID (${pendingGift.id}) of ${pendingGift.points} pts for recipient ${recipient.name}...`);
  await walletService.claimGift(null, bk.id, recipient.id, pendingGift.id);
  console.log(`🎉 Gift claimed successfully!`);

  // 5. Verify updated balances
  const senderWalletFinal = await walletService.getWallet(null, sender.id);
  const recipientWalletFinal = await walletService.getWallet(null, recipient.id);

  console.log("\n========================================================");
  console.log("📊 POST-TRANSFER WALLET BALANCES SUMMARY");
  console.log("========================================================");
  console.log(`👤 Sender (${sender.name}): ${senderWalletInitial.points} pts ➔ ${senderWalletFinal.points} pts (-${pointsToTransfer} pts)`);
  console.log(`👤 Recipient (${recipient.name}): ${recipientWalletInitial.points} pts ➔ ${recipientWalletFinal.points} pts (+${pointsToTransfer} pts)`);

  // 6. Inspect Points History via tenants.service (Super Admin view)
  const senderHistory = await tenantsService.getSuperAdminCustomerDetails(bk.id, sender.id);
  const recipientHistory = await tenantsService.getSuperAdminCustomerDetails(bk.id, recipient.id);

  console.log(`\n📜 Sender (${sender.name}) Points History (Latest 3):`);
  console.table(senderHistory.pointsHistory.slice(0, 3));

  console.log(`\n📜 Recipient (${recipient.name}) Points History (Latest 3):`);
  console.table(recipientHistory.pointsHistory.slice(0, 3));

  console.log("\n✨ Loyalty points transfer test completed successfully!");
}

testLoyaltyTransfer()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Transfer test failed:", err);
    process.exit(1);
  });
