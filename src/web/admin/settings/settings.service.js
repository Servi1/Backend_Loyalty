const mainPrisma = require("../../../config/prisma");

const defaults = {
  marketEnabled: "true",
  maintenance_mode: "false",
  new_signups: "true",
  guest_checkout: "true",
  scheduled_orders: "false",
  auto_payout: "true",
  refund_enabled: "true",
  push_notifications: "true",
  email_marketing: "false",
  disabledCategories: "",
  platform_vat: "15.0"
};

const DEFAULT_PRIVACY_POLICY = `Privacy Policy
Last updated: September 2026

At Servi, we are committed to protecting your privacy and ensuring your personal information is handled in a safe and responsible manner.

1. Information We Collect
We collect information you provide directly to us when using our application, such as your name, phone number, email address, address details, and order history.

2. How We Use Your Information
We use the information we collect to provide, maintain, and improve our services, process transactions, deliver food & services to your table/location, and communicate loyalty rewards with you.

3. Loyalty & Rewards Program
Your orders accumulate points based on established brand tier rules. Points earned or redeemed are logged securely to your account wallet.

4. Information Sharing
We do not sell or share your personal information with third parties except as necessary to fulfill your orders (such as passing your contact details to brand store staff) or as required by law.

5. Data Security
We implement appropriate technical and organizational security measures to protect your personal data against unauthorized access, alteration, or disclosure.

6. Contact Us
If you have any questions or concerns about this Privacy Policy, please contact our support team at support@servi.com.`;

const DEFAULT_FAQ_LIST = [
  {
    id: "faq_1",
    question: "How do I earn loyalty points on my orders?",
    questionEn: "How do I earn loyalty points on my orders?",
    questionAr: "كيف يمكنني كسب نقاط الولاء على طلباتي؟",
    answer: "You automatically earn points on every completed order paid via cash, card, or digital payment methods according to your brand's earn rate and daily tier limit.",
    answerEn: "You automatically earn points on every completed order paid via cash, card, or digital payment methods according to your brand's earn rate and daily tier limit.",
    answerAr: "تكسب النقاط تلقائيًا على كل طلب مكتمل يتم دفعه نقداً أو بالبطاقة أو عبر طرق الدفع الرقمية وفقًا لمعدل كسب العلامة التجارية وحد المستوى اليومي."
  },
  {
    id: "faq_2",
    question: "How can I redeem my accumulated loyalty points?",
    questionEn: "How can I redeem my accumulated loyalty points?",
    questionAr: "كيف يمكنني استبدال نقاط الولاء المتراكمة؟",
    answer: "During checkout on mobile ordering or QR Table/Cashier ordering, choose 'Pay with Loyalty Points' if you have sufficient points balance in your wallet.",
    answerEn: "During checkout on mobile ordering or QR Table/Cashier ordering, choose 'Pay with Loyalty Points' if you have sufficient points balance in your wallet.",
    answerAr: "أثناء الدفع في الطلب عبر التطبيق أو عند مسح QR الطاولة/الكاشير، اختر 'الدفع بنقاط الولاء' إذا كان لديك رصيد نقاط كافٍ في محفظتك."
  },
  {
    id: "faq_3",
    question: "How do tier levels work (Starter, Bronze, Silver, Gold, Platinum)?",
    questionEn: "How do tier levels work (Starter, Bronze, Silver, Gold, Platinum)?",
    questionAr: "كيف تعمل مستويات العضوية (مبتدئ، برونزي، فضي، ذهبي، بلاتيني)؟",
    answer: "Tier levels are automatically assigned based on your total completed orders and cumulative spend value. Higher tiers unlock higher daily point caps and exclusive benefits.",
    answerEn: "Tier levels are automatically assigned based on your total completed orders and cumulative spend value. Higher tiers unlock higher daily point caps and exclusive benefits.",
    answerAr: "يتم تعيين المستويات تلقائيًا بناءً على إجمالي طلباتك المكتملة وقيمة الإنفاق التراكمي. تتيح المستويات الأعلى سقف نقاط يومي أكبر ومزايا حصرية."
  },
  {
    id: "faq_4",
    question: "What happens if an order is cancelled or refunded?",
    questionEn: "What happens if an order is cancelled or refunded?",
    questionAr: "ماذا يحدث إذا تم إلغاء الطلب أو استرداد قيمته؟",
    answer: "If an order is cancelled or refunded, any loyalty points awarded for that order will be automatically reversed from your wallet.",
    answerEn: "If an order is cancelled or refunded, any loyalty points awarded for that order will be automatically reversed from your wallet.",
    answerAr: "إذا تم إلغاء طلب أو استرداد قيمته، سيتم خصم أي نقاط ولاء تم منحها لذك الطلب تلقائيًا من محفظتك."
  }
];

