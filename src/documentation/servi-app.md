# Servi App — Mobile Consumer API Documentation

> **Base URL:** `/api/app/:tenantId/`  
> **Purpose:** Handles all customer-facing mobile app interactions — auth, menu browsing, ordering, loyalty wallet, and profile management.

---

## Middlewares

### `authenticateAppUser` — `app/middlewares/appAuth.middleware.js`
Verifies the JWT `Bearer` token for app customers.
- Decodes token, checks `type === "customer"`
- Looks up `AppUser` in the main DB
- Blocks deleted accounts (`isDelete: true`)
- Attaches `req.user` with `role: "CUSTOMER"`

**Errors:**
| Status | Message |
|--------|---------|
| 401 | Authentication required / Invalid or expired token |
| 403 | This endpoint is for app customers only |
| 401 | Customer account has been deleted |

---

### `requireAppTenant` — `app/middlewares/appTenant.middleware.js`
Ensures a valid tenant DB context exists on `req.tenantDb`.  
Applied to routes that need a brand scope (menu, branches, orders).

**Variant: `optionalAppTenant`** — same logic but silently skips if tenant is missing (used globally on the router mount).

**How tenant is resolved:** `req.params.tenantId` → `x-tenant-id` header → `?tenantId` query param. Supports both tenant `id` and `slug`.

**Attaches to req:** `req.tenantId`, `req.tenant`, `req.tenantDb`

**Errors:**
| Status | Message |
|--------|---------|
| 404 | Tenant not found or inactive |

---

## Config

### `config/index.js`
| Key | Source | Default |
|-----|--------|---------|
| `port` | `PORT` env | `5000` |
| `jwt.secret` | `JWT_SECRET` env | `"fallback_secret"` |
| `jwt.expiresIn` | `JWT_EXPIRES_IN` env | `"7d"` |
| `twilio.*` | `TWILIO_*` env vars | — |
| `getAppImageURL(path)` | — | Prepends `IMAGE_BASE_URL` env or `https://test2-api.servi.sa` to relative paths |

### `config/prisma.js`
Exports the **main** global `PrismaClient` instance. Used for `AppUser`, `Wallet`, `OTP`, `Tenant`, `AggregatedOrder`, etc.

### `config/tenantManager.js`
`getTenantClient(dbUrl)` — returns a cached `PrismaClient` for a specific tenant DB URL. Each brand has an isolated database.

---

## Route Map

All routes are mounted at `/api/app/:tenantId/`

```
POST   /auth/otp/send           public
POST   /auth/otp/verify         public
GET    /auth/me                 auth required

PATCH  /profile                 auth required
DELETE /profile                 auth required

GET    /menu                    public  (requireAppTenant)
GET    /menu/:itemId            public  (requireAppTenant)

GET    /branches                public  (requireAppTenant)
GET    /branches/:branchId      public  (requireAppTenant)
GET    /branches/:branchId/staff public  (requireAppTenant)

POST   /orders/public           public  (requireAppTenant) — guest QR ordering
POST   /orders                  auth + requireAppTenant
GET    /orders                  auth
GET    /orders/:orderId         auth

GET    /wallet                  auth
GET    /wallet/transactions     auth
POST   /wallet/transfer         auth
GET    /wallet/leaderboard      auth
GET    /wallet/gifts            auth
POST   /wallet/gifts/:id/claim  auth
POST   /wallet/gifts/claim-all  auth

GET    /brands                  auth
POST   /brands/:brandId/favorite auth
DELETE /brands/:brandId/favorite auth

GET    /cart                    auth
POST   /cart                    auth
PATCH  /cart/:cartLineId        auth
DELETE /cart/:cartLineId        auth
POST   /cart/clear              auth
```

---

## Auth

### 1. Send OTP — `POST /auth/otp/send`
Sends an OTP to a phone number.

**Body:**
```json
{ "phone": "+966501234567" }
```

**Logic:**
1. Normalizes phone (strips spaces/dashes, ensures `+` prefix)
2. Invalidates any previous unverified OTPs for this phone
3. Generates OTP — always `"1111"` in dev, random 6-digit in production
4. Stores OTP with 10-min expiry in main DB

**Response:**
```json
{ "success": true, "message": "OTP sent successfully" }
```

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Missing or invalid phone number |

---

### 2. Verify OTP — `POST /auth/otp/verify`
Verifies OTP, logs in or registers the customer, and returns a JWT.

**Body:**
```json
{
  "phone": "+966501234567",
  "code": "1111",
  "tenantId": "olive-oak"   // optional — enables brand-specific stats
}
```

**Logic:**
1. Finds latest unverified, non-expired OTP for the phone
2. Marks it as verified
3. Finds or creates `AppUser` in main DB
4. If new user: auto-creates a `Wallet` with 0 points
5. Signs a JWT (`type: "customer"`, 7d expiry)
6. If `tenantId` provided: fetches order count + total spent for that brand

