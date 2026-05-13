/**
 * Socket.io initialization and event handlers.
 * Cashiers join their branch room to receive live orders.
 */
const initSocket = (io) => {
  io.on("connection", (socket) => {
    console.log(`⚡ Socket connected: ${socket.id}`);

    // Staff joins their branch room
    socket.on("join:branch", (branchId) => {
      socket.join(`branch:${branchId}`);
      console.log(`📍 Socket ${socket.id} joined branch:${branchId}`);
    });

    // Customer joins their personal room for order updates
    socket.on("join:user", (userId) => {
      socket.join(`user:${userId}`);
      console.log(`👤 Socket ${socket.id} joined user:${userId}`);
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });
};

module.exports = { initSocket };