const DEFAULT_POLICY_POINTS = [
  {
    id: "pol_1",
    title: "1. Information We Collect",
    titleEn: "1. Information We Collect",
    titleAr: "1. المعلومات التي نجمعها",
    content: "We collect information you provide directly to us when using our application, such as your name, phone number, email address, address details, and order transaction history to enable loyalty rewards.",
    contentEn: "We collect information you provide directly to us when using our application, such as your name, phone number, email address, address details, and order transaction history to enable loyalty rewards.",
    contentAr: "نجمع المعلومات التي تقدمها لنا مباشرة عند استخدام تطبيقنا، مثل اسمك ورقم هاتفك والبريد الإلكتروني وتفاصيل العنوان وسجل طلباتك لتمكين المكافآت."
  },
  {
    id: "pol_2",
    title: "2. How We Use Your Information",
    titleEn: "2. How We Use Your Information",
    titleAr: "2. كيف نستخدم معلوماتك",
    content: "We use the information we collect to provide, maintain, and improve our services, process transactions, deliver food & services to your table/location, and calculate loyalty tier rewards.",
    contentEn: "We use the information we collect to provide, maintain, and improve our services, process transactions, deliver food & services to your table/location, and calculate loyalty tier rewards.",
    contentAr: "نستخدم المعلومات التي نجمعها لتقديم خدماتنا وتحسينها، ومعالجة المعاملات، وتوصيل الطلبات والخدمات إلى طاولتك أو موقعك، وحساب مكافآت مستويات الولاء."
  },
  {
    id: "pol_3",
    title: "3. Loyalty & Rewards Program",
    titleEn: "3. Loyalty & Rewards Program",
    titleAr: "3. برنامج الولاء والمكافآت",
    content: "Your orders accumulate points based on established brand tier rules. Points earned or redeemed are logged securely to your account wallet with real-time audit logs.",
    contentEn: "Your orders accumulate points based on established brand tier rules. Points earned or redeemed are logged securely to your account wallet with real-time audit logs.",
    contentAr: "تجمع طلباتك النقاط بناءً على قواعد مستويات العلامة التجارية. يتم تسجيل النقاط المكتسبة أو المستخدمة بأمان في محفظة حسابك مع سجلات تدقيق فورية."
  },
  {
    id: "pol_4",
    title: "4. Information Sharing & Third Parties",
    titleEn: "4. Information Sharing & Third Parties",
    titleAr: "4. مشاركة المعلومات مع الأطراف الثالثة",
    content: "We do not sell or share your personal information with third parties except as necessary to fulfill your orders (such as passing contact details to store staff) or as required by law.",
    contentEn: "We do not sell or share your personal information with third parties except as necessary to fulfill your orders (such as passing contact details to store staff) or as required by law.",
    contentAr: "نحن لا نبيع أو نشارك معلوماتك الشخصية مع أطراف ثالثة إلا عند الضرورة لتلبية طلباتك (مثل تزويد موظفي المتجر بتفاصيل الاتصال) أو وفقًا لما ينص عليه القانون."
  },
  {
    id: "pol_5",
    title: "5. Data Security & Storage",
    titleEn: "5. Data Security & Storage",
    titleAr: "5. أمان البيانات وتخزينها",
    content: "We implement appropriate technical and organizational security measures to protect your personal data against unauthorized access, alteration, loss, or disclosure.",
    contentEn: "We implement appropriate technical and organizational security measures to protect your personal data against unauthorized access, alteration, loss, or disclosure.",
    contentAr: "نطبق إجراءات أمنية فنية وتنظيمية مناسبة لحماية بياناتك الشخصية من الوصول غير المصرح به أو التعديل أو الفقدان أو الإفصاح."
  },
  {
    id: "pol_6",
    title: "6. User Rights & Contact Us",
    titleEn: "6. User Rights & Contact Us",
    titleAr: "6. حقوق المستخدم والتواصل معنا",
    content: "Users can request access to, correction of, or deletion of their personal data at any time by contacting support at support@servi.com.",
    contentEn: "Users can request access to, correction of, or deletion of their personal data at any time by contacting support at support@servi.com.",
    contentAr: "يمكن للمستخدمين طلب الوصول إلى بياناتهم الشخصية أو تصحيحها أو حذفها في أي وقت من خلال التواصل مع الدعم على support@servi.com."
  }
];

