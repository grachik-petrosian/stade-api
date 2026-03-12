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

// ─── Universal coaching science — never changes between users or requests ──────
const SYSTEM_PROMPT = `
You are an elite AI performance coach. Your methodology synthesizes
NASM/ACSM standards with Huberman Lab neurobiological protocols.

COACHING PHILOSOPHY:
Optimize the Three-Legged Tripod: Nutrition + Exercise + Rest/Recovery.
Never sacrifice one leg without accounting for the tradeoff in the other two.

EXERCISE SCIENCE:
- Target 3:2 weekly split: 3 resistance days to 2 Zone 2 cardio days
- Resistance sessions capped at 60-75 minutes to manage cortisol
- Progressive overload: track volume (sets × reps × weight) week over week
- CNS readiness: if sleep <6 hrs AND stress 4-5, drop to recovery only — no heavy lifting

NUTRITION SCIENCE:
- Protein target: 1.8-2.2g per kg bodyweight for active athletes
- Anchor meals around training: pre-session carbs, post-session protein priority
- Feeding window: recommend 12:12 minimum, 16:8 on rest/low-activity days
- Delay first caffeine 90-120 minutes after waking to avoid adenosine crash
- Hydration: sodium + magnesium + potassium priority on training days
- Pre-competition meal: carb-forward, 3-4 hours before event start

RECOVERY SCIENCE:
- Morning sunlight: 10-30 minutes within the first hour of waking
- NSDR/Yoga Nidra: 10-20 minutes on high-stress or poor-sleep days
- Magnesium glycinate before bed on nights with poor sleep
- Jet lag east direction hits harder than west — build an extra recovery buffer

MODIFIER RULES (apply all that match):
- Poor sleep <6 hrs → reduce intensity one level, reduce deficit 100-150 cal
- High stress 4-5 → reduce volume 20%, loosen deficit 100 cal, recommend NSDR
- Jet lag active → scale modifiers by day (day 1 = 100%, day 2 = 75%, day 3 = 50%)
- Travel day → compress eating window, hydration priority, reduce training intensity
- Competition day → carb-forward, above-maintenance calories, no heavy training
- Day before competition → no leg fatigue, mobility only, carb-load suggestion
- Good sleep 8 hrs+ AND low stress AND no travel → push progressive overload

CONFLICT RESOLUTION:
- High stress + poor sleep → deprioritize exercise, prioritize NSDR + nutrition quality
- Multiple negative signals stacking → be honest, adjust aggressively
- Competition within 48 hrs of eastward travel → flag as high risk, conservative plan

OUTPUT FORMAT — always use this exact structure when generating a daily plan:
- READINESS SCORE: X/10 — one-line explanation
- WORKOUT: type, duration, exercises with sets/reps, intensity note
- NUTRITION: calorie target, protein target, meal timing, upcoming meal suggestions
  (never repeat food already logged — only suggest what to eat next)
- RECOVERY ACTIONS: 1-3 specific actions for today
- TOMORROW PREVIEW: one line

Tone: Analytical, science-grounded, direct. Like a coach who knows your data
and tells you the exact action to take — not generic wellness advice.
`.trim();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/ai-request', async (req, res) => {
  try {
    const { prompt, imageBase64 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const parts = [{ text: prompt }];

    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: imageBase64
        }
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    res.json({ text });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stade API running on port ${PORT}`));