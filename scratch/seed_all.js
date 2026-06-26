const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const { Client } = require("pg");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const bcrypt = require("bcryptjs");

const TENANTS_TO_SEED = [
  {
    name: "Servi",
    slug: "servi",
    primaryColor: "#4AA375",
    accentColor: "#f59e0b",
    contactEmail: "contact@servi.app",
    phone: "+1234567890",
    website: "https://servi.app",
    loyaltyEnabled: true,
    loyaltyEarnRate: 1.0,
    loyaltyRedeemRate: 100.0,
  },
  {
    name: "Olive & Oak",
    slug: "olive-oak",
    primaryColor: "#10b981",
    accentColor: "#f59e0b",
    contactEmail: "info@oliveoak.com",
    phone: "+15551234561",
    website: "https://oliveoak.com",
    loyaltyEnabled: true,
    loyaltyEarnRate: 1.5,
    loyaltyRedeemRate: 100.0,
  },
  {
    name: "Bolt Burgers",
    slug: "bolt-burgers",
    primaryColor: "#ef4444",
    accentColor: "#fbbf24",
    contactEmail: "hello@boltburgers.com",
    phone: "+15551234562",
    website: "https://boltburgers.com",
    loyaltyEnabled: true,
    loyaltyEarnRate: 1.0,
    loyaltyRedeemRate: 100.0,
  },
  {
    name: "Matcha House",
    slug: "matcha-house",
    primaryColor: "#059669",
    accentColor: "#10b981",
    contactEmail: "orders@matchahouse.com",
    phone: "+15551234563",
    website: "https://matchahouse.com",
    loyaltyEnabled: true,
    loyaltyEarnRate: 2.0,
    loyaltyRedeemRate: 100.0,
  },
  {
    name: "Dunes Grill",
    slug: "dunes-grill",
    primaryColor: "#b45309",
    accentColor: "#f59e0b",
    contactEmail: "reserve@dunesgrill.com",
    phone: "+15551234564",
    website: "https://dunesgrill.com",
    loyaltyEnabled: true,
    loyaltyEarnRate: 1.0,
    loyaltyRedeemRate: 100.0,
  },
  {
    name: "Sakura Sushi",
    slug: "sakura-sushi",
    primaryColor: "#ec4899",
    accentColor: "#f43f5e",
    contactEmail: "sushi@sakura.com",
    phone: "+15551234565",
    website: "https://sakura.com",
    loyaltyEnabled: true,
    loyaltyEarnRate: 1.2,
    loyaltyRedeemRate: 100.0,
  },
  {
    name: "Casa Pizza",
    slug: "casa-pizza",
    primaryColor: "#f97316",
    accentColor: "#eab308",
    contactEmail: "pizza@casapizza.com",
    phone: "+15551234566",
    website: "https://casapizza.com",
    loyaltyEnabled: true,
    loyaltyEarnRate: 1.0,
    loyaltyRedeemRate: 100.0,
  }
];