const convertPointsToText = (points) => {
  if (!Array.isArray(points) || points.length === 0) return DEFAULT_PRIVACY_POLICY;
  return points.map(p => `${p.title}\n${p.content}`).join("\n\n");
};

const convertToHtml = (str, policyPoints) => {
  if (Array.isArray(policyPoints) && policyPoints.length > 0) {
    return policyPoints
      .map(
        (p) => `<h3 style="color:#4f46e5; margin-top:1.5rem; margin-bottom:0.5rem; font-size:1.1rem; font-weight:700;">${p.title}</h3>
<p style="color:#374151; line-height:1.6; margin-bottom:1rem;">${p.content}</p>`
      )
      .join("");
  }
  if (!str) return "";
  if (str.includes("<p>") || str.includes("<h2>") || str.includes("<div>")) {
    return str;
  }
  return str
    .split("\n\n")
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return "";
      if (/^\d+\.|\bPrivacy Policy\b|\bTerms\b/i.test(trimmed) && trimmed.length < 60) {
        return `<h3 style="color:#4f46e5; margin-top:1.5rem; margin-bottom:0.5rem; font-size:1.1rem; font-weight:700;">${trimmed}</h3>`;
      }
      return `<p style="color:#374151; line-height:1.6; margin-bottom:1rem;">${trimmed}</p>`;
    })
    .join("");
};

