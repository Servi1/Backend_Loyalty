const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

// Define rich menus and branches data per tenant slug
const TENANT_DATA = {
  "olive-oak": {
    branches: [
      {
        name: "Downtown",
        address: "120 Main St",
        city: "Downtown",
        phone: "+1 (555) 123-4567",
        lat: 34.0522,
        lng: -118.2437,
        isOpen: true,
        hours: "10am - 11pm",
        rating: 4.7,
        imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&fit=crop"
      },
      {
        name: "Riverside",
        address: "8 River Walk",
        city: "Riverside",
        phone: "+1 (555) 234-5678",
        lat: 34.0622,
        lng: -118.2537,
        isOpen: true,
        hours: "9am - 10pm",
        rating: 4.5,
        imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?w=600&fit=crop"
      },
      {
        name: "Marina",
        address: "Marina Pier 4",
        city: "Marina",
        phone: "+1 (555) 345-6789",
        lat: 34.0422,
        lng: -118.2337,
        isOpen: true,
        hours: "11am - 11pm",
        rating: 4.8,
        imageUrl: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&fit=crop"
      }
    ],
    menu: [
      {
        category: "Mains",
        order: 1,
        items: [
          {
            name: "Lamb Kofta",
            description: "Spiced ground lamb skewers, grilled and served with garlic yogurt.",
            price: 18.0,
            imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?w=300&fit=crop",
            isChefPick: true,
            rating: 4.8
          },
          {
            name: "Lamb Shawarma Wrap",
            description: "Slow-roasted marinated lamb wrap with garlic sauce and pickles.",
            price: 15.0,
            imageUrl: "https://images.unsplash.com/photo-1598515214211-89d3e73ae83b?w=300&fit=crop",
            isChefPick: false,
            rating: 4.7
          }
        ]
      },
      {
        category: "Mezze",
        order: 2,
        items: [
          {
            name: "Hummus Trio",
            description: "Three delicious flavors: classic garlic, roasted beet, and spicy harissa hummus.",
            price: 12.0,
            imageUrl: "https://images.unsplash.com/photo-1547058886-f086b35610d4?w=300&fit=crop",
            isChefPick: true,
            rating: 4.6
          },
          {
            name: "Hummus & Warm Pita",
            description: "Traditional smooth chickpeas blended with tahini, olive oil, and lemon.",
            price: 8.50,
            imageUrl: "https://images.unsplash.com/photo-1547058886-f086b35610d4?w=300&fit=crop",
            isChefPick: false,
            rating: 4.5
          }
        ]
      },
      {
        category: "Salads",
        order: 3,
        items: [
          {
            name: "Fattoush",
            description: "Crisp garden greens, cucumbers, tomatoes, and toasted sumac pita chips.",
            price: 11.0,
            imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=300&fit=crop",
            isChefPick: false,
            rating: 4.5
          }
        ]
      },
      {
        category: "Drinks",
        order: 4,
        items: [
          {
            name: "Mint Lemonade",
            description: "Zesty lemon juice blended fresh with sweet syrup and garden mint.",
            price: 6.0,
            imageUrl: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=300&fit=crop",
            isChefPick: false,
            rating: 4.7
          }
        ]
      }
    ]
  },
  "bolt-burgers": {
    branches: [
      {
        name: "West End",
        address: "102 Westside Blvd",
        city: "West End",
        phone: "+1 (555) 456-7890",
        lat: 34.0722,
        lng: -118.2637,
        isOpen: true,
        hours: "11am - 10pm",
        rating: 4.6,
        imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&fit=crop"
      },
      {
        name: "East Plaza",
        address: "Shop 14, Eastside Plaza",
        city: "East Plaza",
        phone: "+1 (555) 567-8901",
        lat: 34.0822,
        lng: -118.2737,
        isOpen: false,
        hours: "11am - 9pm",
        rating: 4.3,
        imageUrl: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&fit=crop"
      }
    ],
    menu: [
      {
        category: "Mains",
        order: 1,
        items: [
          {
            name: "Classic Beef Burger",
            description: "Angus beef patty, melted cheddar, lettuce, tomato, special burger sauce.",
            price: 14.0,
            imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&fit=crop",
            isChefPick: true,
            rating: 4.8
          },
          {
            name: "Bacon Thunder Burger",
            description: "Double patty, smoked bacon, double cheddar, and crispy onion straws.",
            price: 16.50,
            imageUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&fit=crop",
            isChefPick: false,
            rating: 4.7
          }
        ]
      },
      {
        category: "Sides",
        order: 2,
        items: [
          {
            name: "Bacon Cheese Fries",
            description: "Waffle-cut fries topped with cheddar cheese sauce and chopped crispy bacon.",
            price: 8.0,
            imageUrl: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=300&fit=crop",
            isChefPick: true,
            rating: 4.6
          },
          {
            name: "Crispy Onion Rings",
            description: "Sweet white onions thick-cut, battered in local beer and fried golden.",
            price: 6.0,
            imageUrl: "https://images.unsplash.com/photo-1639024471283-2bc7b3c6a267?w=300&fit=crop",
            isChefPick: false,
            rating: 4.4
          }
        ]
      },
      {
        category: "Drinks",
        order: 3,
        items: [
          {
            name: "Vanilla Milkshake",
            description: "Hand-spun ice cream milkshake with real vanilla bean and fresh whipped cream.",
            price: 5.0,
            imageUrl: "https://images.unsplash.com/photo-1579954115545-a95591f28bfc?w=300&fit=crop",
            isChefPick: false,
            rating: 4.7
          }
        ]
      }
    ]
  },
  "matcha-house": {
    branches: [
      {
        name: "Green Plaza",
        address: "78 W Ist Ave, Arts District",
        city: "Green Plaza",
        phone: "+1 (555) 678-9012",
        lat: 34.0922,
        lng: -118.2837,
        isOpen: true,
        hours: "9am - 8pm",
        rating: 4.9,
        imageUrl: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=600&fit=crop"
      },
      {
        name: "Galleria Mall",
        address: "Aisle 4, The Galleria Mall",
        city: "Galleria Mall",
        phone: "+1 (555) 789-0123",
        lat: 34.1022,
        lng: -118.2937,
        isOpen: true,
        hours: "10am - 9pm",
        rating: 4.7,
        imageUrl: "https://images.unsplash.com/photo-1536680465769-2365207b035e?w=600&fit=crop"
      }
    ],
    menu: [
      {
        category: "Drinks",
        order: 1,
        items: [
          {
            name: "Ceremonial Matcha Latte",
            description: "Finely ground green tea whisked traditionally with hot organic oat milk.",
            price: 7.0,
            imageUrl: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=300&fit=crop",
            isChefPick: true,
            rating: 4.9
          },
          {
            name: "Iced Green Tea",
            description: "Chilled premium green tea poured over crushed ice with lemon slices.",
            price: 4.0,
            imageUrl: "https://images.unsplash.com/photo-1563822249548-9a72b6353cd1?w=300&fit=crop",
            isChefPick: false,
            rating: 4.6
          }
        ]
      },
      {
        category: "Desserts",
        order: 2,
        items: [
          {
            name: "Matcha Crepe Cake",
            description: "Twenty layers of paper-thin crepes folded with smooth matcha pastry cream.",
            price: 9.0,
            imageUrl: "https://images.unsplash.com/photo-1536680465769-2365207b035e?w=300&fit=crop",
            isChefPick: true,
            rating: 4.8
          },
          {
            name: "Red Bean Mochi",
            description: "Soft sweet rice cake filled with sweetened red azuki bean paste.",
            price: 5.0,
            imageUrl: "https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=100&fit=crop",
            isChefPick: false,
            rating: 4.5
          }
        ]
      }
    ]
  },
  "dunes-grill": {
    branches: [
      {
        name: "Marina Walk",
        address: "2210 N Park Ave, Uptown",
        city: "Marina Walk",
        phone: "+1 (555) 890-1234",
        lat: 34.1122,
        lng: -118.3037,
        isOpen: true,
        hours: "10am - 11pm",
        rating: 4.9,
        imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?w=600&fit=crop"
      }
    ],
    menu: [
      {
        category: "Mains",
        order: 1,
        items: [
          {
            name: "Ribeye Steak",
            description: "Flame-broiled 12oz ribeye served with compound herb butter and asparagus.",
            price: 32.0,
            imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?w=300&fit=crop",
            isChefPick: true,
            rating: 4.9
          },
          {
            name: "Grilled Chicken",
            description: "Juicy breast of chicken, dry-rubbed and grilled over oak wood logs.",
            price: 18.0,
            imageUrl: "https://images.unsplash.com/photo-1598515214211-89d3e73ae83b?w=300&fit=crop",
            isChefPick: false,
            rating: 4.7
          },
          {
            name: "BBQ Pork Ribs",
            description: "Fall-off-the-bone tender rack of ribs basted with house barbecue sauce.",
            price: 24.0,
            imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?w=300&fit=crop",
            isChefPick: true,
            rating: 4.8
          }
        ]
      },
      {
        category: "Appetizers",
        order: 2,
        items: [
          {
            name: "Caesar Salad",
            description: "Crisp baby romaine, shaved parmesan, garlic croutons, cream dressing.",
            price: 12.0,
            imageUrl: "https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=300&fit=crop",
            isChefPick: false,
            rating: 4.5
          }
        ]
      }
    ]
  }
};

