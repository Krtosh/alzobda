import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { YoutubeTranscript } from "youtube-transcript";
import OpenAI from "openai";
import ytdl from "ytdl-core";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("."));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const PORT = process.env.PORT || 3000;

// استخراج ID
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

    // 🎯 معلومات الفيديو
    const ytRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`
    );
    const ytData = await ytRes.json();
    const video = ytData.items[0];

    const title = video.snippet.title;
    const channel = video.snippet.channelTitle;
    const thumbnail = video.snippet.thumbnails.high.url;

    let transcriptText = "";

    // ✅ أولاً: نحاول الترجمة
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      transcriptText = transcript.map(t => t.text).join(" ");
    } catch {
      // 🔥 fallback: تحليل الصوت

      try {
        // 1. سحب الصوت
        const stream = ytdl(url, { filter: "audioonly" });

        // 2. رفعه لـ AssemblyAI
        const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
          method: "POST",
          headers: {
            authorization: process.env.ASSEMBLY_API_KEY
          },
          body: stream
        });

        const uploadData = await uploadRes.json();
        const audioUrl = uploadData.upload_url;

        // 3. طلب التحليل
        const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
          method: "POST",
          headers: {
            authorization: process.env.ASSEMBLY_API_KEY,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            audio_url: audioUrl,
            language_code: "ar" // مهم للعربي
          })
        });

        const transcriptData = await transcriptRes.json();
        const transcriptId = transcriptData.id;

        // 4. انتظار النتيجة
        let completed = false;
        let result;

        while (!completed) {
          await new Promise(r => setTimeout(r, 4000));

          const polling = await fetch(
            `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
            {
              headers: {
                authorization: process.env.ASSEMBLY_API_KEY
              }
            }
          );

          result = await polling.json();

          if (result.status === "completed") {
            completed = true;
          } else if (result.status === "error") {
            throw new Error("فشل التحليل");
          }
        }

        transcriptText = result.text;

      } catch (err) {
        console.log(err);
        return res.json({
          title,
          channel,
          thumbnail,
          summary: "❌ فشل تحليل الصوت"
        });
      }
    }

    // 🎯 التلخيص
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `لخص النص التالي فقط بدون إضافة معلومات خارجية:\n${transcriptText}`
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
