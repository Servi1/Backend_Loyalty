const mainPrisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");

/**
 * Get all cart items for a user
 * @param {string} appUserId 
 * @returns {Promise<Array>}
 */
const getCart = async (appUserId) => {
  return await mainPrisma.cartItem.findMany({
    where: { appUserId },
    orderBy: { createdAt: "asc" }
  });
};

/**
 * Add an item to the cart or increment quantity if it already exists
 * @param {string} appUserId 
 * @param {object} itemData 
 * @returns {Promise<object>}
 */
const addToCart = async (appUserId, itemData) => {
  const { cartLineId, brandId, itemId, name, price, qty, image, size, flavor } = itemData;

  if (!cartLineId || !brandId || !itemId || !name || price === undefined) {
    throw new ApiError(400, "Missing required cart item fields");
  }

  // Find if this specific cart line configuration already exists for the user
  const existing = await mainPrisma.cartItem.findUnique({
    where: {
      appUserId_cartLineId: {
        appUserId,
        cartLineId
      }
    }
  });

  if (existing) {
    return await mainPrisma.cartItem.update({
      where: { id: existing.id },
      data: { qty: existing.qty + (qty || 1) }
    });
  }

  return await mainPrisma.cartItem.create({
    data: {
      appUserId,
      cartLineId,
      brandId,
      itemId,
      name,
      price: parseFloat(price),
      qty: qty || 1,
      image,
      size,
      flavor
    }
  });
};

/**
 * Update the quantity of a cart item. Deletes it if qty <= 0.
 * @param {string} appUserId 
 * @param {string} cartLineId 
 * @param {number} qty 
 * @returns {Promise<object|null>}
 */
const updateQuantity = async (appUserId, cartLineId, qty) => {
  if (qty <= 0) {
    await removeFromCart(appUserId, cartLineId);
    return null;
  }

  try {
    return await mainPrisma.cartItem.update({
      where: {
        appUserId_cartLineId: {
          appUserId,
          cartLineId
        }
      },
      data: { qty }
    });
  } catch (error) {
    // If Prisma throws record not found error (P2025)
    if (error.code === 'P2025') {
      throw new ApiError(404, "Cart item not found");
    }
    throw error;
  }
};

/**
 * Remove an item from the cart
 * @param {string} appUserId 
 * @param {string} cartLineId 
 * @returns {Promise<object>}
 */
const removeFromCart = async (appUserId, cartLineId) => {
  try {
    return await mainPrisma.cartItem.delete({
      where: {
        appUserId_cartLineId: {
          appUserId,
          cartLineId
        }
      }
    });
  } catch (error) {
    if (error.code === 'P2025') {
      throw new ApiError(404, "Cart item not found");
    }
    throw error;
  }
};

/**
 * Clear all cart items for a user
 * @param {string} appUserId 
 * @returns {Promise<object>}
 */
const clearCart = async (appUserId) => {
  return await mainPrisma.cartItem.deleteMany({
    where: { appUserId }
  });
};

module.exports = {
  getCart,
  addToCart,
  updateQuantity,
  removeFromCart,
  clearCart
};
