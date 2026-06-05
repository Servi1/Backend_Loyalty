const http = require("http");
const app = require("./app");
const { Server } = require("socket.io");
const config = require("./src/config");
const { initSocket } = require("./src/socket");

const server = http.createServer(app);

// ─── Socket.io ───────────────────────────────────────
const io = new Server(server, {
  cors: { origin: config.cors.origin, methods: ["GET", "POST"] },
});
initSocket(io);

// Make io accessible from controllers via req.app.get("io")
app.set("io", io);

// ─── Start Server ────────────────────────────────────
server.listen(config.port, () => {
  console.log(`\n🚀 Servio Backend running on http://localhost:${config.port}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🌱 Environment: ${config.nodeEnv}\n`);

  // Trigger initial synchronization of tenant orders to the main database
  const tenantsService = require("./src/web/admin/tenants/tenants.service");
  tenantsService.syncAllTenantOrders().catch(err => console.error("Initial order sync failed:", err));
});
