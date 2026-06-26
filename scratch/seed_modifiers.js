/**
 * seed_modifiers.js
 *
 * Updates existing MenuItem records across all tenant DBs with sample modifiers.
 * Does NOT delete any data — safe to run on a live DB.
 *
 * Usage:  node scratch/seed_modifiers.js
 */

const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

// ── Reusable modifier group definitions ─────────────────────────────────────

const DONENESS = {
  id: "group-doneness",
  name: "Doneness",
  nameAr: "درجة النضج",
  type: "dropdown",
  required: true,
  options: [
    { id: "done-rare",       name: "Rare",        nameAr: "نيء",        priceModifier: 0.00, value: "rare" },
    { id: "done-med-rare",   name: "Medium Rare", nameAr: "متوسط نيء",  priceModifier: 0.00, value: "medium_rare" },
    { id: "done-medium",     name: "Medium",      nameAr: "متوسط",      priceModifier: 0.00, value: "medium" },
    { id: "done-well",       name: "Well Done",   nameAr: "جيد الطهي",  priceModifier: 0.00, value: "well_done" },
  ],
};

const PROTEIN_CHOICE = {
  id: "group-protein",
  name: "Protein",
  nameAr: "البروتين",
  type: "single_select",
  required: true,
  options: [
    { id: "prot-chicken", name: "Chicken",      nameAr: "دجاج",    priceModifier: 0.00, value: "chicken" },
    { id: "prot-beef",    name: "Beef",         nameAr: "لحم بقر", priceModifier: 2.00, value: "beef" },
    { id: "prot-shrimp",  name: "Shrimp",       nameAr: "روبيان",  priceModifier: 3.50, value: "shrimp" },
    { id: "prot-falafel", name: "Falafel (V)",  nameAr: "فلافل",   priceModifier: 0.00, value: "falafel" },
  ],
};

const SPICE_LEVEL = {
  id: "group-spice",
  name: "Spice Level",
  nameAr: "مستوى الحرارة",
  type: "radio",
  required: false,
  options: [
    { id: "spice-mild",   name: "Mild",       nameAr: "خفيف",  priceModifier: 0.00, value: "mild" },
    { id: "spice-medium", name: "Medium",     nameAr: "متوسط", priceModifier: 0.00, value: "medium" },
    { id: "spice-hot",    name: "Hot 🌶",     nameAr: "حار",   priceModifier: 0.00, value: "hot" },
    { id: "spice-xhot",   name: "Extra Hot 🌶🌶", nameAr: "حار جداً", priceModifier: 0.00, value: "extra_hot" },
  ],
};

const TOPPINGS = {
  id: "group-toppings",
  name: "Extra Toppings",
  nameAr: "إضافات",
  type: "multi_select",
  required: false,
  options: [
    { id: "top-cheese",   name: "Extra Cheese",       nameAr: "جبنة إضافية",     priceModifier: 1.50, value: "extra_cheese" },
    { id: "top-avocado",  name: "Avocado",            nameAr: "أفوكادو",          priceModifier: 2.00, value: "avocado" },
    { id: "top-mushroom", name: "Sautéed Mushrooms",  nameAr: "مشروم مشوي",      priceModifier: 1.00, value: "mushrooms" },
    { id: "top-egg",      name: "Fried Egg",          nameAr: "بيض مقلي",        priceModifier: 1.00, value: "fried_egg" },
    { id: "top-truffle",  name: "Truffle Oil Drizzle",nameAr: "زيت الكمأة",      priceModifier: 2.50, value: "truffle_oil" },
  ],
};

const DIETARY_PREFERENCES = {
  id: "group-dietary",
  name: "Dietary Preferences",
  nameAr: "التفضيلات الغذائية",
  type: "checkbox",
  required: false,
  options: [
    { id: "diet-no-gluten", name: "Gluten Free",  nameAr: "خالي من الغلوتين", priceModifier: 0.00, value: "gluten_free" },
    { id: "diet-no-dairy",  name: "Dairy Free",   nameAr: "خالي من الألبان",  priceModifier: 0.00, value: "dairy_free" },
    { id: "diet-no-onion",  name: "No Onion",     nameAr: "بدون بصل",         priceModifier: 0.00, value: "no_onion" },
    { id: "diet-no-garlic", name: "No Garlic",    nameAr: "بدون ثوم",         priceModifier: 0.00, value: "no_garlic" },
  ],
};