const stripHtml = (html) => {
  if (!html) return "";
  return html
    .replace(/<h[1-6][^>]*>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
};

const getSettings = async () => {
  const settings = await mainPrisma.systemSetting.findMany();
  const settingsMap = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  const result = [];
  for (const [key, defaultValue] of Object.entries(defaults)) {
    let value = settingsMap[key];
    if (value === undefined) {
      try {
        const created = await mainPrisma.systemSetting.create({
          data: { key, value: defaultValue }
        });
        value = created.value;
      } catch (err) {
        const found = await mainPrisma.systemSetting.findUnique({ where: { key } });
        value = found ? found.value : defaultValue;
      }
    }
    result.push({ key, value });
  }
  return result;
};

const updateSettings = async (configs) => {
  const updated = [];
  for (const item of configs) {
    const { key, value } = item;
    const stringValue = String(value);
    const record = await mainPrisma.systemSetting.upsert({
      where: { key },
      update: { value: stringValue },
      create: { key, value: stringValue }
    });
    updated.push(record);
  }
  return updated;
};

const getAppContent = async (hostUrl = "", lang = "en") => {
  const [privacyRecord, pointsRecord, pdfRecord, faqRecord] = await Promise.all([
    mainPrisma.systemSetting.findUnique({ where: { key: "privacy_policy" } }),
    mainPrisma.systemSetting.findUnique({ where: { key: "policy_points" } }),
    mainPrisma.systemSetting.findUnique({ where: { key: "privacy_policy_pdf" } }),
    mainPrisma.systemSetting.findUnique({ where: { key: "faq_list" } })
  ]);

  let rawPoints = DEFAULT_POLICY_POINTS;
  if (pointsRecord && pointsRecord.value) {
    try {
      const parsed = JSON.parse(pointsRecord.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        rawPoints = parsed;
      }
    } catch (e) {
      rawPoints = DEFAULT_POLICY_POINTS;
    }
  }

  let rawFaqList = DEFAULT_FAQ_LIST;
  if (faqRecord && faqRecord.value) {
    try {
      const parsedFaq = JSON.parse(faqRecord.value);
      if (Array.isArray(parsedFaq) && parsedFaq.length > 0) {
        rawFaqList = parsedFaq;
      }
    } catch (e) {
      rawFaqList = DEFAULT_FAQ_LIST;
    }
  }

  const isAr = String(lang).toLowerCase().startsWith("ar");

  const policyPoints = rawPoints.map((p) => ({
    id: p.id,
    title: isAr ? (p.titleAr || p.titleEn || p.title || "") : (p.titleEn || p.title || p.titleAr || ""),
    content: isAr ? (p.contentAr || p.contentEn || p.content || "") : (p.contentEn || p.content || p.contentAr || ""),
    titleEn: p.titleEn || p.title || "",
    titleAr: p.titleAr || "",
    contentEn: p.contentEn || p.content || "",
    contentAr: p.contentAr || ""
  }));

  const faqList = rawFaqList.map((f) => ({
    id: f.id,
    question: isAr ? (f.questionAr || f.questionEn || f.question || "") : (f.questionEn || f.question || f.questionAr || ""),
    answer: isAr ? (f.answerAr || f.answerEn || f.answer || "") : (f.answerEn || f.answer || f.answerAr || ""),
    questionEn: f.questionEn || f.question || "",
    questionAr: f.questionAr || "",
    answerEn: f.answerEn || f.answer || "",
    answerAr: f.answerAr || ""
  }));

  let privacyPolicyRaw = privacyRecord ? privacyRecord.value : convertPointsToText(policyPoints);
  const html = convertToHtml(privacyPolicyRaw, policyPoints);
  const text = stripHtml(privacyPolicyRaw);
  const baseUrl = hostUrl.replace(/\/$/, "");

  let pdfUrl = baseUrl ? `${baseUrl}/privacy-policy` : "/privacy-policy";
  let pdfRelativePath = null;
  if (pdfRecord && pdfRecord.value) {
    pdfRelativePath = pdfRecord.value;
    pdfUrl = baseUrl ? `${baseUrl}/${pdfRecord.value.replace(/^\//, "")}` : `/${pdfRecord.value.replace(/^\//, "")}`;
  }

  return {
    type: "pdf",
    hasPdf: true,
    pdfUrl,
    faqUrl: baseUrl ? `${baseUrl}/faq` : "/faq",
    customPdfUploaded: !!pdfRelativePath,
    pdfRelativePath,
    privacyPolicy: privacyPolicyRaw,
    policyPoints,
    rawPolicyPoints: rawPoints,
    content: privacyPolicyRaw,
    html,
    text,
    privacyPolicyUrl: baseUrl ? `${baseUrl}/privacy-policy` : "/privacy-policy",
    faqList,
    rawFaqList
  };
};

const generatePrivacyPolicyPDF = (res, data) => {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="Privacy_Policy.pdf"');

  doc.pipe(res);

  const headingColor = "#0f172a"; // Dark slate/black
  const subtextColor = "#475569";  // Muted slate
  const bodyColor = "#334155";     // Dark gray text
  const dividerColor = "#cbd5e1";  // Slate border

  // Header Title
  doc.font("Helvetica-Bold").fontSize(18).fillColor(headingColor).text("SERVI PLATFORM", 40, 40);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(subtextColor).text("PRIVACY POLICY & TERMS", 40, 64);
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("Last Updated: September 2026", 40, 80);

  // Line Divider
  doc.moveTo(40, 96).lineTo(555, 96).strokeColor(dividerColor).lineWidth(1).stroke();

  doc.y = 115;

  const points = data.policyPoints && data.policyPoints.length > 0 ? data.policyPoints : null;

  if (points) {
    points.forEach((pt, idx) => {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(headingColor).text(pt.title || `Section ${idx + 1}`, {
        paragraphGap: 4
      });
      doc.font("Helvetica").fontSize(10).fillColor(bodyColor).text(pt.content || "", {
        lineGap: 4,
        paragraphGap: 14
      });
    });
  } else if (data.privacyPolicy) {
    doc.font("Helvetica").fontSize(10).fillColor(bodyColor).text(data.privacyPolicy, {
      lineGap: 4,
      paragraphGap: 10
    });
  }

  // Footer on all pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor("#94a3b8").text(
      `Servi Platform Privacy Policy  •  Page ${i + 1} of ${range.count}`,
      40,
      doc.page.height - 30,
      { align: "center", width: 515 }
    );
  }

  doc.end();
};

