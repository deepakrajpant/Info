const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = require('node-fetch');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/ask-ai', async (req, res) => {
  const { userQuestion, csvData } = req.body;

  const systemPrompt = `
You are an expert in electrical load analysis. Here is the CSV data:
${csvData}

User's question: ${userQuestion}
  `.trim();

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.API_KEY}`,
        "HTTP-Referer": "https://drpant.com.np",
        "X-Title": "Smart Load Analysis"
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-haiku",
        messages: [{ role: "user", content: systemPrompt }]
      })
    });

    const data = await response.json();
    res.json({ reply: data?.choices?.[0]?.message?.content || "🤖 No response." });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
