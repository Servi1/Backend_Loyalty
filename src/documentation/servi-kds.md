# Servi KDS — Kitchen Display System API Documentation

> **Base URL:** `/api/kds/`  
> **Purpose:** Handles kitchen order display operations — viewing active orders and managing their lifecycle (bump to READY, recall to PREPARING).

---

## Middleware

### `authenticateKds` — `middlewares/kdsMiddleware.js`
Single combined middleware for **tenant resolution + authentication + role authorization** on every KDS request.

**Steps:**
1. Extracts tenant from `x-tenant-id` header → `req.params.tenantId` → `?tenantId` query
2. Looks up tenant in main DB (by id or slug), verifies `isActive`
3. Attaches `req.tenantId`, `req.tenant`, `req.tenantDb`
4. Extracts JWT token from `Authorization: Bearer ...` header or `?token` query param
5. Looks up user in **tenant DB** — must exist
6. Enforces role: `KITCHEN` or `BRAND_MANAGER`
7. Blocks access if branch is deactivated (unless `BRAND_MANAGER`)

**Attaches:** `req.user`, `req.tenantDb`, `req.tenantId`, `req.tenant`

**Errors:**
| Status | Reason |
|--------|--------|
| 400 | Missing tenant ID |
| 404 | Tenant not found or inactive |
| 401 | Missing / invalid / expired token |
| 401 | Kitchen user no longer exists |
| 403 | Only Kitchen Staff can access KDS endpoints |
| 403 | Branch currently deactivated |

> **Note:** Same structure as `authenticatePos` but enforces `KITCHEN` role instead of `CASHIER`.

---

## Route Map

```
GET    /orders              → active + completed orders for the branch
PATCH  /orders/:id/bump     → mark order as READY (bump from kitchen)
PATCH  /orders/:id/recall   → recall order back to PREPARING
```

---

## Order Status Lifecycle (KDS perspective)

```
PENDING → ACCEPTED → PREPARING → READY
                                   ↑
                               (bump)
                                   ↓
                               (recall)
                               PREPARING
```

KDS only works with orders in `PENDING`, `ACCEPTED`, `PREPARING`, `READY` statuses.  
`COMPLETED` and `CANCELLED` are managed by POS, not KDS.

---

## Order Format (KDS)

All KDS endpoints return orders mapped to a standardized KDS format:

```json
{
  "id": "order-uuid",
  "orderNumber": "ORD-123456",
  "tableNumber": 3,         // 0 if no table / takeaway
  "orderType": "Dine In",   // "Dine In" | "Takeaway" | "Delivery"
  "customerName": "Ali Hassan",  // or "Walk-in"
  "status": "new",          // "new" | "preparing" | "ready"
  "createdAt": 1720000000000,  // Unix timestamp (ms)
  "elapsedTime": 12,           // minutes since order was placed
  "station": "kitchen",        // "kitchen" | "drinks" | "desserts"
  "items": [
    { "id": "...", "name": "Classic Burger", "quantity": 2, "details": "no onions" }
  ]
}
```

**Station detection logic (auto-assigned from item categories):**
| Category contains | Station |
|-------------------|---------|
| "drink" or "beverage" | `drinks` |
| "dessert" or "sweet" | `desserts` |
| anything else | `kitchen` |

**Status mapping:**
| DB Status | KDS Status |
|-----------|------------|
| PENDING / ACCEPTED | `new` |
| PREPARING | `preparing` |
| READY | `ready` |

---

## Endpoints

### 1. Get KDS Orders — `GET /orders`
Returns all active and completed (ready) orders for the kitchen's branch.

**Auth:** `authenticateKds`

**Branch context:** Taken from `req.user.branchId` — no param needed.

**Response:**
```json
{
  "success": true,
  "data": {
    "activeOrders": [
      {
        "id": "...", "orderNumber": "ORD-123456",
        "tableNumber": 3, "orderType": "Dine In",
        "customerName": "Walk-in", "status": "new",
        "createdAt": 1720000000000, "elapsedTime": 5,
        "station": "kitchen",
        "items": [{ "id": "...", "name": "Pasta", "quantity": 1, "details": "" }]
      }
    ],
    "completedOrders": [
      { "...": "same structure", "status": "ready" }
    ]
  }
}
```

**Logic:**
- Fetches orders from tenant DB with statuses: `PENDING`, `ACCEPTED`, `PREPARING`, `READY`
- Includes full item details with category (needed for station assignment)
- Ordered by `createdAt ASC` (oldest first — FIFO)
- Splits into `activeOrders` (new/preparing) and `completedOrders` (ready)

---

### 2. Bump Order (Mark Ready) — `PATCH /orders/:id/bump`
Marks an order as `READY` — indicates kitchen has finished preparation.

**Auth:** `authenticateKds`

**Params:** `:id` — order ID

**Body:** _(none required)_

**Logic:**
1. Verifies order exists in tenant DB
2. Updates status to `READY` in tenant DB
3. Syncs status to main DB order record (if exists)
4. Syncs to aggregated orders in main DB (async, fire-and-forget)

**Response:**
```json
{ "success": true, "data": { "...": "full KDS-formatted order", "status": "ready" } }
```

**Errors:**
| Status | Reason |
|--------|--------|
| 404 | Order not found |

---

### 3. Recall Order (Back to Preparing) — `PATCH /orders/:id/recall`
Recalls an order back to `PREPARING` — used if kitchen bumped an order by mistake.

**Auth:** `authenticateKds`

**Params:** `:id` — order ID

**Body:** _(none required)_

**Logic:**
1. Verifies order exists in tenant DB
2. Updates status to `PREPARING` in tenant DB
3. Syncs status to main DB order record (if exists)
4. Syncs to aggregated orders in main DB (async, fire-and-forget)

**Response:**
```json
{ "success": true, "data": { "...": "full KDS-formatted order", "status": "preparing" } }
```

**Errors:**
| Status | Reason |
|--------|--------|
| 404 | Order not found |

---

## Aggregated Order Sync

Both `bumpOrder` and `recallOrder` fire-and-forget sync the updated order to:
1. **Main DB `Order`** — updates `status` and `updatedAt` if a matching record exists
2. **Main DB `AggregatedOrder`** — upserts using `{tenantId}_{orderId}` as composite key

Sync errors are logged but do not fail the API response.

---

## Notes

- KDS has **no create or delete** — it is purely a display + status transition system
- Orders are always fetched in FIFO order (`createdAt ASC`) so older tickets appear first
- `elapsedTime` is calculated server-side in minutes (live at query time)
- The KDS does not directly trigger loyalty points — that is handled by POS when marking `COMPLETED`
- Kitchen user `branchId` is embedded in their JWT profile — no need to send branch in requests
- `tableNumber` is parsed from the table's `label` field (e.g. `"T3"` → `3`); defaults to `0` for takeaway/delivery