const generateFaqPDF = (res, faqList = []) => {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="App_FAQs.pdf"');

  doc.pipe(res);

  const headingColor = "#0f172a";
  const subtextColor = "#475569";
  const bodyColor = "#334155";
  const dividerColor = "#cbd5e1";

  // Header Title
  doc.font("Helvetica-Bold").fontSize(18).fillColor(headingColor).text("SERVI PLATFORM", 40, 40);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(subtextColor).text("FREQUENTLY ASKED QUESTIONS (FAQ)", 40, 64);
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("Official Help & Information Guide", 40, 80);

  // Line Divider
  doc.moveTo(40, 96).lineTo(555, 96).strokeColor(dividerColor).lineWidth(1).stroke();

  doc.y = 115;

  if (Array.isArray(faqList) && faqList.length > 0) {
    faqList.forEach((faq, idx) => {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(headingColor).text(`Q${idx + 1}: ${faq.question || ""}`, {
        paragraphGap: 4
      });
      doc.font("Helvetica").fontSize(10).fillColor(bodyColor).text(faq.answer || "", {
        lineGap: 4,
        paragraphGap: 14
      });
    });
  } else {
    doc.font("Helvetica").fontSize(10).fillColor(bodyColor).text("No FAQ items available.", {
      paragraphGap: 10
    });
  }

  // Footer on all pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor("#94a3b8").text(
      `Servi Platform FAQs  •  Page ${i + 1} of ${range.count}`,
      40,
      doc.page.height - 30,
      { align: "center", width: 515 }
    );
  }

  doc.end();
};

const savePrivacyPdf = async (relativePath, hostUrl = "") => {
  await mainPrisma.systemSetting.upsert({
    where: { key: "privacy_policy_pdf" },
    update: { value: relativePath },
    create: { key: "privacy_policy_pdf", value: relativePath }
  });
  return getAppContent(hostUrl);
};

const removePrivacyPdf = async (hostUrl = "") => {
  await mainPrisma.systemSetting.delete({
    where: { key: "privacy_policy_pdf" }
  }).catch(() => null);
  return getAppContent(hostUrl);
};

const updateAppContent = async ({ privacyPolicy, policyPoints, faqList }, hostUrl = "") => {
  const updates = [];

  if (policyPoints !== undefined) {
    const pointsString = typeof policyPoints === "string" ? policyPoints : JSON.stringify(policyPoints);
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "policy_points" },
        update: { value: pointsString },
        create: { key: "policy_points", value: pointsString }
      })
    );

    if (Array.isArray(policyPoints)) {
      const compiledText = convertPointsToText(policyPoints);
      updates.push(
        mainPrisma.systemSetting.upsert({
          where: { key: "privacy_policy" },
          update: { value: compiledText },
          create: { key: "privacy_policy", value: compiledText }
        })
      );
    }
  } else if (privacyPolicy !== undefined) {
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "privacy_policy" },
        update: { value: String(privacyPolicy) },
        create: { key: "privacy_policy", value: String(privacyPolicy) }
      })
    );
  }

  if (faqList !== undefined) {
    const faqString = typeof faqList === "string" ? faqList : JSON.stringify(faqList);
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "faq_list" },
        update: { value: faqString },
        create: { key: "faq_list", value: faqString }
      })
    );
  }

  await Promise.all(updates);
  return getAppContent(hostUrl);
};

module.exports = {
  getSettings,
  updateSettings,
  getAppContent,
  updateAppContent,
  savePrivacyPdf,
  removePrivacyPdf,
  generatePrivacyPolicyPDF,
  generateFaqPDF,
  convertToHtml,
  stripHtml
};
