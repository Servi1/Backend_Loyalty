const mainPrisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");
const crypto = require("crypto");

const generateTicketNumber = () => {
  const hex = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TICK-${hex}`;
};

/**
 * App Customer API: Get or create customer's active support thread
 */
const getCustomerThread = async (appUserId, options = {}) => {
  const forceNew = options.createNew === true || options.createNew === "true";
  const { ticketId, orderId, orderNumber } = options;
  let ticket = null;

  // 1. Explicit lookup by ticketId
  if (ticketId) {
    ticket = await mainPrisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
    if (ticket && ticket.appUserId !== appUserId) {
      ticket = null;
    }
  }

  // 2. Lookup ticket exclusive to orderId / orderNumber if provided
  if (!ticket && !forceNew && (orderId || orderNumber)) {
    const targetId = orderId ? String(orderId) : null;
    const targetNum = orderNumber ? String(orderNumber) : null;

    const whereConditions = [];
    if (targetId) whereConditions.push({ orderId: targetId });
    if (targetNum) whereConditions.push({ orderNumber: targetNum });

    ticket = await mainPrisma.supportTicket.findFirst({
      where: {
        appUserId,
        OR: whereConditions,
      },
      orderBy: { createdAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });

    // Fallback: search candidate tickets messages if orderId/orderNumber field wasn't set when ticket was created
    if (!ticket) {
      const candidateTickets = await mainPrisma.supportTicket.findMany({
        where: { appUserId },
        orderBy: { lastMessageAt: "desc" },
        include: {
          messages: { orderBy: { createdAt: "asc" } }
        }
      });

      const lowerNum = targetNum ? targetNum.toLowerCase() : null;
      const lowerId = targetId ? targetId.toLowerCase() : null;

      for (const cand of candidateTickets) {
        const hasOrderMatch = cand.messages.some((m) => {
          if (!m.text) return false;
          const lower = m.text.toLowerCase();
          return (
            (lowerNum && lower.includes(`order #${lowerNum}`)) ||
            (lowerNum && lower.includes(lowerNum)) ||
            (lowerId && lower.includes(lowerId))
          );
        });

        if (hasOrderMatch) {
          ticket = cand;
          // Retroactively update ticket with orderId / orderNumber
          await mainPrisma.supportTicket.update({
            where: { id: cand.id },
            data: {
              orderId: targetId || cand.orderId,
              orderNumber: targetNum || cand.orderNumber,
            }
          }).catch(() => null);
          break;
        }
      }
    }
  }

  // 3. Fallback: ONLY if no specific order is specified and forceNew is false
  if (!ticket && !forceNew && !orderId && !orderNumber) {
    ticket = await mainPrisma.supportTicket.findFirst({
      where: { appUserId, orderId: null, orderNumber: null, status: "OPEN" },
      orderBy: { lastMessageAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
  }

  // 4. Force new ticket creation if explicitly requested
  if (!ticket && forceNew) {
    const user = await mainPrisma.appUser.findUnique({ where: { id: appUserId } });
    if (!user) throw new ApiError(404, "User not found");

    ticket = await mainPrisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        appUserId: user.id,
        customerName: user.name || user.phone || "Customer",
        customerPhone: user.phone || null,
        customerEmail: user.email || null,
        orderId: orderId ? String(orderId) : null,
        orderNumber: orderNumber ? String(orderNumber) : null,
        status: "OPEN",
        lastMessage: "Conversation initialized",
        lastMessageAt: new Date(),
      },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });
  }

  if (ticket && ticket.unreadCustomer > 0) {
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
const sendCustomerMessage = async (appUserId, { text, attachments = [], ticketId = null, orderId = null, orderNumber = null }) => {
  let ticket = null;
  const targetId = orderId ? String(orderId) : null;
  const targetNum = orderNumber ? String(orderNumber) : null;

  if (ticketId) {
    ticket = await mainPrisma.supportTicket.findUnique({
      where: { id: ticketId }
    });
  }

  // If ticket is missing or closed or belongs to another user/order, try to find an OPEN ticket for this specific order
  if ((!ticket || ticket.appUserId !== appUserId || ticket.status === "CLOSED" || ticket.status === "RESOLVED") && (targetId || targetNum)) {
    const whereConditions = [];
    if (targetId) whereConditions.push({ orderId: targetId });
    if (targetNum) whereConditions.push({ orderNumber: targetNum });

    ticket = await mainPrisma.supportTicket.findFirst({
      where: {
        appUserId,
        status: "OPEN",
        OR: whereConditions,
      },
      orderBy: { createdAt: "desc" }
    });

    if (!ticket) {
      const candidateTickets = await mainPrisma.supportTicket.findMany({
        where: { appUserId, status: "OPEN" },
        orderBy: { lastMessageAt: "desc" }
      });

      const lowerNum = targetNum ? targetNum.toLowerCase() : null;
      const lowerId = targetId ? targetId.toLowerCase() : null;

      for (const cand of candidateTickets) {
        const msgs = await mainPrisma.supportMessage.findMany({
          where: { ticketId: cand.id },
          take: 10
        });
        const hasMatch = msgs.some((m) => {
          const lower = (m.text || "").toLowerCase();
          return (
            (lowerNum && lower.includes(`order #${lowerNum}`)) ||
            (lowerNum && lower.includes(lowerNum)) ||
            (lowerId && lower.includes(lowerId))
          );
        });
        if (hasMatch) {
          ticket = cand;
          await mainPrisma.supportTicket.update({
            where: { id: cand.id },
            data: {
              orderId: targetId || cand.orderId,
              orderNumber: targetNum || cand.orderNumber,
            }
          }).catch(() => null);
          break;
        }
      }
    }
  }

  // If still no ticket found for this order, create a BRAND NEW ticket specifically for this order
  if (!ticket || ticket.status === "CLOSED" || ticket.status === "RESOLVED") {
    const user = await mainPrisma.appUser.findUnique({ where: { id: appUserId } });
    ticket = await mainPrisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        appUserId: appUserId,
        customerName: user?.name || user?.phone || "Customer",
        customerPhone: user?.phone || null,
        customerEmail: user?.email || null,
        orderId: targetId,
        orderNumber: targetNum,
        status: "OPEN",
        lastMessage: text || "Attachment",
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

  // Count existing customer messages for this specific ticket thread
  const filterWhere = {
    ticketId: ticket.id,
    senderType: "CUSTOMER",
  };

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
  const user = await mainPrisma.appUser.findUnique({ where: { id: appUserId } });
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

  // Send auto-reply ONLY on the first message sent by customer for this ticket thread
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

module.exports = {
  getCustomerThread,
  sendCustomerMessage,
};
