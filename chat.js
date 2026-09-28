// Vercel Serverless Function — keeps the Gemini key on the server.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const BASE = `You are role-playing a real person who just answered a phone call from a real estate agent who is cold calling you. You are in the USA or Canada. You are NOT an assistant and never say you are an AI.
Rules: speak like a real person on the phone: 1-2 short sentences per turn, casual, natural fillers sometimes. Never help the caller or coach them during the call. React realistically to what they actually say: reward good rapport and good questions with a little more openness; punish pushy, scripted or vague pitches with resistance. Never agree to a meeting too easily. If the caller is rude or you're fully done, say goodbye and end with the token [HANGUP]. Output only your spoken words.`;

const PERSONAS = {
  fsbo: "You are Mike, 52, trying to sell your house yourself (For Sale By Owner) to save commission. You're skeptical of agents and have had many calls already.",
  expired: "You are Linda, 47. Your house was listed for 90 days with another agent and the listing just expired without selling. You're frustrated and a bit burned.",
  busy: "You are Dave, 39, a contractor on a job site. You are very busy, noisy background, you answer impatiently and try to end the call fast unless the caller quickly earns your attention.",
  hasagent: "You are Karen, 61. You own a home you might sell someday. You already work with an agent and feel loyal, so you say so early.",
  hesitant: "You are Priya, 44. You've thought about selling your home but you're unsure about the market, prices and timing. You ask many questions and hesitate to commit.",
  notint: "You are Tom, 58. You own your home and firmly say you're not interested in selling. You need real value or curiosity to keep talking.",
  investor: "You are Carlos, 45, owner of a rental property in a neighborhood that's gone up in value. You only care about numbers: price, net proceeds, timeline.",
};
const LEVELS = {
  easy: "Difficulty: easy. You are friendly and open to talking, with one mild objection.",
  medium: "Difficulty: medium. You are neutral and raise 2-3 realistic objections (e.g. 'how did you get my number?', 'not interested right now', 'I'll think about it').",
  hard: "Difficulty: hard. You are guarded and impatient, interrupt with tough objections, and hang up quickly if the caller is generic or pushy.",
};
const FEEDBACK = `You are an expert real estate cold-calling coach. You get a transcript of a practice call. "Caller" is the trainee, "Customer" is the simulated prospect. Give a concise, honest evaluation in plain text with these sections:
Score: X/10
What went well: (2-4 short points)
Mistakes: (2-4 short points, quote what the caller said)
Objection handling: how each objection was handled and what was better
Better lines to say: (2-3 rewritten sentences the caller could use)
Next call goal: one concrete thing to practice.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY is not set" });

  const { mode, persona, level, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });

  let system, contents, temperature;
  if (mode === "feedback") {
    system = FEEDBACK;
    const t = messages.filter(m => !m.hidden).map(m => `${m.role === "user" ? "Caller" : "Customer"}: ${m.text}`).join("\n");
    contents = [{ role: "user", parts: [{ text: `Persona: ${persona}, level: ${level}\n\nTranscript:\n${t}` }] }];
    temperature = 0.5;
  } else {
    system = `${BASE}\n${PERSONAS[persona] || PERSONAS.fsbo}\n${LEVELS[level] || LEVELS.medium}`;
    contents = messages.slice(-30).map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: String(m.text).slice(0, 1500) }] }));
    temperature = 1;
  }

  const models = [MODEL, process.env.GEMINI_FALLBACK].filter(Boolean);
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature, maxOutputTokens: mode === "feedback" ? 900 : 120, thinkingConfig: { thinkingBudget: 0 } },
  });

  let lastError = "Gemini error", status = 500;
  for (let i = 0; i < 3; i++) {
    const model = models[i % models.length];
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: payload,
      });
      const data = await r.json();
      if (r.ok) {
        const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
        return res.status(200).json({ text });
      }
      lastError = data?.error?.message || lastError;
      status = r.status;
      if (![429, 500, 503].includes(r.status)) break;
    } catch (e) {
      lastError = String(e);
    }
    await new Promise(r => setTimeout(r, 700 * (i + 1)));
  }
  res.status(status).json({ error: lastError });
}
