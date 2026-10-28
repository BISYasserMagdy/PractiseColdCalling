// Vercel Serverless Function: stores shared calls so links stay short.
// Needs a Redis REST store (Vercel Marketplace: Upstash Redis). Env vars set automatically:
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN).
import { randomBytes } from "crypto";

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const TTL = 60 * 60 * 24 * 30; // 30 days

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || "redis error");
  return j.result;
}

export default async function handler(req, res) {
  if (!URL_ || !TOKEN) return res.status(501).json({ error: "Share storage is not configured" });
  try {
    if (req.method === "POST") {
      const d = (req.body || {}).d;
      if (typeof d !== "string" || d.length < 10 || d.length > 150000 || !/^[A-Za-z0-9_-]+$/.test(d))
        return res.status(400).json({ error: "Invalid data" });
      const id = randomBytes(6).toString("base64url");
      await redis(["SET", "share:" + id, d, "EX", TTL]);
      return res.status(200).json({ id });
    }
    if (req.method === "GET") {
      const id = String(req.query.id || "");
      if (!/^[A-Za-z0-9_-]{6,12}$/.test(id)) return res.status(400).json({ error: "Invalid id" });
      const d = await redis(["GET", "share:" + id]);
      if (!d) return res.status(404).json({ error: "Link expired or not found" });
      return res.status(200).json({ d });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: "Storage error" });
  }
}
