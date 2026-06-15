const catchAsync = require("../../utils/catchAsync");
const cartService = require("./cart.service");

// ─── GET /cart ──────────────────────────────────────────────────────────────
const get = catchAsync(async (req, res) => {
  const cart = await cartService.getCart(req.user.id);
  res.json({ success: true, data: cart });
});

// ─── POST /cart ─────────────────────────────────────────────────────────────
const add = catchAsync(async (req, res) => {
  await cartService.addToCart(req.user.id, req.body);
  const cart = await cartService.getCart(req.user.id);
  res.json({ success: true, data: cart });
});

// ─── PATCH /cart/:cartLineId ────────────────────────────────────────────────
const updateQty = catchAsync(async (req, res) => {
  const { cartLineId } = req.params;
  const { qty } = req.body;
  await cartService.updateQuantity(req.user.id, cartLineId, qty);
  const cart = await cartService.getCart(req.user.id);
  res.json({ success: true, data: cart });
});

// ─── DELETE /cart/:cartLineId ───────────────────────────────────────────────
const remove = catchAsync(async (req, res) => {
  const { cartLineId } = req.params;
  await cartService.removeFromCart(req.user.id, cartLineId);
  const cart = await cartService.getCart(req.user.id);
  res.json({ success: true, data: cart });
});

// ─── POST /cart/clear ───────────────────────────────────────────────────────
const clear = catchAsync(async (req, res) => {
  await cartService.clearCart(req.user.id);
  res.json({ success: true, data: [] });
});

module.exports = {
  get,
  add,
  updateQty,
  remove,
  clear
};
