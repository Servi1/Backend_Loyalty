const mainPrisma = require("../src/config/prisma");
const cartService = require("../src/app/cart/cart.service");

async function run() {
  try {
    // 1. Fetch an existing customer from the database
    const user = await mainPrisma.appUser.findFirst();
    if (!user) {
      console.log("No user found in the main database. Please seed or create a user first.");
      return;
    }
    console.log(`Using user: ${user.name || user.phone} (ID: ${user.id})`);

    const appUserId = user.id;

    // Clear existing cart for a clean start
    console.log("Clearing existing cart...");
    await cartService.clearCart(appUserId);

    // 2. Add an item to the cart
    console.log("\nAdding item to cart...");
    const addedItem = await cartService.addToCart(appUserId, {
      cartLineId: "olive-oak:menu-item-1:Medium:Orange",
      brandId: "olive-oak",
      itemId: "menu-item-1",
      name: "Truffle Fries",
      price: 9.50,
      qty: 2,
      image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c",
      size: "Medium",
      flavor: "Orange"
    });
    console.log("Added Item:", addedItem);

    // 3. Get cart and verify
    console.log("\nFetching cart...");
    let cart = await cartService.getCart(appUserId);
    console.log(`Cart contains ${cart.length} item(s):`);
    cart.forEach(item => console.log(` - ${item.name} (${item.size}, ${item.flavor}): qty=${item.qty}, price=$${item.price}`));

    if (cart.length !== 1 || cart[0].qty !== 2) {
      throw new Error("Validation failed: item was not correctly added or quantity is incorrect.");
    }

    // 4. Update quantity
    console.log("\nUpdating quantity to 5...");
    await cartService.updateQuantity(appUserId, "olive-oak:menu-item-1:Medium:Orange", 5);
    cart = await cartService.getCart(appUserId);
    console.log("Updated Cart:", cart);
    if (cart[0].qty !== 5) {
      throw new Error("Validation failed: quantity update was not applied.");
    }

    // 5. Add same item config (should increment quantity)
    console.log("\nAdding same item again (qty 3)...");
    await cartService.addToCart(appUserId, {
      cartLineId: "olive-oak:menu-item-1:Medium:Orange",
      brandId: "olive-oak",
      itemId: "menu-item-1",
      name: "Truffle Fries",
      price: 9.50,
      qty: 3,
      image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c",
      size: "Medium",
      flavor: "Orange"
    });
    cart = await cartService.getCart(appUserId);
    console.log("Cart after duplicate add:", cart);
    if (cart[0].qty !== 8) {
      throw new Error("Validation failed: quantity increment was not applied.");
    }

    // 6. Remove item
    console.log("\nRemoving item...");
    await cartService.removeFromCart(appUserId, "olive-oak:menu-item-1:Medium:Orange");
    cart = await cartService.getCart(appUserId);
    console.log("Cart after removal:", cart);
    if (cart.length !== 0) {
      throw new Error("Validation failed: item was not removed.");
    }

    console.log("\nALL SERVICE TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("Test failed with error:", err);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
}

run();
