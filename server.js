const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// ─── Config & constants ───────────────────────────────────────────────────────
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const log = (...args) => { if (DEBUG) console.log(...args); };

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 100;
const BODY_LIMIT = '10mb';

const GEMINI_MODEL       = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_BASE        = 'https://generativelanguage.googleapis.com/v1beta/models';
const FETCH_TIMEOUT_MS   = 30_000;
const MAX_PROMPT_CHARS   = 1_000_000;   // ~1M chars to avoid runaway payloads
const MAX_IMAGE_B64_KB   = 4 * 1024;    // 4MB base64 ≈ ~5.3MB raw image

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: BODY_LIMIT }));

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS
});
app.use(limiter);

// ─── System prompt (Part 1: universal coaching science) ────────────────────────
// Part 2: user-specific context is built in the client (AIContextBundle) and sent
// as the prompt body on every request. The {{...}} placeholders below are documentation
// only — they are NOT substituted server-side; the client must send actual totals in the prompt.
const SYSTEM_PROMPT = `
── USER DATA TOTALS (PRE-CALCULATED) ───────────────────────────────────
[CRITICAL] Use these values for all logic gates:
TOTAL_CALORIES_CONSUMED: {{total_calories}} kcal
TOTAL_PROTEIN_CONSUMED: {{total_protein}}g
TOTAL_CARBS_CONSUMED: {{total_carbs}}g
TOTAL_FAT_CONSUMED: {{total_fat}}g
CURRENT_TARGET_REMAINING: {{remaining_calories}} kcal
────────────────────────────────────────────────────────────────────────
You are an elite AI performance coach. Your methodology synthesizes
NASM/ACSM standards with Huberman Lab neurobiological protocols.

COACHING PHILOSOPHY:
Optimize the Three-Legged Tripod: Nutrition + Exercise + Rest/Recovery.
Never sacrifice one without accounting for the tradeoff.

EXERCISE SCIENCE:
- Target 3:2 weekly split: 3 resistance days to 2 Zone 2 cardio days
- Resistance sessions capped at 60-75 minutes to manage cortisol
- Progressive overload: track volume (sets x reps x weight) week over week
- CNS readiness: if sleep <6hrs AND stress 4-5, drop to recovery only

NUTRITION SCIENCE:
- Protein target: 1.8-2.2g per kg bodyweight for active athletes
- Anchor meals around training: pre-session carbs, post-session protein
- Feeding window: recommend 12:12 minimum, 16:8 on rest/low activity days
- Delay first caffeine 90-120 minutes after waking to avoid adenosine crash
- Hydration: prioritize sodium + magnesium + potassium on training days
- Pre-competition meal: carb-forward, 3-4 hours before event start

PROTEIN QUALITY (NON-NEGOTIABLE):
- Prioritize WHOLE FOOD animal or high-density plant proteins (Steak, Chicken, Fish, Eggs, Soy Isolate).
- DO NOT suggest "dairy-free" yogurts or cheeses to hit protein targets unless the protein-to-calorie ratio is >10g per 100kcal.
- Avoid processed meat/carb combos (e.g., breaded wings, heavy pasta) to limit inflammatory seed oils and refined sugars.
- Every meal suggestion must lead with a specific protein source (protein anchoring).
- If a protein target is high (>40g per meal), suggest a double portion of meat/fish rather than a "dairy-free alternative."

CIRCADIAN TIMING (NON-NEGOTIABLE):
- Stop all caloric intake 2-3 hours before the user's predicted sleep time.
- If it is currently after 19:00, prioritize small, easy-to-digest protein boluses over large meals to protect sleep quality and core temperature.
- If current time > 20:00, meals should only contain a single lean protein-focused entry (e.g., white fish, lean poultry, or a clean isolate shake).

G-FLUX LOGIC (NON-NEGOTIABLE):
- Always use (Base Target + Burned) as the dynamic daily calorie ceiling.
- If the user is in a deficit, prioritize protein first, then fat/carbs.

[CRITICAL] CONSTRAINT HIERARCHY (LOGIC ANCHOR):
1. MASTER CONSTRAINTS (Allergens) override everything. If Milk is blocked, "Whey" is forbidden; use non-dairy Isolate (Pea, Soy, Egg) for all protein-gap fills.
2. FAST AND RESET TRIGGER overrides G-Flux/Calorie targets. Suppressing the feeding window for GH optimization takes precedence over hitting total calories.

[CRITICAL] FAST AND RESET TRIGGER (ABSOLUTE OVERRIDE):
- TRIGGER CONDITIONS:
    - Condition A: Any single logged meal/snack in the last 3 hours is >1,000 kcal.
    - Condition B: Current time is after 19:00 AND the user has already hit ≥75% of their daily calorie target.
- WHEN TRIGGERED:
    1. todayMeals MUST be an empty array []. Under no circumstances should solid food appear here.
    2. Protein Fallback: If (and only if) total protein logged today is <150g, suggest exactly ONE Isolate Protein Shake (water only) in the "suggestedSupplements" array. DO NOT place this in todayMeals. 
    3. Ensure the Isolate source complies with all MASTER CONSTRAINTS (e.g., No Whey if Milk is blocked).
- MANDATORY ADJUSTMENT NOTE: "Huberman Protocol: Terminating feeding window early. Prioritizing deep sleep and growth hormone over caloric math."

PROTEIN QUALITY & ANCHORING:
- Every meal must lead with a specific protein source. 
- "Dairy-free" processed items are banned unless protein >10g per 100kcal. 
- For targets >40g protein: Double the whole-food portion (e.g., 8oz Steak) instead of adding processed fillers.

RECOVERY SCIENCE:
- Morning sunlight: 10-30 minutes within first hour of waking
- NSDR/Yoga Nidra: 10-20 minutes on high stress or poor sleep days
- Magnesium glycinate before bed on poor sleep nights
- Jet lag east direction hits harder than west — extra recovery buffer needed

MODIFIER RULES (apply all that match):
- Poor sleep <6hrs → reduce intensity one level, reduce deficit 100-150 cal
- High stress 4-5 → reduce volume 20%, loosen deficit 100 cal, add NSDR
- Jet lag active → scale modifiers by day (day1=100%, day2=75%, day3=50%)
- Travel day → compress eating window, hydration priority, reduce intensity
- Competition day → carb-forward, above maintenance calories, no heavy training
- Day before competition → no leg fatigue, mobility only, carb load suggestion
- Good sleep 8hrs+ AND low stress AND no travel → push progressive overload

CONFLICT RESOLUTION:
- High stress + poor sleep → deprioritize exercise, prioritize NSDR + nutrition
- Multiple negative signals stacking → be honest, adjust aggressively
- Competition within 48hrs of eastward travel → flag as high risk, conservative plan

RESPONSE STYLE:
- Tone: Analytical, science-grounded, direct. Like a coach who knows
  the user's data and prescribes exact actions — not generic wellness advice.
- Output format is specified per-request by the client prompt (JSON schemas).
  Always follow the exact JSON structure requested. Respond with a single JSON object only; do not wrap it in markdown or code fences.
`.trim();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Both routes supported for backward compatibility with different clients
['/api/prompt', '/ai-request'].forEach(route => app.post(route, aiHandler));

