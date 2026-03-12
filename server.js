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

OUTPUT FORMAT — always use this exact structure:
- READINESS SCORE: X/10 — one line explanation
- WORKOUT: type, duration, exercises with sets/reps, intensity note
- NUTRITION: calorie target, protein target, meal timing, upcoming meal suggestions
  (never repeat food already logged — only suggest what to eat next)
- RECOVERY ACTIONS: 1-3 specific actions for today
- TOMORROW PREVIEW: one line

Tone: Analytical, science-grounded, direct. Like a coach who knows
your data and tells you the exact action — not generic wellness advice.
`.trim();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/prompt', async (req, res) => {
  console.log('📥 BODY:', JSON.stringify(req.body, null, 2));
  req.url = '/ai-request';
  return aiHandler(req, res);
});

app.post('/ai-request', async (req, res) => {
  return aiHandler(req, res);
});

async function aiHandler(req, res) {
  const t0 = Date.now();
  try {
    const { prompt, imageBase64 } = req.body;

    // ── 1. Validate incoming request ──────────────────────────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━ REQUEST ━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 Route:', req.originalUrl || req.url);
    console.log('📥 Prompt length:', prompt ? prompt.length : 0, 'chars');
    console.log('📥 Has image:', !!imageBase64);
    if (prompt) {
      console.log('📥 FULL PROMPT:');
      console.log(prompt);
    }

    if (!prompt) {
      console.log('🔴 Missing prompt — returning 400');
      return res.status(400).json({ error: 'prompt is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('🔴 GEMINI_API_KEY not set — returning 500');
      return res.status(500).json({ error: 'API key not configured' });
    }

    // ── 2. Build Gemini payload ───────────────────────────────────────────────
    const parts = [{ text: prompt }];
    if (imageBase64) {
      parts.push({
        inline_data: { mime_type: 'image/jpeg', data: imageBase64 }
      });
    }

    const geminiPayload = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts }]
    };
    const geminiBody = JSON.stringify(geminiPayload);

    console.log('📤 SYSTEM_PROMPT length:', SYSTEM_PROMPT.length, 'chars');
    console.log('📤 Gemini payload size:', geminiBody.length, 'bytes');
    console.log('📤 systemInstruction present:', !!geminiPayload.systemInstruction);
    console.log('📤 contents[0].parts count:', parts.length);

    // ── 3. Call Gemini ────────────────────────────────────────────────────────
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey.substring(0, 6)}…`;
    console.log('📤 Calling:', geminiURL);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: geminiBody
      }
    );

    const data = await response.json();
    const elapsed = Date.now() - t0;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━ RESPONSE ━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📩 Gemini HTTP status:', response.status);
    console.log('📩 Elapsed:', elapsed, 'ms');

    // ── 4. Handle Gemini errors ───────────────────────────────────────────────
    if (!response.ok) {
      console.log('🔴 Gemini error body:', JSON.stringify(data, null, 2));
      return res.status(response.status).json({ error: data });
    }

    // ── 5. Extract and return text ────────────────────────────────────────────
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
    const candidateCount = data.candidates?.length ?? 0;
    const tokenUsage = data.usageMetadata ?? {};

    console.log('📩 Candidates:', candidateCount);
    console.log('📩 Finish reason:', finishReason);
    console.log('📩 Token usage:', JSON.stringify(tokenUsage));
    console.log('📩 Response text length:', text.length, 'chars');
    console.log('📩 FULL RESPONSE TEXT:');
    console.log(text);
    if (text.length === 0) {
      console.log('⚠️  Empty response text — full candidates:', JSON.stringify(data.candidates, null, 2));
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    res.json({ text });

  } catch (err) {
    console.error('🔴 aiHandler exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stade API running on port ${PORT}`));