const MENU_DATA = {
  "servi": [
    {
      category: "Specialties",
      items: [
        { name: "Servi Signature Burger", description: "Prime beef, cheddar, special servi sauce", price: 16.50, imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop" },
        { name: "Crispy Truffle Fries", description: "Truffle oil, parmesan, parsley", price: 7.99, imageUrl: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400&h=400&fit=crop" },
        { name: "Avocado Garden Salad", description: "Mixed greens, cherry tomatoes, avocado, house dressing", price: 12.00, imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop" }
      ]
    },
    {
      category: "Beverages",
      items: [
        { name: "Iced Matcha Latte", description: "Premium Uji matcha, cold milk", price: 6.50, imageUrl: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=400&h=400&fit=crop" },
        { name: "Cold Brew Coffee", description: "Slow-dripped organic coffee", price: 5.50, imageUrl: "https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=400&h=400&fit=crop" }
      ]
    }
  ],
  "olive-oak": [
    {
      category: "Appetizers",
      items: [
        { name: "Hummus & Warm Pita", description: "Creamy chickpeas, tahini, olive oil", price: 8.50, imageUrl: "https://images.unsplash.com/photo-1547058886-f086b35610d4?w=400&h=400&fit=crop" },
        { name: "Crispy Falafel Plate", description: "Falafel pieces served with tahini sauce", price: 9.00, imageUrl: "https://images.unsplash.com/photo-1593001874117-1f9dbd6f1e30?w=400&h=400&fit=crop" }
      ]
    },
    {
      category: "Mains",
      items: [
        { name: "Lamb Shawarma Wrap", description: "Spiced lamb, garlic paste, pickles, flatbread", price: 15.00, imageUrl: "https://images.unsplash.com/photo-1529042410759-befb1204b468?w=400&h=400&fit=crop" },
        { name: "Mediterranean Lamb Kofta", description: "Skewered minced lamb, seasoned herbs", price: 18.00, imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop" }
      ]
    }
  ],
  "bolt-burgers": [
    {
      category: "Burgers",
      items: [
        { name: "Classic Cheeseburger", description: "Angus beef, cheddar cheese, lettuce, tomato", price: 12.50, imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop" },
        { name: "Bacon Thunder Burger", description: "Beef patty, smoked bacon, BBQ sauce, crispy onion", price: 14.99, imageUrl: "https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400&h=400&fit=crop" }
      ]
    },
    {
      category: "Sides",
      items: [
        { name: "Bacon Cheese Fries", description: "Fries smothered in liquid cheese and bacon bits", price: 8.00, imageUrl: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400&h=400&fit=crop" },
        { name: "Golden Onion Rings", description: "Beer-battered crunchy onion rings", price: 5.50, imageUrl: "https://images.unsplash.com/photo-1639024471283-2bc7b3c6a267?w=400&h=400&fit=crop" }
      ]
    }
  ],
  "matcha-house": [
    {
      category: "Matcha Drinks",
      items: [
        { name: "Matcha Latte", description: "Rich ceremonial matcha and milk", price: 7.00, imageUrl: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=400&h=400&fit=crop" },
        { name: "Matcha Rose Tea", description: "Matcha green tea infused with rose syrup", price: 6.50, imageUrl: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=400&h=400&fit=crop" }
      ]
    },
    {
      category: "Desserts",
      items: [
        { name: "Matcha Crepe Cake", description: "Multi-layered crepe with matcha pastry cream", price: 9.00, imageUrl: "https://images.unsplash.com/photo-1536680465769-2365207b035e?w=400&h=400&fit=crop" },
        { name: "Matcha Soft Serve", description: "Velvety green tea ice cream", price: 5.00, imageUrl: "https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=400&h=400&fit=crop" }
      ]
    }
  ],
  "dunes-grill": [
    {
      category: "Steaks",
      items: [
        { name: "Ribeye Steak (300g)", description: "USDA Prime grass-fed beef cooked to perfection", price: 32.00, imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop" },
        { name: "Filet Mignon (200g)", description: "Tender cut steak served with herb butter", price: 38.00, imageUrl: "https://images.unsplash.com/photo-1546964124-0cce460f38ef?w=400&h=400&fit=crop" }
      ]
    },
    {
      category: "Sides",
      items: [
        { name: "Mashed Potatoes", description: "Creamy buttered potatoes", price: 6.00, imageUrl: "https://images.unsplash.com/photo-1514516345957-556ca7d90a29?w=400&h=400&fit=crop" },
        { name: "Creamy Spinach", description: "Spinach in garlic parmesan cream", price: 7.00, imageUrl: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=400&h=400&fit=crop" }
      ]
    }
  ],
  "sakura-sushi": [
    {
      category: "Rolls",
      items: [
        { name: "California Roll", description: "Crab, cucumber, avocado", price: 8.50, imageUrl: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&h=400&fit=crop" },
        { name: "Spicy Tuna Roll", description: "Spicy tuna mix, sesame seeds", price: 10.00, imageUrl: "https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=400&h=400&fit=crop" }
      ]
    },
    {
      category: "Mains",
      items: [
        { name: "Salmon Nigiri Set", description: "5 pieces of fresh salmon on sushi rice", price: 14.00, imageUrl: "https://images.unsplash.com/photo-1553621042-f6e147245754?w=400&h=400&fit=crop" }
      ]
    }
  ],
  "casa-pizza": [
    {
      category: "Pizzas",
      items: [
        { name: "Margherita Pizza", description: "Fresh mozzarella, tomato sauce, basil", price: 11.99, imageUrl: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&h=400&fit=crop" },
        { name: "Pepperoni Pizza", description: "Beef pepperoni, mozzarella, tomato sauce", price: 14.50, imageUrl: "https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?w=400&h=400&fit=crop" }
      ]
    },
    {
      category: "Sides",
      items: [
        { name: "Garlic Bread", description: "Toasted baguette with garlic butter and herbs", price: 5.00, imageUrl: "https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?w=400&h=400&fit=crop" }
      ]
    }
  ]
};

const GLOBAL_CUSTOMERS = [
  { name: "Sreeraj T", phone: "+9661234567890", email: "sreeraj@example.com", points: 2500 },
  { name: "John Doe", phone: "+1234567890", email: "john@example.com", points: 3500 },
  { name: "Sara Ahmed", phone: "+966500000001", email: "sara@example.com", points: 2800 },
  { name: "Fahad Al-Otaibi", phone: "+966500000002", email: "fahad@example.com", points: 2100 },
  { name: "Emily Smith", phone: "+15550199201", email: "emily@example.com", points: 1750 },
  { name: "Michael Green", phone: "+15550199202", email: "michael@example.com", points: 1400 },
  { name: "Yuki Tanaka", phone: "+819012345678", email: "yuki@example.com", points: 1200 },
  { name: "Fatima Hassan", phone: "+971501234567", email: "fatima@example.com", points: 950 },
  { name: "David Miller", phone: "+447700900077", email: "david@example.com", points: 600 },
  { name: "Alex Wong", phone: "+85290123456", email: "alex@example.com", points: 350 },
  { name: "Jessica Taylor", phone: "+61491570156", email: "jessica@example.com", points: 150 }
];

let tenantClients = {};

async function seed() {
  console.log("🧹 Wiping main database tables...");
  await mainPrisma.gift.deleteMany();
  await mainPrisma.walletTransaction.deleteMany();
  await mainPrisma.wallet.deleteMany();
  await mainPrisma.appUser.deleteMany();
  await mainPrisma.aggregatedOrder.deleteMany();
  await mainPrisma.tenant.deleteMany();

  const mainDbUrl = process.env.DATABASE_URL;
  const baseUrl = mainDbUrl.substring(0, mainDbUrl.lastIndexOf("/"));
  const hashedStaffPassword = await bcrypt.hash("password123", 10);

  const registeredTenants = [];
  tenantClients = {};

  // 1. Set up each tenant
  for (const tConfig of TENANTS_TO_SEED) {
    const dbName = `tenant_${tConfig.slug.replace(/[^a-zA-Z0-9]/g, "_")}_db`;
    const tenantDbUrl = `${baseUrl}/${dbName}?schema=public`;

    console.log(`\n⚙️ Setting up physical database for tenant: ${tConfig.name} (${dbName})`);
    
    // Connect to main PG and create database
    const client = new Client({ connectionString: mainDbUrl });
    try {
      await client.connect();
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`   └─ Database ${dbName} created/verified.`);
    } catch (err) {
      if (err.code !== "42P04") {
        console.error(`Failed to create database ${dbName}:`, err.message);
        continue;
      }
      console.log(`   └─ Database ${dbName} already exists.`);
    } finally {
      await client.end();
    }

    // Push Prisma schema to this database
    try {
      console.log(`   └─ Pushing tenant schema...`);
      await execPromise(`npx prisma db push --schema=prisma/schema.tenant.prisma --accept-data-loss`, {
        env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
      });
      console.log(`   └─ Schema pushed.`);
    } catch (err) {
      console.error(`   └─ Failed to push schema:`, err.message);
      continue;
    }

    // Register tenant in main DB
    const tenant = await mainPrisma.tenant.create({
      data: {
        name: tConfig.name,
        slug: tConfig.slug,
        dbUrl: tenantDbUrl,
        primaryColor: tConfig.primaryColor,
        accentColor: tConfig.accentColor,
        contactEmail: tConfig.contactEmail,
        phone: tConfig.phone,
        website: tConfig.website,
        loyaltyEnabled: tConfig.loyaltyEnabled,
        loyaltyEarnRate: tConfig.loyaltyEarnRate,
        loyaltyRedeemRate: tConfig.loyaltyRedeemRate,
        isActive: true,
      }
    });
    registeredTenants.push(tenant);

    // Initialize/Wipe Tenant Database
    const tenantPrisma = getTenantClient(tenantDbUrl);
    tenantClients[tenant.slug] = tenantPrisma;

    console.log(`   └─ Wiping old tenant data...`);
    await tenantPrisma.orderItem.deleteMany();
    await tenantPrisma.order.deleteMany();
    await tenantPrisma.table.deleteMany();
    await tenantPrisma.branch.deleteMany();
    await tenantPrisma.inventoryItem.deleteMany();
    await tenantPrisma.menuItem.deleteMany();
    await tenantPrisma.menuCategory.deleteMany();
    await tenantPrisma.user.deleteMany();

    // Create staff users
    console.log(`   └─ Seeding staff users...`);
    await tenantPrisma.user.createMany({
      data: [
        {
          email: `admin@${tenant.slug}.com`,
          password: hashedStaffPassword,
          name: `${tenant.name} Manager`,
          role: "BRAND_MANAGER"
        },
        {
          email: `cashier@${tenant.slug}.com`,
          password: hashedStaffPassword,
          name: `${tenant.name} Cashier`,
          role: "CASHIER"
        }
      ]
    });

    // Create branches
    console.log(`   └─ Seeding branches and tables...`);
    const branches = [];
    const branchNames = ["Downtown Flagship", "City Mall Outlet", "Airport Terminal"];
    for (const bName of branchNames) {
      const randomLat = 24.7136 + (Math.random() - 0.5) * 0.08;
      const randomLng = 46.6753 + (Math.random() - 0.5) * 0.08;
      const branch = await tenantPrisma.branch.create({
        data: {
          name: bName,
          address: `123 ${bName} Road`,
          city: "Riyadh",
          phone: "+966110000000",
          lat: randomLat,
          lng: randomLng,
          isOpen: bName !== "Airport Terminal",
        }
      });
      branches.push(branch);

      // Seed tables
      await tenantPrisma.table.createMany({
        data: [
          { label: "Table 1 (Window)", seats: 2, branchId: branch.id },
          { label: "Table 2", seats: 4, branchId: branch.id },
          { label: "Table 3", seats: 4, branchId: branch.id },
          { label: "Table 4 (VIP)", seats: 6, branchId: branch.id }
        ]
      });
    }

    // Seed menu category and items
    console.log(`   └─ Seeding menus...`);
    const menuConfig = MENU_DATA[tenant.slug] || MENU_DATA["servi"];
    let orderIndex = 0;
    for (const catConfig of menuConfig) {
      const category = await tenantPrisma.menuCategory.create({
        data: {
          name: catConfig.category,
          order: orderIndex++
        }
      });

      for (const itemConfig of catConfig.items) {
        await tenantPrisma.menuItem.create({
          data: {
            name: itemConfig.name,
            description: itemConfig.description,
            price: itemConfig.price,
            imageUrl: itemConfig.imageUrl,
            categoryId: category.id,
            isAvailable: true
          }
        });
      }
    }
  }

  // 2. Seed global users and wallets
  console.log("\n👤 Seeding global app users and loyalty wallets...");
  const createdAppUsers = [];
  
  for (const cData of GLOBAL_CUSTOMERS) {
    const user = await mainPrisma.appUser.create({
      data: {
        name: cData.name,
        phone: cData.phone,
        email: cData.email,
        favoriteBrands: registeredTenants.slice(0, 2).map(t => t.id) // only first 2 brands favorited by default
      }
    });

    const wallet = await mainPrisma.wallet.create({
      data: {
        appUserId: user.id,
        points: cData.points,
        lifetimeEarn: cData.points,
        tier: cData.points >= 3000 ? "gold" : cData.points >= 1000 ? "silver" : "bronze"
      }
    });

    // Create a transaction history for the points
    await mainPrisma.walletTransaction.createMany({
      data: [
        {
          walletId: wallet.id,
          points: Math.floor(cData.points * 0.7),
          description: "Earned points on first transactions",
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        },
        {
          walletId: wallet.id,
          points: Math.floor(cData.points * 0.3),
          description: "Bonus campaign points",
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        }
      ]
    });

    createdAppUsers.push({ ...user, wallet });
  }

  // 3. Sync global users to all tenant databases (as customer role) and seed some orders
  console.log("\n📦 Syncing users and seeding orders for each tenant...");
  for (const tenant of registeredTenants) {
    const tenantPrisma = tenantClients[tenant.slug];
    const branches = await tenantPrisma.branch.findMany();
    const menuItems = await tenantPrisma.menuItem.findMany();
    
    // Sync customers to tenant DB
    for (const appUser of createdAppUsers) {
      await tenantPrisma.user.create({
        data: {
          id: appUser.id,
          phone: appUser.phone,
          email: appUser.email,
          name: appUser.name,
          role: "CASHIER", // Standard roles allowed in tenant DB schema. Wait, let's verify if "CUSTOMER" is an enum value in schema.tenant.prisma.
          // Wait! In schema.tenant.prisma:
          // enum Role { BRAND_MANAGER, BRANCH_MANAGER, CASHIER, WAITER, KITCHEN, CUSTOM }
          // Ah! There is NO "CUSTOMER" role in Role enum in tenant DB schema!
          // So users that are customers in tenant DB just don't have role = BRAND_MANAGER, they can have default role CASHIER or we can keep role as CASHIER, they are identified as customers when customerId is set on the order!
          // Yes! In schema.tenant.prisma, User model:
          // role      Role     @default(CASHIER)
          // So they can have role: "CASHIER" or similar, or password is null for them.
          password: null,
        }
      });
    }

    // Seed some orders for this tenant
    // We will generate 3-5 completed orders per tenant using random customers
    const orderCountToSeed = 5;
    for (let i = 0; i < orderCountToSeed; i++) {
      const customer = createdAppUsers[Math.floor(Math.random() * createdAppUsers.length)];
      const branch = branches[Math.floor(Math.random() * branches.length)];
      const tables = await tenantPrisma.table.findMany({ where: { branchId: branch.id } });
      const table = tables[Math.floor(Math.random() * tables.length)];

      const orderItemsToCreate = [];
      const numItems = Math.floor(Math.random() * 3) + 1; // 1-3 items
      let totalAmount = 0;

      for (let j = 0; j < numItems; j++) {
        const mItem = menuItems[Math.floor(Math.random() * menuItems.length)];
        const qty = Math.floor(Math.random() * 2) + 1;
        totalAmount += mItem.price * qty;
        orderItemsToCreate.push({
          menuItemId: mItem.id,
          quantity: qty,
          price: mItem.price
        });
      }

      const orderNumber = `${tenant.slug.substring(0, 3).toUpperCase()}-${1000 + i}`;
      const order = await tenantPrisma.order.create({
        data: {
          orderNumber,
          status: "COMPLETED",
          type: "DINE_IN",
          total: totalAmount,
          userId: customer.id, // linked to tenant user
          customerId: customer.id, // global customer link
          branchId: branch.id,
          tableId: table.id,
          createdAt: new Date(Date.now() - (i * 2 + 1) * 24 * 60 * 60 * 1000), // staggered dates
          items: {
            create: orderItemsToCreate
          }
        }
      });

      // Upsert to main database AggregatedOrder
      await mainPrisma.aggregatedOrder.create({
        data: {
          id: `${tenant.id}_${order.id}`,
          tenantId: tenant.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          type: order.type,
          total: order.total,
          customerName: customer.name,
          branchName: branch.name,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        }
      });
    }
    console.log(`   └─ Seeded ${orderCountToSeed} orders for ${tenant.name}.`);
  }

  // 4. Seed some gifts in main DB
  console.log("\n🎁 Seeding gifts...");
  const john = createdAppUsers.find(u => u.name === "John Doe");
  const sara = createdAppUsers.find(u => u.name === "Sara Ahmed");
  const fahad = createdAppUsers.find(u => u.name === "Fahad Al-Otaibi");
  const emily = createdAppUsers.find(u => u.name === "Emily Smith");
  const sreeraj = createdAppUsers.find(u => u.name === "Sreeraj T");

  await mainPrisma.gift.createMany({
    data: [
      {
        senderId: john.id,
        recipientId: sara.id,
        points: 150,
        message: "Hey Sara, sending you some points for a matcha latte! 🍵",
        claimed: false,
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      },
      {
        senderId: fahad.id,
        recipientId: emily.id,
        points: 100,
        message: "Thanks for helping with the slides, enjoy a treat!",
        claimed: true,
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      },
      // Gift sent TO Sreeraj T (Unclaimed)
      {
        senderId: john.id,
        recipientId: sreeraj.id,
        points: 200,
        message: "Here are some points to try the Bolt Burgers! 🍔",
        claimed: false,
        createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000)
      },
      // Gift sent TO Sreeraj T (Claimed)
      {
        senderId: sara.id,
        recipientId: sreeraj.id,
        points: 100,
        message: "Happy loyalty points sharing!",
        claimed: true,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      },
      // Gift sent BY Sreeraj T (Claimed)
      {
        senderId: sreeraj.id,
        recipientId: emily.id,
        points: 50,
        message: "Thanks!",
        claimed: true,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      }
    ]
  });
  console.log("   └─ Seeded gifts.");

  console.log("\n✨ Database seeding complete! All DBs seeded successfully.");
}

seed()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
  })
  .finally(async () => {
    // Disconnect main client
    await mainPrisma.$disconnect();
    
    // Disconnect tenant clients
    for (const slug in tenantClients) {
      try {
        await tenantClients[slug].$disconnect();
      } catch (err) {
        // ignore
      }
    }
    console.log("🔌 All database clients disconnected.");
  });