const SAUCE_CHOICE = {
  id: "group-sauce",
  name: "Sauce",
  nameAr: "الصوص",
  type: "dropdown",
  required: false,
  options: [
    { id: "sauce-garlic",    name: "Garlic Aioli",    nameAr: "ثوم أيولي",      priceModifier: 0.00, value: "garlic_aioli" },
    { id: "sauce-sriracha",  name: "Spicy Sriracha",  nameAr: "سريراشا حار",    priceModifier: 0.00, value: "sriracha" },
    { id: "sauce-bbq",       name: "BBQ Sauce",       nameAr: "صوص بي بي كيو",  priceModifier: 0.00, value: "bbq" },
    { id: "sauce-truffle",   name: "Truffle Mayo",    nameAr: "مايونيز كمأة",   priceModifier: 1.20, value: "truffle_mayo" },
    { id: "sauce-honey",     name: "Honey Mustard",   nameAr: "خردل عسل",       priceModifier: 0.00, value: "honey_mustard" },
  ],
};

const MAKE_IT_COMBO = {
  id: "group-combo",
  name: "Make it a Combo",
  nameAr: "اجعلها كومبو",
  type: "toggle",
  required: false,
  options: [
    { id: "combo-yes", name: "Add Fries + Drink", nameAr: "إضافة بطاطس ومشروب", priceModifier: 3.90, value: "combo" },
  ],
};

const SIZE = {
  id: "group-size",
  name: "Size",
  nameAr: "الحجم",
  type: "single_select",
  required: true,
  options: [
    { id: "size-s",  name: "Small",  nameAr: "صغير",  priceModifier: 0.00, value: "small" },
    { id: "size-m",  name: "Medium", nameAr: "وسط",   priceModifier: 1.50, value: "medium" },
    { id: "size-l",  name: "Large",  nameAr: "كبير",  priceModifier: 3.00, value: "large" },
  ],
};

const MILK_TYPE = {
  id: "group-milk",
  name: "Milk Type",
  nameAr: "نوع الحليب",
  type: "radio",
  required: false,
  options: [
    { id: "milk-whole",  name: "Whole Milk",  nameAr: "حليب كامل",  priceModifier: 0.00, value: "whole" },
    { id: "milk-skim",   name: "Skim Milk",   nameAr: "حليب قليل الدسم", priceModifier: 0.00, value: "skim" },
    { id: "milk-oat",    name: "Oat Milk",    nameAr: "حليب شوفان", priceModifier: 0.80, value: "oat" },
    { id: "milk-almond", name: "Almond Milk", nameAr: "حليب لوز",  priceModifier: 0.80, value: "almond" },
    { id: "milk-soy",    name: "Soy Milk",    nameAr: "حليب الصويا", priceModifier: 0.80, value: "soy" },
  ],
};

const SWEETNESS = {
  id: "group-sweetness",
  name: "Sweetness Level",
  nameAr: "مستوى الحلاوة",
  type: "single_select",
  required: false,
  options: [
    { id: "sweet-none",  name: "No Sugar",    nameAr: "بدون سكر",   priceModifier: 0.00, value: "none" },
    { id: "sweet-low",   name: "Less Sweet",  nameAr: "أقل حلاوة",  priceModifier: 0.00, value: "low" },
    { id: "sweet-reg",   name: "Regular",     nameAr: "عادي",        priceModifier: 0.00, value: "regular" },
    { id: "sweet-extra", name: "Extra Sweet", nameAr: "حلو جداً",   priceModifier: 0.00, value: "extra" },
  ],
};

const WRAP_TYPE = {
  id: "group-wrap",
  name: "Wrap / Bread",
  nameAr: "نوع الخبز",
  type: "single_select",
  required: true,
  options: [
    { id: "wrap-pita",    name: "Pita",          nameAr: "خبز بيتا",    priceModifier: 0.00, value: "pita" },
    { id: "wrap-lafa",    name: "Lafa (Thin)",   nameAr: "خبز لافا",   priceModifier: 0.00, value: "lafa" },
    { id: "wrap-saj",     name: "Saj Bread",     nameAr: "خبز صاج",    priceModifier: 0.50, value: "saj" },
    { id: "wrap-lettuce", name: "Lettuce Wrap",  nameAr: "لفة خس",     priceModifier: 0.00, value: "lettuce" },
  ],
};

// ── Per-item modifier assignments (matched by item name substring) ────────────

