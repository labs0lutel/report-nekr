require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "vrumexp",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD != null ? String(process.env.PGPASSWORD) : undefined,
});

const CORS_ORIGINS = [
  "https://labs0lutel.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || CORS_ORIGINS.some((o) => origin === o || origin.startsWith("http://localhost")))
        return cb(null, true);
      cb(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "2mb" }));

app.use((err, _req, res, _next) => {
  if (err) {
    console.error("Express error:", err);
    res.status(500).json({ error: "Ошибка сервера", detail: err.message });
  }
});

app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) console.log(req.method, req.path);
  next();
});

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.get("/api/reports", async (_, res) => {
  try {
    const r = await pool.query(
      "SELECT id, data, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM reports ORDER BY (data->>'date') DESC NULLS LAST, updated_at DESC"
    );
    const reports = r.rows.map((row) => ({
      ...row.data,
      id: row.id,
      createdAt: row.createdAt ? new Date(row.createdAt).getTime() : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
    }));
    res.json(reports);
  } catch (e) {
    console.error("GET /api/reports", e);
    res.status(500).json({ error: "Ошибка загрузки отчётов" });
  }
});

app.post("/api/reports", async (req, res) => {
  let sent = false;
  const send = (code, body) => {
    if (sent) return;
    sent = true;
    res.status(code).json(body);
  };
  try {
    const body = req.body || {};
    const id = body.id || require("crypto").randomUUID();
    const data = { ...body, id };
    const createdAt = new Date();
    const updatedAt = new Date();

    const jsonStr = JSON.stringify(data);
    if (jsonStr.length > 1e6) {
      return send(413, { error: "Отчёт слишком большой" });
    }

    await pool.query(
      `INSERT INTO reports (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = $4`,
      [id, jsonStr, createdAt, updatedAt]
    );

    send(201, {
      ...data,
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
    });
  } catch (e) {
    console.error("POST /api/reports", e);
    send(500, { error: "Ошибка сохранения отчёта", detail: e.message });
  }
});

app.put("/api/reports/:id", async (req, res) => {
  let sent = false;
  const send = (code, body) => {
    if (sent) return;
    sent = true;
    res.status(code).json(body);
  };
  try {
    const id = req.params.id;
    const body = req.body || {};
    const data = { ...body, id };
    const updatedAt = new Date();
    const jsonStr = JSON.stringify(data);

    const r = await pool.query(
      `UPDATE reports SET data = $2::jsonb, updated_at = $3 WHERE id = $1 RETURNING created_at`,
      [id, jsonStr, updatedAt]
    );
    if (r.rowCount === 0) {
      await pool.query(
        `INSERT INTO reports (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`,
        [id, jsonStr, updatedAt]
      );
    }

    send(200, {
      ...data,
      createdAt: r.rows[0]?.created_at ? new Date(r.rows[0].created_at).getTime() : updatedAt.getTime(),
      updatedAt: updatedAt.getTime(),
    });
  } catch (e) {
    console.error("PUT /api/reports/:id", e);
    send(500, { error: "Ошибка обновления отчёта", detail: e.message });
  }
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

ensureTable()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Reports API: http://0.0.0.0:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("DB init failed:", e.message);
    process.exit(1);
  });
