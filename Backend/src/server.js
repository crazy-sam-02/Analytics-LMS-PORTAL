const http = require("http");
const net = require("net");
const app = require("./app");
const prisma = require("./config/db");
const env = require("./config/env");
const { initSocket } = require("./realtime/socket");

const server = http.createServer(app);
initSocket(server, env.frontendOrigin);

const shutdown = async (signal) => {
  console.log(`Received ${signal}. Closing resources...`);
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const parsePort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : 5000;
};

const canListenOnPort = (port) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port);
  });

const startServer = async () => {
  const basePort = parsePort(env.port);
  let selectedPort = basePort;

  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = basePort + offset;
    const available = await canListenOnPort(candidate);
    if (available) {
      selectedPort = candidate;
      break;
    }
  }

  server.listen(selectedPort, () => {
    if (selectedPort !== basePort) {
      console.warn(`Port ${basePort} is busy. Using fallback port ${selectedPort}.`);
    }
    console.log(`LMS API running at http://localhost:${selectedPort}`);
  });
};

startServer();
