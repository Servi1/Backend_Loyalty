/**
 * App Profile Service
 *
 * updateProfile — update name, email, avatarUrl
 * deleteAccount — soft-delete / anonymise customer (GDPR-ready stub)
 */

const ApiError = require("../../utils/ApiError");
const { syncToAggregatedCustomer } = require("../../shared/customers/customers.service");

// ─── Update profile ───────────────────────────────────────────────────────────

const updateProfile = async (db, userId, { name, email, avatarUrl }, tenantId) => {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");

  // Email uniqueness check (if changing)
  if (email && email !== user.email) {
    const exists = await db.user.findUnique({ where: { email } });
    if (exists) throw new ApiError(409, "That email is already in use");
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(avatarUrl !== undefined && { avatarUrl }),
    },
    include: { wallet: true },
  });

  // Sync changes to global aggregated registry (non-blocking)
  if (tenantId) {
    syncToAggregatedCustomer(db, tenantId, userId).catch(console.error);
  }

  return _formatProfile(updated);
};

// ─── Delete / anonymise account ───────────────────────────────────────────────

const deleteAccount = async (db, userId) => {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");

  // Anonymise instead of hard-delete — preserves order history integrity
  await db.user.update({
    where: { id: userId },
    data: {
      name: "Deleted User",
      phone: null,
      email: null,
      avatarUrl: null,
    },
  });

  return { message: "Account deleted successfully" };
};

// ─── Private helpers ──────────────────────────────────────────────────────────

const _formatProfile = (user) => ({
  id: user.id,
  name: user.name,
  phone: user.phone,
  email: user.email,
  avatarUrl: user.avatarUrl,
  role: user.role,
  wallet: user.wallet
    ? { points: user.wallet.points, lifetimeEarn: user.wallet.lifetimeEarn }
    : null,
  createdAt: user.createdAt,
});

module.exports = { updateProfile, deleteAccount };
