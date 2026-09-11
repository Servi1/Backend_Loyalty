const mainPrisma = require('../src/config/prisma');
const { getTenantClient } = require('../src/config/tenantManager');

async function cleanAllData() {
  console.log("🧹 Starting full database cleanup (keeping Super Admin only)...");

  // 1. Inspect Super Admin accounts to preserve
  const superAdmins = await mainPrisma.superAdmin.findMany();
  console.log(`\n👑 Found ${superAdmins.length} Super Admin account(s):`);
  superAdmins.forEach(sa => console.log(`   - ID: ${sa.id} | Email: ${sa.email} | Name: ${sa.name || 'N/A'}`));

  if (superAdmins.length === 0) {
    console.error("⚠️ WARNING: No SuperAdmin found in main database! Aborting wipe to prevent locking out admin.");
    return;
  }

  // 2. Fetch all Tenants to wipe their isolated tenant DBs
  const tenants = await mainPrisma.tenant.findMany();
  console.log(`\n🏢 Found ${tenants.length} Tenant(s) in main database.`);

  for (const tenant of tenants) {
    console.log(`\n🗑️ Wiping isolated DB for Tenant "${tenant.name}" (${tenant.slug})...`);
    try {
      const tenantDb = getTenantClient(tenant.dbUrl);
      
      // Wipe tenant DB tables in safe order (child tables first)
      await tenantDb.orderItem.deleteMany().catch(e => console.log("   - OrderItem delete error:", e.message));
      await tenantDb.order.deleteMany().catch(e => console.log("   - Order delete error:", e.message));
      await tenantDb.staffSchedule.deleteMany().catch(e => console.log("   - StaffSchedule delete error:", e.message));
      await tenantDb.modifierOption.deleteMany().catch(e => console.log("   - ModifierOption delete error:", e.message));
      await tenantDb.modifierGroup.deleteMany().catch(e => console.log("   - ModifierGroup delete error:", e.message));
      await tenantDb.menuItem.deleteMany().catch(e => console.log("   - MenuItem delete error:", e.message));
      await tenantDb.menuCategory.deleteMany().catch(e => console.log("   - MenuCategory delete error:", e.message));
      await tenantDb.cashDrawerSession.deleteMany().catch(e => console.log("   - CashDrawerSession delete error:", e.message));
      await tenantDb.posDevice.deleteMany().catch(e => console.log("   - PosDevice delete error:", e.message));
      await tenantDb.table.deleteMany().catch(e => console.log("   - Table delete error:", e.message));
      await tenantDb.stockMovement.deleteMany().catch(e => console.log("   - StockMovement delete error:", e.message));
      await tenantDb.inventoryItem.deleteMany().catch(e => console.log("   - InventoryItem delete error:", e.message));
      await tenantDb.warehouse.deleteMany().catch(e => console.log("   - Warehouse delete error:", e.message));
      await tenantDb.user.deleteMany().catch(e => console.log("   - User delete error:", e.message));
      await tenantDb.branch.deleteMany().catch(e => console.log("   - Branch delete error:", e.message));
      await tenantDb.customPaymentType.deleteMany().catch(e => console.log("   - CustomPaymentType delete error:", e.message));
      await tenantDb.customOrderType.deleteMany().catch(e => console.log("   - CustomOrderType delete error:", e.message));
      await tenantDb.customRole.deleteMany().catch(e => console.log("   - CustomRole delete error:", e.message));
      await tenantDb.receiptSetup.deleteMany().catch(e => console.log("   - ReceiptSetup delete error:", e.message));
      await tenantDb.zatcaConfig.deleteMany().catch(e => console.log("   - ZatcaConfig delete error:", e.message));

      console.log(`   ✅ Wiped tenant DB for "${tenant.name}" successfully.`);
    } catch (err) {
      console.error(`   ❌ Failed to wipe tenant DB for "${tenant.name}":`, err.message);
    }
  }

  // 3. Wipe Main Database tables (except SuperAdmin & SuperAdminRole)
  console.log("\n🗑️ Wiping Main Database tables...");
  
  await mainPrisma.aggregatedOrder.deleteMany();
  console.log("   - AggregatedOrder deleted");
  
  await mainPrisma.tenantSlotAddon.deleteMany();
  console.log("   - TenantSlotAddon deleted");
  
  await mainPrisma.globalSpinItem.deleteMany();
  console.log("   - GlobalSpinItem deleted");
  
  await mainPrisma.gift.deleteMany();
  console.log("   - Gift deleted");
  
  await mainPrisma.cartItem.deleteMany();
  console.log("   - CartItem deleted");
  
  await mainPrisma.earnedCoupon.deleteMany();
  console.log("   - EarnedCoupon deleted");
  
  await mainPrisma.walletTransaction.deleteMany();
  console.log("   - WalletTransaction deleted");
  
  await mainPrisma.wallet.deleteMany();
  console.log("   - Wallet deleted");
  
  await mainPrisma.order.deleteMany();
  console.log("   - Order deleted");
  
  await mainPrisma.otp.deleteMany();
  console.log("   - Otp deleted");
  
  await mainPrisma.broadcastNotification.deleteMany();
  console.log("   - BroadcastNotification deleted");
  
  await mainPrisma.appUser.deleteMany();
  console.log("   - AppUser deleted");
  
  await mainPrisma.tenant.deleteMany();
  console.log("   - Tenant deleted");

  console.log("\n✨ Database cleanup complete! Only Super Admin remains.");
  const remainingSuperAdmins = await mainPrisma.superAdmin.findMany();
  console.log(`👑 Preserved Super Admin count: ${remainingSuperAdmins.length}`);
}

cleanAllData().catch(console.error).finally(() => mainPrisma.$disconnect());
