const mainPrisma = require('../src/config/prisma');
const { PrismaClient: TenantPrismaClient } = require('@prisma/client-tenant');
const ordersService = require('../src/app/orders/orders.service');

async function main() {
  console.log("Starting Rating Aggregation Test...");

  // 1. Get first tenant
  const tenant = await mainPrisma.tenant.findFirst();
  if (!tenant) {
    console.error("No tenants found in main database!");
    return;
  }
  console.log(`Using Tenant: ${tenant.name} (${tenant.slug})`);

  const tenantPrisma = new TenantPrismaClient({
    datasources: { db: { url: tenant.dbUrl } }
  });

  try {
    // 2. Find or create a staff user in the tenant database
    let staff = await tenantPrisma.user.findFirst({
      where: {
        role: { in: ["BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"] }
      }
    });

    if (!staff) {
      console.log("No staff found in tenant DB, creating a temporary test staff...");
      staff = await tenantPrisma.user.create({
        data: {
          name: "Test Staff Member",
          role: "WAITER",
          rating: 5.0,
          ratingCount: 0
        }
      });
    }

    // 3. Find or create a branch
    let branch = await tenantPrisma.branch.findFirst();
    if (!branch) {
      console.log("No branch found in tenant DB, creating a temporary test branch...");
      branch = await tenantPrisma.branch.create({
        data: {
          name: "Test Branch Location",
          rating: 4.8,
          ratingCount: 0
        }
      });
    }

    // Ensure staff belongs to this branch for consistency (optional)
    await tenantPrisma.user.update({
      where: { id: staff.id },
      data: { branchId: branch.id }
    });

    // 4. Find or create a completed order for a central user
    // We need a customer (AppUser) in the main database
    let appUser = await mainPrisma.appUser.findFirst();
    if (!appUser) {
      console.log("No AppUser found in main DB, creating a temporary test appUser...");
      appUser = await mainPrisma.appUser.create({
        data: {
          phone: "+15550199",
          name: "Test Customer"
        }
      });
    }

    // Let's create a completed order in both main and tenant DB
    const orderId = "test-order-rating-id";
    const orderNumber = "TST-RATING";

    // Clean up any existing test order first
    await tenantPrisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
    await tenantPrisma.order.delete({ where: { id: orderId } }).catch(() => {});
    await mainPrisma.order.delete({ where: { id: orderId } }).catch(() => {});

    console.log("Creating test orders in main and tenant DBs...");
    await mainPrisma.order.create({
      data: {
        id: orderId,
        orderNumber,
        status: "COMPLETED",
        tenantId: tenant.id,
        branchId: branch.id,
        appUserId: appUser.id,
        staffId: staff.id,
        staffName: staff.name
      }
    });

    await tenantPrisma.order.create({
      data: {
        id: orderId,
        orderNumber,
        status: "COMPLETED",
        branchId: branch.id,
        customerId: appUser.id,
        staffId: staff.id,
        staffName: staff.name
      }
    });

    // Reset branch and staff rating/ratingCount for predictable testing
    console.log("Resetting branch and staff ratings to defaults...");
    const initialBranch = await tenantPrisma.branch.update({
      where: { id: branch.id },
      data: { rating: 4.8, ratingCount: 0 }
    });
    const initialStaff = await tenantPrisma.user.update({
      where: { id: staff.id },
      data: { rating: 5.0, ratingCount: 0 }
    });

    console.log(`Initial Branch Rating: ${initialBranch.rating} (count: ${initialBranch.ratingCount})`);
    console.log(`Initial Staff Rating: ${initialStaff.rating} (count: ${initialStaff.ratingCount})`);

    // --- TEST 1: Submit First Review ---
    console.log("\n--- TEST 1: Submitting First Review (Branch: 5, Staff: 4) ---");
    await ordersService.submitReview(tenantPrisma, orderId, appUser.id, {
      rating: 5,
      comment: "Excellent branch!",
      staffRating: 4,
      staffComment: "Good waiter."
    });

    let updatedBranch = await tenantPrisma.branch.findUnique({ where: { id: branch.id } });
    let updatedStaff = await tenantPrisma.user.findUnique({ where: { id: staff.id } });

    console.log(`Updated Branch Rating: ${updatedBranch.rating} (count: ${updatedBranch.ratingCount})`);
    console.log(`Updated Staff Rating: ${updatedStaff.rating} (count: ${updatedStaff.ratingCount})`);

    if (updatedBranch.ratingCount !== 1 || updatedBranch.rating !== 5.0) {
      throw new Error(`Test 1 Failed for Branch! Expected count 1 and rating 5.0, got count ${updatedBranch.ratingCount} and rating ${updatedBranch.rating}`);
    }
    if (updatedStaff.ratingCount !== 1 || updatedStaff.rating !== 4.0) {
      throw new Error(`Test 1 Failed for Staff! Expected count 1 and rating 4.0, got count ${updatedStaff.ratingCount} and rating ${updatedStaff.rating}`);
    }
    console.log("Test 1 Passed successfully!");

    // --- TEST 2: Update Review ---
    console.log("\n--- TEST 2: Updating Review (Branch: 3, Staff: 2) ---");
    await ordersService.submitReview(tenantPrisma, orderId, appUser.id, {
      rating: 3,
      comment: "Actually, branch was average.",
      staffRating: 2,
      staffComment: "Waiter was slow."
    });

    updatedBranch = await tenantPrisma.branch.findUnique({ where: { id: branch.id } });
    updatedStaff = await tenantPrisma.user.findUnique({ where: { id: staff.id } });

    console.log(`Updated Branch Rating: ${updatedBranch.rating} (count: ${updatedBranch.ratingCount})`);
    console.log(`Updated Staff Rating: ${updatedStaff.rating} (count: ${updatedStaff.ratingCount})`);

    if (updatedBranch.ratingCount !== 1 || updatedBranch.rating !== 3.0) {
      throw new Error(`Test 2 Failed for Branch! Expected count 1 and rating 3.0, got count ${updatedBranch.ratingCount} and rating ${updatedBranch.rating}`);
    }
    if (updatedStaff.ratingCount !== 1 || updatedStaff.rating !== 2.0) {
      throw new Error(`Test 2 Failed for Staff! Expected count 1 and rating 2.0, got count ${updatedStaff.ratingCount} and rating ${updatedStaff.rating}`);
    }
    console.log("Test 2 Passed successfully!");

    // --- TEST 3: Add another review (using a second completed order) ---
    console.log("\n--- TEST 3: Submitting Review for Second Order (Branch: 4, Staff: 5) ---");
    const orderId2 = "test-order-rating-id-2";
    const orderNumber2 = "TST-RATING2";

    await mainPrisma.order.create({
      data: {
        id: orderId2,
        orderNumber: orderNumber2,
        status: "COMPLETED",
        tenantId: tenant.id,
        branchId: branch.id,
        appUserId: appUser.id,
        staffId: staff.id,
        staffName: staff.name
      }
    });

    await tenantPrisma.order.create({
      data: {
        id: orderId2,
        orderNumber: orderNumber2,
        status: "COMPLETED",
        branchId: branch.id,
        customerId: appUser.id,
        staffId: staff.id,
        staffName: staff.name
      }
    });

    await ordersService.submitReview(tenantPrisma, orderId2, appUser.id, {
      rating: 4,
      comment: "Nice",
      staffRating: 5,
      staffComment: "Awesome"
    });

    updatedBranch = await tenantPrisma.branch.findUnique({ where: { id: branch.id } });
    updatedStaff = await tenantPrisma.user.findUnique({ where: { id: staff.id } });

    console.log(`Final Branch Rating: ${updatedBranch.rating} (count: ${updatedBranch.ratingCount})`);
    console.log(`Final Staff Rating: ${updatedStaff.rating} (count: ${updatedStaff.ratingCount})`);

    // Expected Branch Average: (3.0 * 1 + 4.0) / 2 = 3.5
    // Expected Staff Average: (2.0 * 1 + 5.0) / 2 = 3.5
    if (updatedBranch.ratingCount !== 2 || updatedBranch.rating !== 3.5) {
      throw new Error(`Test 3 Failed for Branch! Expected count 2 and rating 3.5, got count ${updatedBranch.ratingCount} and rating ${updatedBranch.rating}`);
    }
    if (updatedStaff.ratingCount !== 2 || updatedStaff.rating !== 3.5) {
      throw new Error(`Test 3 Failed for Staff! Expected count 2 and rating 3.5, got count ${updatedStaff.ratingCount} and rating ${updatedStaff.rating}`);
    }
    console.log("Test 3 Passed successfully!");

    // Clean up test orders
    await tenantPrisma.order.delete({ where: { id: orderId } }).catch(() => {});
    await mainPrisma.order.delete({ where: { id: orderId } }).catch(() => {});
    await tenantPrisma.order.delete({ where: { id: orderId2 } }).catch(() => {});
    await mainPrisma.order.delete({ where: { id: orderId2 } }).catch(() => {});
    console.log("Cleaned up test orders successfully.");

  } catch (error) {
    console.error("Test execution failed:", error);
  } finally {
    await tenantPrisma.$disconnect();
    await mainPrisma.$disconnect();
  }
}

main();
