const catchAsync = require("../../../utils/catchAsync");
const pagersService = require("../../tenant/pagers/pagers.service");
const mainPrisma = require("../../../config/prisma");

const getPagerInfo = catchAsync(async (req, res) => {
  const info = await pagersService.getPublicPagerInfo(req.params.pagerId);
  res.json({ success: true, data: info });
});

const joinQueue = catchAsync(async (req, res) => {
  const io = req.app.get("io");
  const result = await pagersService.submitCustomerTicket(
    req.params.pagerId,
    req.body,
    mainPrisma,
    io
  );
  res.status(201).json({
    success: true,
    data: result.ticket,
    isExisting: result.isExisting,
    brand: result.brand,
  });
});

const getTicketStatus = catchAsync(async (req, res) => {
  const result = await pagersService.getPublicTicketStatus(req.params.ticketId, mainPrisma);
  res.json({ success: true, data: result.ticket, brand: result.brand });
});

module.exports = {
  getPagerInfo,
  joinQueue,
  getTicketStatus,
};