**Response:**
```json
{
  "success": true,
  "token": "eyJ...",
  "isNewUser": false,
  "user": {
    "id": "...", "name": "...", "phone": "+966...",
    "wallet": { "points": 120, "lifetimeEarn": 500, "transactions": [] },
    "ordersCount": 5, "totalSpent": 230.0,
    "favoriteBrandsDetails": [...]
  }
}
```

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Invalid or expired OTP |
| 400 | User deleted — contact admin |

---

### 3. Get Current User — `GET /auth/me`
Returns the current authenticated customer's full profile.

**Auth:** `authenticateAppUser`

**Response:**
```json
{
  "success": true,
  "user": { "id": "...", "name": "...", "wallet": {...}, "ordersCount": 3, "totalSpent": 90.0 }
}
```

**Errors:** `401` if token invalid.

---

## Profile

### 4. Update Profile — `PATCH /profile`
Updates customer profile fields.

**Auth:** `authenticateAppUser`

**Body (all optional):**
```json
{
  "name": "Ali",
  "lastName": "Hassan",
  "email": "ali@example.com",
  "avatarUrl": "/uploads/avatar.jpg",
  "gender": "male",
  "dob": "1995-04-20",
  "cars": [],
  "addresses": [],
  "paymentMethods": [],
  "favoriteBrands": ["olive-oak"]
}
```

**Logic:**
- Only updates provided fields
- Checks email uniqueness if email is changed
- Fetches tenant-scoped order count + total spent if `tenantDb` present

**Response:** Updated user object with wallet summary.

**Errors:**
| Status | Reason |
|--------|--------|
| 404 | User not found |
| 409 | Email already in use |

---

### 5. Delete Account — `DELETE /profile`
Soft-deletes the account: anonymises personal data, resets wallet to 0.

**Auth:** `authenticateAppUser`

**Response:** `{ "success": true, "message": "Account deleted successfully" }`

---

## Menu

> Requires `requireAppTenant` — routes scoped to a tenant DB.

### 6. Get Full Menu — `GET /menu`
Returns all menu categories with their available items.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...", "name": "Burgers", "order": 1,
      "items": [{ "id": "...", "name": "Classic Burger", "price": 35.0, "imageUrl": "https://..." }]
    }
  ]
}
```

**Notes:** Items filtered to `isAvailable: true`, sorted by name.

---

### 7. Get Menu Item — `GET /menu/:itemId`
Returns a single menu item with its category.

**Params:** `:itemId` — menu item ID

**Errors:** `404` if not found.

---

## Branches

> Requires `requireAppTenant` — routes scoped to a tenant DB.

### 8. Get All Branches — `GET /branches`
Lists all branches with open status and tenant feature/settings info.

**Response includes:**
- Branch data (id, name, address, city, lat/lng, hours, isOpen, tablesEnabled, qrEnabled)
- `tenantFeatures`: which subscriptions are active (subQrTable, subQrCashier, subPos, subKds, subCds)
- `tenantSettings`: theme colors, banner URLs, font, layout

---

### 9. Get Branch Detail — `GET /branches/:branchId`
Returns a single branch with its active tables.

**Params:** `:branchId`

**Errors:** `404` if branch not found.

---

### 10. Get Branch Staff — `GET /branches/:branchId/staff`
Returns staff list for a branch. Falls back to mock data if no DB staff found.

**Response:**
```json
[{ "id": "...", "name": "Chef Ahmed", "role": "WAITER", "customRole": "Head Chef", "rating": 4.8, "hasSchedule": true }]
```

---

## Orders

### 11. Place Guest Order (QR) — `POST /orders/public`
Guest order via QR code — no auth required.

**Requires:** `requireAppTenant`

**Body:** Same as authenticated order (see below). `customerId` is null.

**Side effects:** Emits `order:new` via Socket.io to `branch:{branchId}` room.

---

### 12. Place Order — `POST /orders`
Places a new order for the authenticated customer.

**Auth:** `authenticateAppUser` + `requireAppTenant`

**Body:**
```json
{
  "branchId": "...",
  "tableId": "...",           // optional
  "qrCashierId": "...",       // optional
  "type": "DINE_IN",          // DINE_IN | TAKEAWAY | DELIVERY | DELIVER_TO_CAR
  "items": [
    { "menuItemId": "...", "quantity": 2, "notes": "no onions", "selectedModifiers": [] }
  ],
  "notes": "...",
  "paymentMethod": "cash",    // cash | card | points | apple_pay | google_pay
  "staffId": "...",           // optional staff assignment
  "earnRate": 1.0             // loyalty earn rate from brand config
}
```

**Logic:**
1. Validates branch exists and is open
2. Checks tenant subscription flags (subQrTable, subQrCashier)
3. Validates table if provided (active, not expired)
4. Re-prices all items from DB (ignores client prices)
5. If `paymentMethod === "points"`: checks wallet balance, redeems points
6. Generates `SRV-XXXXXX` order number
7. Determines fee rate based on order type (feeQrTable, feeQrCashier, etc.)
8. Creates order in tenant DB
9. Awards loyalty points if `earnRate > 0` and not a points payment
10. Copies order to main DB and aggregated orders (async, non-blocking)

**Response:** `201` — full order with items and branch info.

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Missing branchId or items |
| 404 | Branch / Table / Menu item not found |
| 400 | Branch closed / item unavailable |
| 403 | Feature disabled for this branch or brand |
| 400 | Insufficient wallet points |

---

### 13. Get My Orders — `GET /orders`
Returns paginated order history for the authenticated customer.

**Auth:** `authenticateAppUser`

**Query:**
```
?page=1&limit=20
```

**Logic:** If `tenantDb` present → queries tenant DB. Otherwise queries main DB and enriches from all tenant DBs.

**Response:**
```json
{
  "success": true,
  "orders": [...],
  "pagination": { "total": 42, "page": 1, "limit": 20, "totalPages": 3, "hasNextPage": true }
}
```

---

### 14. Get Order Detail — `GET /orders/:orderId`
Returns a single order. Ensures the order belongs to the requesting customer.

**Errors:** `404` if not found or not owned by the customer.

---

## Wallet

> All routes require `authenticateAppUser`. All data lives in the **main** (global) DB.

### 15. Get Wallet — `GET /wallet`
Returns wallet summary with last 20 transactions.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...", "points": 350, "lifetimeEarn": 1200,
    "recentTransactions": [{ "id": "...", "points": 50, "type": "earn", "description": "Earned on Order #SRV-ABC123", "createdAt": "..." }]
  }
}
```

