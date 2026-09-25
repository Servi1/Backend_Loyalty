const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");
const crypto = require("crypto");

const generateTicketNumber = () => {
  const hex = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TICK-${hex}`;
};

/**
 * List all support tickets / chat conversations for Super Admin
 */
const getTickets = async ({ status, search, page = 1, limit = 50 }) => {
  const where = {};

  if (status && status !== "ALL") {
    where.status = status.toUpperCase();
  }

  if (search && search.trim()) {
    const query = search.trim();
    where.OR = [
      { customerName: { contains: query, mode: "insensitive" } },
      { customerPhone: { contains: query, mode: "insensitive" } },
      { customerEmail: { contains: query, mode: "insensitive" } },
      { ticketNumber: { contains: query, mode: "insensitive" } },
    ];
  }

  const take = Number(limit) || 50;
  const skip = (Math.max(1, Number(page)) - 1) * take;

  const [tickets, total] = await Promise.all([
    mainPrisma.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take,
      skip,
      include: {
        appUser: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            avatarUrl: true,
          }
        }
      }
    }),
    mainPrisma.supportTicket.count({ where })
  ]);

  return {
    tickets,
    total,
    page: Number(page),
    limit: take,
  };
};

/**
 * Get ticket details & full chat message thread
 */
const getTicketById = async (ticketId) => {
  const ticket = await mainPrisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      appUser: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          avatarUrl: true,
          createdAt: true,
          _count: {
            select: { supportTickets: true }
          },
          supportTickets: {
            select: {
              id: true,
              ticketNumber: true,
              customerName: true,
              customerPhone: true,
              customerEmail: true,
              status: true,
              createdAt: true,
              lastMessage: true,
              lastMessageAt: true,
              unreadAdmin: true,
              unreadCustomer: true,
            },
            orderBy: { createdAt: "desc" }
          },
          wallets: {
            select: {
              points: true,
              tier: true,
              tenantId: true,
              tenant: {
                select: {
                  id: true,
                  name: true,
                  logoUrl: true,
                }
              }
            }
          }
        }
      },
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!ticket) {
    throw new ApiError(404, "Support ticket not found");
  }

  // Clear unread count for admin when opened
  if (ticket.unreadAdmin > 0) {
    await mainPrisma.supportTicket.update({
      where: { id: ticketId },
      data: { unreadAdmin: 0 }
    }).catch(() => null);
  }

  return ticket;
};

/**
 * Super Admin sends a chat message
 */
const sendAdminMessage = async (ticketId, { text, attachments = [], senderName = "Super Admin", adminId = null }) => {
  const ticket = await mainPrisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    throw new ApiError(404, "Support ticket not found");
  }

  const messageText = (text || "").trim();
  if (!messageText && (!attachments || attachments.length === 0)) {
    throw new ApiError(400, "Message content cannot be empty");
  }

  const message = await mainPrisma.supportMessage.create({
    data: {
      ticketId,
      senderType: "ADMIN",
      senderId: adminId,
      senderName,
      text: messageText,
      attachments: attachments || [],
    }
  });

  const updatedTicket = await mainPrisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      lastMessage: messageText || "Attachment",
      lastMessageAt: new Date(),
      unreadCustomer: { increment: 1 },
      status: ticket.status === "CLOSED" ? "OPEN" : ticket.status
    },
    include: {
      appUser: {
        select: { id: true, name: true, phone: true, email: true, avatarUrl: true }
      }
    }
  });

  return { message, ticket: updatedTicket };
};

/**
 * Update ticket status (OPEN | RESOLVED | CLOSED) or assignment
 */
const updateTicketStatus = async (ticketId, { status, assignedTo }) => {
  const data = {};
  if (status) data.status = status.toUpperCase();
  if (assignedTo !== undefined) data.assignedTo = assignedTo;

  const ticket = await mainPrisma.supportTicket.update({
    where: { id: ticketId },
    data,
    include: {
      appUser: {
        select: { id: true, name: true, phone: true, email: true, avatarUrl: true }
      }
    }
  });

  return ticket;
};

/**
 * Start or find a chat conversation with a specific Servi customer (AppUser)
 */
const startChatWithCustomer = async (appUserId) => {
  const user = await mainPrisma.appUser.findUnique({ where: { id: appUserId } });
  if (!user) {
    throw new ApiError(404, "Customer not found");
  }

  let ticket = await mainPrisma.supportTicket.findFirst({
    where: { appUserId, status: "OPEN" },
    orderBy: { lastMessageAt: "desc" }
  });

  if (!ticket) {
    ticket = await mainPrisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        appUserId: user.id,
        customerName: user.name || user.phone || "Customer",
        customerPhone: user.phone || null,
        customerEmail: user.email || null,
        status: "OPEN",
        lastMessage: "Chat conversation started by Support",
        lastMessageAt: new Date(),
      }
    });

    // Create initial greeting message
    await mainPrisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderType: "ADMIN",
        senderName: "Servi Support",
        text: `Hello ${user.name || "Customer"}, how can we assist you today?`,
      }
    });
  }

  return getTicketById(ticket.id);
};

/**
 * App Customer API: Get or create customer's active support thread
 */
const getCustomerThread = async (appUserId, options = {}) => {
  const forceNew = options.createNew === true || options.createNew === "true";
  let ticket = null;

  if (options.ticketId) {
    ticket = await mainPrisma.supportTicket.findUnique({
      where: { id: options.ticketId },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
    if (ticket && ticket.appUserId !== appUserId) {
      ticket = null;
    }
  }

  if (!ticket && !forceNew) {
    ticket = await mainPrisma.supportTicket.findFirst({
      where: { appUserId, status: "OPEN" },
      orderBy: { lastMessageAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
  }

  if (!ticket) {
    const user = await mainPrisma.appUser.findUnique({ where: { id: appUserId } });
    if (!user) throw new ApiError(404, "User not found");

    ticket = await mainPrisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        appUserId: user.id,
        customerName: user.name || user.phone || "Customer",
        customerPhone: user.phone || null,
        customerEmail: user.email || null,
        status: "OPEN",
        lastMessage: "Conversation initialized",
        lastMessageAt: new Date(),
      },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
  }

  if (ticket.unreadCustomer > 0) {
    await mainPrisma.supportTicket.update({
      where: { id: ticket.id },
      data: { unreadCustomer: 0 }
    }).catch(() => null);
  }

  return ticket;
};

/**
 * App Customer API: Customer sends a message
 */
const sendCustomerMessage = async (appUserId, { text, attachments = [], ticketId = null }) => {
  let ticket = null;

  if (ticketId) {
    ticket = await mainPrisma.supportTicket.findUnique({
      where: { id: ticketId }
    });
  }

  if (!ticket || ticket.appUserId !== appUserId || ticket.status === "CLOSED" || ticket.status === "RESOLVED") {
    ticket = await mainPrisma.supportTicket.findFirst({
      where: { appUserId, status: "OPEN" },
      orderBy: { lastMessageAt: "desc" }
    });
  }

  const user = await mainPrisma.appUser.findUnique({ where: { id: appUserId } });

  if (!ticket) {
    ticket = await mainPrisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        appUserId: appUserId,
        customerName: user?.name || user?.phone || "Customer",
        customerPhone: user?.phone || null,
        customerEmail: user?.email || null,
        status: "OPEN",
        lastMessage: text,
        lastMessageAt: new Date(),
      }
    });
  }

  const messageText = (text || "").trim();

  // Extract order prefix if present (e.g., "[Order #12345]")
  let orderPrefix = "";
  const orderMatch = messageText.match(/^(\[Order\s*#?[^\]]+\])/i);
  if (orderMatch) {
    orderPrefix = orderMatch[1] + " ";
  }

  // Count existing customer messages for this specific ticket & order thread
  const filterWhere = {
    ticketId: ticket.id,
    senderType: "CUSTOMER",
  };
  if (orderPrefix.trim()) {
    filterWhere.text = { contains: orderPrefix.trim() };
  }

  const existingMsgsCount = await mainPrisma.supportMessage.count({ where: filterWhere });

  const formattedAttachments = (attachments || [])
    .map((att) => {
      let raw = typeof att === "string" ? att : att?.imageUrl || att?.url || att?.filename || "";
      raw = String(raw).trim();
      if (!raw) return null;
      if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
      if (raw.includes("/uploads/")) {
        const idx = raw.indexOf("/uploads/");
        return raw.substring(idx);
      }
      if (raw.startsWith("/")) return `/uploads/support${raw}`;
      return `/uploads/support/${raw}`;
    })
    .filter(Boolean);

  const customerTime = new Date();
  const message = await mainPrisma.supportMessage.create({
    data: {
      ticketId: ticket.id,
      senderType: "CUSTOMER",
      senderId: appUserId,
      senderName: user?.name || user?.phone || "Customer",
      text: messageText,
      attachments: formattedAttachments,
      createdAt: customerTime,
    }
  });

  let agentMessage = null;
  let lastMsgText = messageText || "Attachment";

  // Send auto-reply ONLY on the first message sent by customer for this order thread
  if (existingMsgsCount === 0) {
    const autoReplyText = `${orderPrefix}Welcome to servi support. All our executives are busy, Please wait until we connect you to an agent.`;
    const agentTime = new Date(customerTime.getTime() + 1000);

    agentMessage = await mainPrisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderType: "ADMIN",
        senderName: "Servi Support",
        text: autoReplyText,
        attachments: [],
        createdAt: agentTime,
      }
    });

    lastMsgText = autoReplyText;
  }

  const updatedTicket = await mainPrisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      lastMessage: lastMsgText,
      lastMessageAt: new Date(),
      unreadAdmin: { increment: 1 },
      status: "OPEN"
    }
  });

  return { message, agentMessage, ticket: updatedTicket };
};

/**
 * List all registered Servi customers for starting a new chat
 */
const getRegisteredCustomers = async (search = "") => {
  const where = { isDelete: false };
  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const users = await mainPrisma.appUser.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return users;
};

/**
 * Delete / Clear all old logic support tickets & messages
 */
const clearAllTickets = async () => {
  const [deletedMessages, deletedTickets] = await mainPrisma.$transaction([
    mainPrisma.supportMessage.deleteMany({}),
    mainPrisma.supportTicket.deleteMany({}),
  ]);

  return {
    deletedMessagesCount: deletedMessages.count,
    deletedTicketsCount: deletedTickets.count,
  };
};

module.exports = {
  getTickets,
  getTicketById,
  sendAdminMessage,
  updateTicketStatus,
  startChatWithCustomer,
  getCustomerThread,
  sendCustomerMessage,
  getRegisteredCustomers,
  clearAllTickets,
};
