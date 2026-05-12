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

// ✅ مهم للـ Railway
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

app.post("/summarize", async (req, res) => {
  try {
    const { url } = req.body;
    const videoId = getVideoId(url);

    if (!videoId) {
      return res.json({ error: "رابط غير صحيح ❌" });
    }

    // 🎯 معلومات الفيديو
    const ytRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`
    );

    const ytData = await ytRes.json();
    const video = ytData.items?.[0];

    if (!video) {
      return res.json({ error: "ما حصلت الفيديو ❌" });
    }

    const title = video.snippet.title;
    const channel = video.snippet.channelTitle;
    const thumbnail = video.snippet.thumbnails.high.url;

    // =========================
    // 🎯 1. محاولة الترجمة
    // =========================
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      const transcriptText = transcript.map(t => t.text).join(" ");

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `لخص الفيديو بنقاط:\n${transcriptText}`
          }
        ]
      });

      return res.json({
        title,
        channel,
        thumbnail,
        summary: completion.choices[0].message.content
      });

    } catch {
      console.log("❌ مافيه ترجمة - نستخدم الصوت");

      // =========================
      // 🎯 2. fallback بالصوت
      // =========================
      try {
        const ytdl = (await import("ytdl-core")).default;
        const fs = (await import("fs")).default;
        const ffmpeg = (await import("fluent-ffmpeg")).default;
        const ffmpegPath = (await import("ffmpeg-static")).default;

        ffmpeg.setFfmpegPath(ffmpegPath);

        const audioPath = "audio.mp3";

        // تحميل الصوت
        await new Promise((resolve, reject) => {
          ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
            quality: "highestaudio"
          })
            .pipe(ffmpeg().audioBitrate(128).save(audioPath))
            .on("end", resolve)
            .on("error", reject);
        });

        // تحويل الصوت لنص
        const transcription = await client.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: "gpt-4o-mini-transcribe"
        });

        const text = transcription.text;

        // التلخيص
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: `لخص هذا الفيديو بنقاط:\n${text}`
            }
          ]
        });

        fs.unlinkSync(audioPath);

        return res.json({
          title,
          channel,
          thumbnail,
          summary: completion.choices[0].message.content
        });

      } catch (err) {
        console.log(err);
        return res.json({
          title,
          channel,
          thumbnail,
          summary: "فشل تحليل الصوت ❌"
        });
      }
    }

  } catch (error) {
    console.log(error);
    res.json({ error: "صار خطأ ❌" });
  }
});

// ✅ مهم للـ Railway
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