---

### 16. Get Transactions — `GET /wallet/transactions`
Paginated full transaction history.

**Query:** `?page=1&limit=30` (max 100)

---

### 17. Transfer Points — `POST /wallet/transfer`
Gifts points to another user by phone number.

**Body:**
```json
{ "recipientPhone": "+966501234567", "points": 100, "message": "Happy Birthday!" }
```

**Logic:**
1. Validates sender has enough points
2. Looks up recipient by normalized phone
3. Atomic transaction: deducts from sender, creates a `Gift` record (pending claim)
4. Returns sender's updated wallet

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Non-positive points / insufficient balance |
| 404 | Sender or recipient wallet not found |
| 400 | Cannot transfer to yourself |

---

### 18. Get Gifts — `GET /wallet/gifts`
Lists all gift records received by the current user.

**Response:** Array of `{ id, name, date, message, points, claimed }`.

---

### 19. Claim Gift — `POST /wallet/gifts/:giftId/claim`
Claims a specific gift and credits points to the recipient's wallet.

**Errors:** `403` if not the recipient, `400` if already claimed, `404` if not found.

---

### 20. Claim All Gifts — `POST /wallet/gifts/claim-all`
Claims all unclaimed gifts in a single atomic transaction.

---

### 21. Get Leaderboard — `GET /wallet/leaderboard`
Returns top 10 users globally ranked by current wallet points.

---

## Brands

> All routes require `authenticateAppUser`.

### 22. Get All Brands — `GET /brands`
Lists all active tenants/brands with loyalty rates and user's favorite status.

---

### 23. Add Brand to Favorites — `POST /brands/:brandId/favorite`
Adds a brand to the user's `favoriteBrands` array.

**Returns:** Updated user profile.

---

### 24. Remove Brand from Favorites — `DELETE /brands/:brandId/favorite`
Removes a brand from the user's `favoriteBrands` array.

---

## Cart

> All routes require `authenticateAppUser`. Cart is stored in the **main** DB per user (cross-brand).

### 25. Get Cart — `GET /cart`
Returns all cart items for the current user, sorted by creation time.

---

### 26. Add to Cart — `POST /cart`
Adds an item to the cart. If the `cartLineId` already exists, increments quantity.

**Body:**
```json
{
  "cartLineId": "unique-line-id",
  "brandId": "olive-oak",
  "itemId": "menu-item-id",
  "name": "Classic Burger",
  "price": 35.0,
  "qty": 1,
  "image": "/uploads/burger.jpg",
  "size": "Regular",
  "flavor": null
}
```

**Required:** `cartLineId`, `brandId`, `itemId`, `name`, `price`

**Errors:** `400` if required fields missing.

---

### 27. Update Cart Item Quantity — `PATCH /cart/:cartLineId`
Updates the quantity of a cart line. If `qty <= 0`, removes the item.

**Body:** `{ "qty": 3 }`

**Errors:** `404` if cart item not found.

---

### 28. Remove Cart Item — `DELETE /cart/:cartLineId`
Removes a specific cart line.

**Errors:** `404` if not found.

---

### 29. Clear Cart — `POST /cart/clear`
Removes all cart items for the user.

**Response:** `{ "success": true, "data": [] }`

---

## Global Error Handling

All errors are forwarded via `next(err)` and caught by `errorHandler` middleware.

**Response format:**
```json
{ "success": false, "message": "..." }
```

Special Prisma error `P2002` (unique constraint) → `409 Conflict`.  
In development, `stack` trace is also included.

---

## Notes

- All image URLs returned by the API are absolute (resolved via `getAppImageURL`)
- In **dev mode**, OTP is always `"1111"` regardless of phone number
- Order pricing is always server-side — client-sent prices are ignored and logged if they differ
- Loyalty points are awarded fire-and-forget (non-blocking); errors are logged, not surfaced
- Cart is a global cross-brand cart — the app manages per-brand filtering on the client side
