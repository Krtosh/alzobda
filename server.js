import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { YoutubeTranscript } from "youtube-transcript";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("."));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// استخراج ID من الرابط
function getVideoId(url) {
  const regExp = /v=([^&]+)/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

app.post("/summarize", async (req, res) => {
  try {
    const { url } = req.body;
    const videoId = getVideoId(url);

    if (!videoId) {
      return res.json({ error: "رابط غير صحيح ❌" });
    }

    // 🎯 جلب معلومات الفيديو
    const ytRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`
    );

    const ytData = await ytRes.json();
    const video = ytData.items[0];

    const title = video.snippet.title;
    const channel = video.snippet.channelTitle;
    const thumbnail = video.snippet.thumbnails.high.url;

    // 🎯 جلب الترجمة
    let transcriptText = "";

    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      transcriptText = transcript.map(t => t.text).join(" ");
    } catch {
      return res.json({
        title,
        channel,
        thumbnail,
        summary: "لا يوجد ترجمة ❌"
      });
    }

    // 🎯 التلخيص
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `لخص الفيديو بشكل احترافي مع نقاط:\n${transcriptText}`
        }
      ]
    });

    res.json({
      title,
      channel,
      thumbnail,
      summary: completion.choices[0].message.content
    });

  } catch (error) {
    console.log(error);
    res.json({ error: "صار خطأ ❌" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
