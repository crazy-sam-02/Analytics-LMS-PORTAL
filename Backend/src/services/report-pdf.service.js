const fs = require("node:fs");
const puppeteer = require("puppeteer");

const WINDOWS_BROWSER_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const resolveExecutablePath = () => {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  return WINDOWS_BROWSER_PATHS.find((filePath) => fs.existsSync(filePath)) || undefined;
};

const renderHtmlToPdfBuffer = async (html, options = {}) => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(String(html || ""), {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: options.timeout || 45000,
    });

    await page.emulateMediaType("screen");

    const showHeaderFooter = Boolean(options.displayHeaderFooter || options.headerTemplate || options.footerTemplate);
    const margin = options.margin || {
      top: "12mm",
      right: "10mm",
      bottom: showHeaderFooter ? "16mm" : "12mm",
      left: "10mm",
    };

    const pdfData = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: showHeaderFooter,
      headerTemplate: options.headerTemplate || "<div></div>",
      footerTemplate: options.footerTemplate || "<div></div>",
      margin,
    });

    // Puppeteer can return Uint8Array in newer versions; normalize to Buffer for Express binary responses.
    return Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData);
  } finally {
    await browser.close();
  }
};

module.exports = {
  renderHtmlToPdfBuffer,
};
