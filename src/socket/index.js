/**
 * Socket.io initialization and event handlers.
 * Cashiers join their branch room to receive live orders.
 */
const initSocket = (io) => {
  io.on("connection", (socket) => {
    console.log(`⚡ Socket connected: ${socket.id}`);

    // Staff joins their branch room
    socket.on("join:branch", (branchId) => {
      if (branchId) {
        socket.join(`branch:${branchId}`);
        console.log(`📍 Socket ${socket.id} joined branch:${branchId}`);
      }
    });

    socket.on("leave:branch", (branchId) => {
      if (branchId) {
        socket.leave(`branch:${branchId}`);
        console.log(`📍 Socket ${socket.id} left branch:${branchId}`);
      }
    });

    // Brand Admin / Staff joins their tenant room for tenant-wide live events (e.g. tables)
    socket.on("join:tenant", async (tenantId) => {
      if (tenantId) {
        socket.join(`tenant:${tenantId}`);
        console.log(`🏢 Socket ${socket.id} joined tenant:${tenantId}`);

        try {
          const mainPrisma = require("../config/prisma");
          const tenant = await mainPrisma.tenant.findFirst({
            where: {
              OR: [
                { id: String(tenantId) },
                { slug: String(tenantId) },
              ],
            },
            select: { id: true, slug: true },
          });

          if (tenant) {
            if (tenant.id && String(tenant.id) !== String(tenantId)) {
              socket.join(`tenant:${tenant.id}`);
              console.log(`🏢 Socket ${socket.id} auto-joined canonical tenant:${tenant.id}`);
            }
            if (tenant.slug && String(tenant.slug) !== String(tenantId)) {
              socket.join(`tenant:${tenant.slug}`);
              console.log(`🏢 Socket ${socket.id} auto-joined slug tenant:${tenant.slug}`);
            }
          }
        } catch (err) {
          // Non-critical room expansion
        }
      }
    });

    socket.on("leave:tenant", async (tenantId) => {
      if (tenantId) {
        socket.leave(`tenant:${tenantId}`);
        console.log(`🏢 Socket ${socket.id} left tenant:${tenantId}`);

        try {
          const mainPrisma = require("../config/prisma");
          const tenant = await mainPrisma.tenant.findFirst({
            where: {
              OR: [
                { id: String(tenantId) },
                { slug: String(tenantId) },
              ],
            },
            select: { id: true, slug: true },
          });

          if (tenant) {
            if (tenant.id) socket.leave(`tenant:${tenant.id}`);
            if (tenant.slug) socket.leave(`tenant:${tenant.slug}`);
          }
        } catch (err) {
          // Non-critical
        }
      }
    });

    // Customer joins their personal room for order updates
    socket.on("join:user", (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`👤 Socket ${socket.id} joined user:${userId}`);
      }
    });

    // Support Chat Rooms
    socket.on("join:ticket", (ticketId) => {
      if (ticketId) {
        socket.join(`ticket:${ticketId}`);
        console.log(`💬 Socket ${socket.id} joined ticket:${ticketId}`);
      }
    });

    socket.on("join:support", (ticketId) => {
      if (ticketId) {
        socket.join(`ticket:${ticketId}`);
        console.log(`💬 Socket ${socket.id} joined ticket:${ticketId}`);
      }
    });

    socket.on("join:admin_support", () => {
      socket.join("admin_support");
      console.log(`🎧 Socket ${socket.id} joined admin_support room`);
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });
};

module.exports = { initSocket };
