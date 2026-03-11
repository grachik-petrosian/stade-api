const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // needs to be large for image base64

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100
});
app.use(limiter);

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── MAIN AI ENDPOINT ─────────────────────────────────────────
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

    // Build message content
    const parts = [{ text: prompt }];

    // Add image if provided (for menu photo / label scan)
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: imageBase64
        }
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
```

---

**Step 3 — Create Procfile** (tells Railway how to start it)

Create a file called `Procfile` — no extension — with exactly this one line:
```
web: node server.js
```

---

**Step 4 — Your folder should look like this**
```
stade-api/
├── server.js
├── Procfile
├── package.json
└── node_modules/