// Generic data for tenants not explicitly defined
const getGenericData = (name) => ({
  branches: [
    {
      name: `${name} Main Branch`,
      address: "100 Galleria Blvd",
      city: "Central City",
      phone: "+1 (555) 999-0000",
      lat: 34.0522,
      lng: -118.2437,
      isOpen: true,
      hours: "10am - 10pm",
      rating: 4.6,
      imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&fit=crop"
    }
  ],
  menu: [
    {
      category: "Specialties",
      order: 1,
      items: [
        {
          name: `${name} Signature Dish`,
          description: "Our world-famous chef specialty crafted using premium local ingredients.",
          price: 16.50,
          imageUrl: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=300&fit=crop",
          isChefPick: true,
          rating: 4.8
        }
      ]
    }
  ]
});

async function main() {
  console.log("🚀 Starting tenant database migration and seeding...");
  const tenants = await mainPrisma.tenant.findMany();

  for (const tenant of tenants) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Brand: ${tenant.name} (${tenant.slug})`);
    
    // 1. Migrate (prisma db push)
    console.log(`  Applying database schema updates via db push...`);
    try {
      await execPromise(`npx prisma db push --schema=prisma/schema.tenant.prisma --accept-data-loss`, {
        env: { ...process.env, TENANT_DATABASE_URL: tenant.dbUrl },
      });
      console.log(`  ✅ Schema pushed successfully.`);
    } catch (err) {
      console.error(`  ❌ Failed to push schema to ${tenant.name}:`, err.message);
      continue;
    }

    // 2. Seed
    console.log(`  Seeding database records...`);
    try {
      const db = getTenantClient(tenant.dbUrl);
      const data = TENANT_DATA[tenant.slug] || getGenericData(tenant.name);

      // Clear existing records in correct dependency order
      await db.orderItem.deleteMany({});
      await db.order.deleteMany({});
      await db.inventoryItem.deleteMany({});
      await db.table.deleteMany({});
      await db.user.deleteMany({ where: { role: { not: "BRAND_MANAGER" } } }); // keep admin users
      await db.menuItem.deleteMany({});
      await db.menuCategory.deleteMany({});
      await db.branch.deleteMany({});

      // Seed Branches
      const createdBranches = [];
      for (const b of data.branches) {
        const branch = await db.branch.create({ data: b });
        createdBranches.push(branch);
      }
      console.log(`  ✅ Seeded ${createdBranches.length} branches.`);

      // Seed Menu
      let itemsCount = 0;
      for (const cat of data.menu) {
        const category = await db.menuCategory.create({
          data: {
            name: cat.category,
            order: cat.order
          }
        });

        for (const item of cat.items) {
          await db.menuItem.create({
            data: {
              ...item,
              categoryId: category.id
            }
          });
          itemsCount++;
        }
      }
      console.log(`  ✅ Seeded ${data.menu.length} categories with ${itemsCount} menu items.`);
    } catch (err) {
      console.error(`  ❌ Seeding failed for ${tenant.name}:`, err.message);
    }
  }

  console.log(`\n==================================================`);
  console.log("🎉 Seeding completed successfully for all active tenants.");
}

main()
  .catch((e) => {
    console.error("Fatal error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await mainPrisma.$disconnect();
    process.exit(0);
  });