function getModifiersForItem(itemName) {
  const name = itemName.toLowerCase();

  // Steaks / grilled meats
  if (name.includes("ribeye") || name.includes("steak"))   return [DONENESS, TOPPINGS, SAUCE_CHOICE, DIETARY_PREFERENCES];
  if (name.includes("bbq") || name.includes("ribs"))        return [SPICE_LEVEL, TOPPINGS, SAUCE_CHOICE];
  if (name.includes("grilled chicken"))                     return [SPICE_LEVEL, SAUCE_CHOICE, TOPPINGS, MAKE_IT_COMBO, DIETARY_PREFERENCES];

  // Burgers
  if (name.includes("burger") || name.includes("smash"))   return [DONENESS, TOPPINGS, SAUCE_CHOICE, MAKE_IT_COMBO, DIETARY_PREFERENCES];

  // Sides & fries
  if (name.includes("fries") || name.includes("chips"))     return [SIZE, SAUCE_CHOICE];
  if (name.includes("onion ring"))                          return [SIZE, SAUCE_CHOICE];

  // Shawarma / wraps / kofta
  if (name.includes("shawarma") || name.includes("wrap"))  return [SPICE_LEVEL, WRAP_TYPE, TOPPINGS, DIETARY_PREFERENCES];
  if (name.includes("kofta"))                               return [SPICE_LEVEL, WRAP_TYPE, SAUCE_CHOICE, DIETARY_PREFERENCES];

  // Salads
  if (name.includes("salad"))                               return [PROTEIN_CHOICE, DIETARY_PREFERENCES];

  // Hummus / mezze
  if (name.includes("hummus") || name.includes("mezze"))   return [DIETARY_PREFERENCES];

  // Pizza / pasta
  if (name.includes("pizza"))                               return [SIZE, SPICE_LEVEL, TOPPINGS];
  if (name.includes("pasta") || name.includes("spaghetti") || name.includes("penne")) return [PROTEIN_CHOICE, SPICE_LEVEL, DIETARY_PREFERENCES];

  // Hot beverages (lattes, coffee, tea)
  if (name.includes("latte") || name.includes("cappuccino") || name.includes("espresso") || name.includes("matcha latte")) {
    return [SIZE, MILK_TYPE, SWEETNESS];
  }

  // Cold drinks / lemonade / juice / tea
  if (name.includes("lemonade") || name.includes("juice") || name.includes("iced tea") || name.includes("green tea")) {
    return [SIZE, SWEETNESS];
  }

  // Milkshakes / smoothies
  if (name.includes("milkshake") || name.includes("smoothie")) return [SIZE];

  // Desserts / cakes / mochi
  if (name.includes("cake") || name.includes("mochi") || name.includes("dessert") || name.includes("brownie")) {
    return [DIETARY_PREFERENCES];
  }

  // Sandwiches / subs
  if (name.includes("sandwich") || name.includes("sub") || name.includes("roll")) {
    return [WRAP_TYPE, TOPPINGS, SAUCE_CHOICE, DIETARY_PREFERENCES];
  }

  return [];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Starting modifier seeding across all tenants...\n");
  const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });

  for (const tenant of tenants) {
    console.log(`──────────────────────────────────────────`);
    console.log(`Tenant: ${tenant.name} (${tenant.slug})`);

    const db = getTenantClient(tenant.dbUrl);

    // Use raw query to list items — avoids any type mismatch
    const items = await db.$queryRaw`SELECT id, name FROM "MenuItem"`;
    let updatedCount = 0;

    for (const item of items) {
      const modifiers = getModifiersForItem(item.name);
      if (modifiers.length === 0) {
        console.log(`  ⏭  ${item.name} — no modifiers defined`);
        continue;
      }

      const modifiersJson = JSON.stringify(modifiers);

      // Use raw SQL to bypass the stale generated Prisma client type definitions
      await db.$executeRaw`
        UPDATE "MenuItem"
        SET    "modifiers" = ${modifiersJson}::jsonb
        WHERE  "id" = ${item.id}
      `;

      console.log(`  ✅ ${item.name} → ${modifiers.length} group(s)`);
      updatedCount++;
    }

    if (updatedCount === 0) {
      console.log(`  ℹ️  No items matched any modifier rules.`);
    } else {
      console.log(`  🎉 Updated ${updatedCount} items.`);
    }
  }

  console.log(`\n✅ Modifier seeding complete.`);
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await mainPrisma.$disconnect();
    process.exit(0);
  });

