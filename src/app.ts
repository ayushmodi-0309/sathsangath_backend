import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./lib/config";
import { logger } from "./lib/logger";
import { errorHandler } from "./lib/http";
import { publicRouter } from "./routes/public";
import { authRouter } from "./routes/auth";
import { accountRouter } from "./routes/account";
import { memberRouter } from "./routes/member";
import { adminRouter } from "./routes/admin";

export const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
// Native mobile apps send no Origin header and are unaffected by CORS.
const corsOptions: cors.CorsOptions = {
  origin: (o, cb) => cb(null, !o || config.corsOrigins.includes(o)),
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-App-Platform", "X-App-Version", "X-App-Build"],
  maxAge: 86400,
};
app.use(cors(corsOptions));
// Which client made the call, as explicit fields: " platform=ios version=1.1.2 build=10" or " platform=web".
// Each field appears only when the client sent it, so calls from older app builds log exactly as before.
// The values are client-supplied, so they are trimmed to a safe alphabet before they reach the log.
const clean = (v: unknown) => String(Array.isArray(v) ? v[0] : v ?? "").replace(/[^\w.+-]/g, "").slice(0, 24);
morgan.token("client", (req) => {
  const fields: [string, string][] = [
    ["platform", clean(req.headers["x-app-platform"])],
    ["version", clean(req.headers["x-app-version"])],
    ["build", clean(req.headers["x-app-build"])],
  ];
  // Morgan prints "-" for an empty token, so a blank stands in when the client sent nothing.
  return fields.filter(([, v]) => v).map(([k, v]) => ` ${k}=${v}`).join("") || " ";
});
app.use(morgan(":method :url :status :res[content-length] - :response-time ms:client", {
  stream: { write: (line) => logger.info(line.trim(), { source: "http" }) },
}));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_r, res) => res.json({ ok: true }));

// Versioned API: the same contract serves the website and the future Android / iOS apps.
const v1 = express.Router();
v1.use("/public", publicRouter);
v1.use("/auth", authRouter);
v1.use("/account", accountRouter);
v1.use("/member", memberRouter);
v1.use("/admin", adminRouter);
app.use("/api/v1", v1);

app.use((_r, res) => res.status(404).json({ error: "Not found." }));
app.use(errorHandler);

// Vercel auto-detects src/app.ts as the Express entry and requires a default export.
export default app;