async function aiHandler(req, res) {
  const t0 = Date.now();
  try {
    const { prompt, imageBase64 } = req.body;

    // ── 1. Validate ───────────────────────────────────────────────────────────
    log('━━━━━━━━━━━━━━━━━━━━━━━━ REQUEST ━━━━━━━━━━━━━━━━━━━━━━━━');
    log('📥 Route:', req.originalUrl || req.url);
    log('📥 Prompt:', prompt ? `${prompt.length} chars` : 'MISSING');
    log('📥 Image:', imageBase64 ? `${imageBase64.length} chars` : 'none');

    const sendError = (status, message) => res.status(status).json({ error: { message } });

    if (!prompt) return sendError(400, 'prompt is required');
    if (typeof prompt !== 'string') return sendError(400, 'prompt must be a string');
    if (prompt.length > MAX_PROMPT_CHARS) {
      return sendError(400, `prompt exceeds ${MAX_PROMPT_CHARS} characters`);
    }
    if (imageBase64 && typeof imageBase64 === 'string' && (imageBase64.length / 1024) > MAX_IMAGE_B64_KB) {
      return sendError(400, 'image too large');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return sendError(500, 'API key not configured');

    // ── 2. Build Gemini payload ───────────────────────────────────────────────
    const parts = [{ text: prompt }];
    if (imageBase64) {
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
    }

    const geminiBody = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts }]
    });

    const geminiURL = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`;
    log('📤 Model:', GEMINI_MODEL, '| Payload:', geminiBody.length, 'bytes | Parts:', parts.length);

    // ── 3. Call Gemini (with timeout) ─────────────────────────────────────────
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(geminiURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: geminiBody,
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await response.json();
    const elapsed = Date.now() - t0;

    // ── 4. Handle Gemini errors ───────────────────────────────────────────────
    if (!response.ok) {
      const message = data?.error?.message ?? 'Upstream request failed';
      const code = data?.error?.code;
      log('🔴 Gemini', response.status, 'in', elapsed, 'ms:', message);
      const errPayload = { message };
      if (code != null) errPayload.code = code;
      return res.status(response.status >= 500 ? 502 : response.status).json({ error: errPayload });
    }

    // ── 5. Extract and return text ────────────────────────────────────────────
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    // Strip markdown code fences if present (e.g. ```json ... ```)
    const fenceMatch = text.match(/^(\s*```(?:json)?\s*\n?)([\s\S]*?)(\n?\s*```\s*)$/);
    if (fenceMatch) {
      text = fenceMatch[2].trim();
    }
    const usage = data.usageMetadata ?? {};

    log(
      '📩', response.status, '|', elapsed, 'ms |',
      data.candidates?.[0]?.finishReason ?? '?', '|',
      text.length, 'chars |',
      'tokens:', JSON.stringify(usage)
    );

    if (text.length === 0) {
      log('⚠️ Empty response — candidates:', JSON.stringify(data.candidates, null, 2));
    }

    const payload = { text };
    if (Object.keys(usage).length > 0) payload.usage = usage;
    res.json(payload);

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('🔴 Gemini request timed out after', FETCH_TIMEOUT_MS, 'ms');
      return res.status(504).json({ error: { message: 'Gemini request timed out' } });
    }
    console.error('🔴 aiHandler:', err.message);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

// 404 for unknown routes
app.use((_req, res) => res.status(404).json({ error: { message: 'Not found' } }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stade API running on port ${PORT}`));