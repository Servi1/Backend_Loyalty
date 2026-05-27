# Servio Backend — Implementation Plan

This document outlines the full implementation roadmap for the Servio backend, focusing on a **Database-per-Tenant architecture**.

## User Review Required

> [!WARNING]
> This plan proposes migrating from a single database model to a **Database-per-Tenant** architecture. 
> 
> *   **Main Database:** Handles Super Admin authentication, global settings, and Tenant registry (stores the database connection string for each tenant).
> *   **Tenant Databases:** Each brand gets its own separate PostgreSQL database for full data isolation.


---

## Technology Stack

| Layer              | Choice                         |
| :----------------- | :----------------------------- |
| Runtime            | Node.js                        |
| Language           | JavaScript (ES6+)              |
| Web Framework      | Express.js                     |
| Database           | PostgreSQL (Multi-Database)    |
| ORM                | Prisma (Dynamic connection)    |
| Real-time          | Socket.io                      |
| Authentication     | JWT + OTP (Twilio)             |
| Authorization      | Role-Based Access Control      |

---

## Architecture: Database-per-Tenant

Instead of storing all data in one database with a `tenantId` column, we will separate concerns:

1.  **Main Schema (`schema.main.prisma`)**:
    *   Models: `SuperAdmin`, `Tenant` (includes `dbName` or `dbUrl`).
2.  **Tenant Schema (`schema.tenant.prisma`)**:
    *   Models: `User` (Brand Owners, Cashiers, Customers), `Branch`, `MenuCategory`, `MenuItem`, `Order`, `Table`, `Wallet`, etc.
3.  **Connection Manager**: A custom service that caches Prisma Client instances per tenant database URL, preventing connection exhaustion.

---

## Directory Structure

```
Backend_Loyalty/
├── prisma/
│   ├── schema.main.prisma     # Super Admin & Tenant Registry
│   └── schema.tenant.prisma   # Tenant specific schema
├── src/
│   ├── config/
│   │   ├── index.js           
│   │   ├── mainPrisma.js      # Static client for Main DB
│   │   └── tenantManager.js   # Dynamic client manager for Tenant DBs
│   ├── features/
│   │   ├── auth/              # OTP + email/password login
│   │   ├── tenants/           # Brand creation & DB provisioning
│   │   ├── branches/          # Individual location management
│   │   ├── menus/             # Categories & menu items
│   │   ├── orders/            # Order lifecycle + real-time POS
│   │   ├── loyalty/           # Wallet, points earn/redeem
│   │   └── uploads/           # File upload handling
│   ├── middlewares/
│   │   ├── authMiddleware.js  # JWT verification + role checks
│   │   ├── tenantMiddleware.js # Extracts tenant DB connection dynamically
│   │   ├── uploadMiddleware.js 
│   │   └── errorHandler.js   
│   ├── socket/
│   │   └── index.js           
│   ├── utils/
│   ├── app.js                 
│   └── server.js              
```

---

## API Endpoints

### Super Admin (`/api/admin`)
| Method | Endpoint         | Access   | Description                      |
| :----- | :--------------- | :------- | :------------------------------- |
| POST   | `/login`         | Public   | Super Admin login                |
| POST   | `/tenants`       | Admin    | Creates tenant & provisions new DB |
| GET    | `/tenants`       | Admin    | List all tenants in registry     |

### Tenant API (`/api/tenant/:tenantId/*`)
*All endpoints below require middleware to resolve the `tenantId` into a dynamic DB connection.*

| Route Group | Endpoints | Access | Description |
| :--- | :--- | :--- | :--- |
| **Auth** | `/auth/otp/send`, `/auth/otp/verify`, `/auth/login` | Public | Auth against the specific tenant DB |
| **Branches** | `/branches`, `/branches/:id` | Auth | Branch management |
| **Menus** | `/menus/categories`, `/menus/items` | Public / Auth | Menu management |
| **Orders** | `/orders`, `/orders/mine`, `/orders/:id/status` | Auth | Order lifecycle |
| **Loyalty** | `/loyalty/wallet`, `/loyalty/earn`, `/loyalty/redeem`| Auth | Wallet management |
| **Uploads** | `/uploads/menu`, `/uploads/logo` | Auth | File uploads |

---

## Phases

### Phase 1 — Foundation ✅
- [x] Project scaffolding & dependencies
- [x] Initial Express app setup
- [x] JWT auth + RBAC middleware conceptualized
- [x] Local file uploads (menu images, logos, avatars) via Multer

### Phase 2 — Multi-Database Architecture Refactor (Next)
- [ ] **Split Prisma Schemas** — Create `schema.main.prisma` and `schema.tenant.prisma`.
- [ ] **Dynamic Connection Manager** — Implement cache for tenant Prisma Clients.
- [ ] **Tenant Provisioning Script** — Logic to create a physical Postgres DB when a new Tenant is added via the Super Admin API, and apply migrations.
- [ ] **Middleware Refactor** — Update `tenantMiddleware.js` to look up the DB URL and inject `req.tenantDb`.
- [ ] **Service Refactor** — Update all feature services (auth, branches, orders) to accept `req.tenantDb` instead of a static import.

### Phase 3 — Core Features
- [ ] **Tables CRUD** — Create/update/delete tables for a branch
- [ ] **QR Code Generation** — Auto-generate unique QR codes per table
- [ ] **Reservation System** — `Reservation` model + CRUD
- [ ] **App Design/Theming API** — Endpoint to save & retrieve `BrandTheme` config per tenant

### Phase 4 — Real-time & Notifications
- [ ] **Push Notifications** — Firebase Cloud Messaging (FCM) integration
- [ ] **Live Table Status** — Socket.io events for table status
- [ ] **Order Notifications Sound** — Socket event with audio alert payload

### Phase 5 — Analytics, Billing & Production
- [ ] **EOD (End-of-Day) Reports**
- [ ] **Subscription Management** — Enforce feature limits per `SubscriptionTier`
- [ ] **Automated Tests & Input Validation**
