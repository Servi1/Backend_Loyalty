const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");
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

    if (!ticket) {
      ticket = await mainPrisma.supportTicket.findFirst({
        where: { appUserId },
        orderBy: { lastMessageAt: "desc" },
        include: {
          messages: { orderBy: { createdAt: "asc" } }
        }
      });
    }
  }

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
  if (orderPrefix.trim()) {
    filterWhere.text = { contains: orderPrefix.trim() };
  }

  const existingMsgsCount = await mainPrisma.supportMessage.count({ where: filterWhere });

  const customerTime = new Date();
  const message = await mainPrisma.supportMessage.create({
    data: {
      ticketId: ticket.id,
      senderType: "CUSTOMER",
      senderId: appUserId,
      senderName: user?.name || user?.phone || "Customer",
      text: messageText,
      attachments: attachments || [],
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

module.exports = {
  getCustomerThread,
  sendCustomerMessage,
};
