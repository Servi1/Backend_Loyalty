const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function seed() {
  try {
    const tenant = await mainPrisma.tenant.findUnique({
      where: { slug: "servi" }
    });

    if (!tenant) {
      console.error("Tenant 'servi' not found.");
      return;
    }

    const tenantPrisma = getTenantClient(tenant.dbUrl);

    // Find Branch
    const branch = await tenantPrisma.branch.findFirst({
      where: { name: { contains: "Downtown" } }
    });

    if (!branch) {
      console.error("Branch 'Downtown' not found.");
      return;
    }

    console.log(`Seeding orders for branch: ${branch.name} (${branch.id})`);

    // Wipe existing orders to have a clean view
    await tenantPrisma.orderItem.deleteMany();
    await tenantPrisma.order.deleteMany();

    // Find or create Categories
    const burgerCat = await tenantPrisma.menuCategory.create({
      data: { name: "Burgers", order: 1 }
    });
    const drinksCat = await tenantPrisma.menuCategory.create({
      data: { name: "Drinks", order: 2 }
    });
    const dessertsCat = await tenantPrisma.menuCategory.create({
      data: { name: "Desserts", order: 3 }
    });

    // Create Menu Items
    const burgerItem = await tenantPrisma.menuItem.create({
      data: { name: "Classic Beef Burger", price: 35.00, categoryId: burgerCat.id }
    });
    const cheeseBurgerItem = await tenantPrisma.menuItem.create({
      data: { name: "Double Cheeseburger", price: 42.00, categoryId: burgerCat.id }
    });
    const juiceItem = await tenantPrisma.menuItem.create({
      data: { name: "Fresh Orange Juice", price: 15.00, categoryId: drinksCat.id }
    });
    const cokeItem = await tenantPrisma.menuItem.create({
      data: { name: "Coca Cola", price: 8.00, categoryId: drinksCat.id }
    });
    const cakeItem = await tenantPrisma.menuItem.create({
      data: { name: "Chocolate Fudge Cake", price: 25.00, categoryId: dessertsCat.id }
    });

    // Find or create Tables
    const getOrCreateTable = async (label) => {
      let tbl = await tenantPrisma.table.findFirst({ where: { label, branchId: branch.id } });
      if (!tbl) {
        tbl = await tenantPrisma.table.create({
          data: { label, branchId: branch.id, seats: 4 }
        });
      }
      return tbl;
    };

    const table1 = await getOrCreateTable("Table 1");
    const table2 = await getOrCreateTable("Table 2");
    const table3 = await getOrCreateTable("Table 3");
    const table5 = await getOrCreateTable("Table 5");

    // Find or create customers inside tenant DB
    const getOrCreateUser = async (name, email) => {
      let u = await tenantPrisma.user.findUnique({ where: { email } });
      if (!u) {
        u = await tenantPrisma.user.create({
          data: { name, email, role: "CASHIER" }
        });
      }
      return u;
    };

    const userAhmed = await getOrCreateUser("Ahmed", "ahmed@example.com");
    const userSarah = await getOrCreateUser("Sarah", "sarah@example.com");
    const userJohn = await getOrCreateUser("John", "john@example.com");
    const userEmily = await getOrCreateUser("Emily", "emily@example.com");

    // Order Helper function
    const createOrder = async (orderNumber, status, tableId, items, userId) => {
      const order = await tenantPrisma.order.create({
        data: {
          orderNumber,
          status,
          type: "DINE_IN",
          total: items.reduce((sum, item) => sum + (item.price * item.qty), 0),
          branchId: branch.id,
          tableId,
          userId,
          source: "pos",
          createdAt: new Date(Date.now() - Math.floor(Math.random() * 30 * 60000)) // created 0-30 mins ago
        }
      });

      for (const item of items) {
        await tenantPrisma.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: item.menuItemId,
            quantity: item.qty,
            price: item.price,
            notes: item.notes || ""
          }
        });
      }
    };

    // 1. Create Active order 1: Burgers (Kitchen station) - status PENDING -> maps to 'new'
    await createOrder(
      "ORD-101",
      "PENDING",
      table1.id,
      [
        { menuItemId: burgerItem.id, price: burgerItem.price, qty: 2, notes: "No onions" },
        { menuItemId: cheeseBurgerItem.id, price: cheeseBurgerItem.price, qty: 1, notes: "Extra cheese" }
      ],
      userAhmed.id
    );

    // 2. Create Active order 2: Drinks (Drinks station) - status PREPARING -> maps to 'preparing'
    await createOrder(
      "ORD-102",
      "PREPARING",
      table3.id,
      [
        { menuItemId: juiceItem.id, price: juiceItem.price, qty: 3, notes: "No ice" },
        { menuItemId: cokeItem.id, price: cokeItem.price, qty: 2 }
      ],
      userSarah.id
    );

    // 3. Create Active order 3: Desserts (Desserts station) - status ACCEPTED -> maps to 'new'
    await createOrder(
      "ORD-103",
      "ACCEPTED",
      table5.id,
      [
        { menuItemId: cakeItem.id, price: cakeItem.price, qty: 1, notes: "With extra ice cream" }
      ],
      userJohn.id
    );

    // 4. Create Completed order 4: status READY -> maps to 'ready'
    await createOrder(
      "ORD-104",
      "READY",
      table2.id,
      [
        { menuItemId: burgerItem.id, price: burgerItem.price, qty: 1 }
      ],
      userEmily.id
    );

    console.log("Seeding KDS test orders complete!");
  } catch (error) {
    console.error("Error seeding KDS orders:", error);
  } finally {
    await mainPrisma.$disconnect();
  }
}

seed();
