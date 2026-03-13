const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100
});
app.use(limiter);

const GEMINI_MODEL     = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_BASE      = 'https://generativelanguage.googleapis.com/v1beta/models';
const FETCH_TIMEOUT_MS = 30_000;

// ─── Part 1: Universal coaching science — never changes between users or requests ─
// Part 2: User-specific context is built fresh in GeminiService.swift (AIContextBundle)
// and sent as the prompt body on every request.
const SYSTEM_PROMPT = `
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

USER CONSTRAINTS ENFORCEMENT:
If the prompt contains a MASTER CONSTRAINTS block, apply these rules without exception:
- ALLERGENS: Any item listed under allergens is an absolute hard block. Never suggest it
  in any form — food, ingredient, supplement, pre-workout product, or recovery item.
  This overrides all coaching recommendations, menu items, and performance logic.
- DIETARY RESTRICTIONS: Every suggestion in the entire response — meals, snacks,
  supplements, workout nutrition, recovery foods — must fully comply with listed
  restrictions. No partial compliance.
- DISLIKES: Treat as a soft avoid across all food and meal suggestions.
- TRAINING CONSTRAINTS: Respect in all workout and exercise suggestions.
The values in MASTER CONSTRAINTS are user-specific and change per request.
The enforcement principle above is universal and applies to every user.

RESPONSE STYLE:
- Tone: Analytical, science-grounded, direct. Like a coach who knows
  the user's data and prescribes exact actions — not generic wellness advice.
- Output format is specified per-request by the client prompt (JSON schemas).
  Always follow the exact JSON structure requested. No markdown fences.
`.trim();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/prompt', (req, res) => aiHandler(req, res));
app.post('/ai-request', (req, res) => aiHandler(req, res));

async function aiHandler(req, res) {
  const t0 = Date.now();
  try {
    const { prompt, imageBase64 } = req.body;

    // ── 1. Validate ───────────────────────────────────────────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━ REQUEST ━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 Route:', req.originalUrl || req.url);
    console.log('📥 Prompt:', prompt ? `${prompt.length} chars` : 'MISSING');
    console.log('📥 Image:', imageBase64 ? `${imageBase64.length} chars` : 'none');

    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    // ── 2. Build Gemini payload ───────────────────────────────────────────────
    const parts = [{ text: prompt }];
    if (imageBase64) {
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
    }

    const geminiBody = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts }]
    });

    const geminiURL = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    console.log('📤 Model:', GEMINI_MODEL, '| Payload:', geminiBody.length, 'bytes | Parts:', parts.length);

    // ── 3. Call Gemini (with timeout) ─────────────────────────────────────────
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(geminiURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: geminiBody,
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await response.json();
    const elapsed = Date.now() - t0;

    // ── 4. Handle Gemini errors ───────────────────────────────────────────────
    if (!response.ok) {
      console.log('🔴 Gemini', response.status, 'in', elapsed, 'ms:', JSON.stringify(data));
      return res.status(response.status).json({ error: data });
    }

    // ── 5. Extract and return text ────────────────────────────────────────────
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const usage = data.usageMetadata ?? {};

    console.log(
      '📩', response.status, '|', elapsed, 'ms |',
      data.candidates?.[0]?.finishReason ?? '?', '|',
      text.length, 'chars |',
      'tokens:', JSON.stringify(usage)
    );

    if (text.length === 0) {
      console.log('⚠️ Empty response — candidates:', JSON.stringify(data.candidates, null, 2));
    }

    res.json({ text });

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('🔴 Gemini request timed out after', FETCH_TIMEOUT_MS, 'ms');
      return res.status(504).json({ error: 'Gemini request timed out' });
    }
    console.error('🔴 aiHandler:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stade API running on port ${PORT}`));