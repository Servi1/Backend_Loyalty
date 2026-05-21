const http = require("http");
const app = require("./app");
const { Server } = require("socket.io");
const config = require("./config");
const { initSocket } = require("./socket");

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

  // Trigger initial synchronization of tenant orders and customers to the main database
  const tenantsService = require("./features/tenants/tenants.service");
  const customersService = require("./features/customers/customers.service");
  tenantsService.syncAllTenantOrders().catch(err => console.error("Initial order sync failed:", err));
  customersService.syncAllTenantCustomers().catch(err => console.error("Initial customer sync failed:", err));
});
