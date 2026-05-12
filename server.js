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

// استخراج ID
function getVideoId(url) {
  const regExp =
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

// مهم للـ Railway
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
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`
    );

    const ytData = await ytRes.json();

    if (!ytData.items || ytData.items.length === 0) {
      return res.json({ error: "الفيديو غير موجود ❌" });
    }

    const video = ytData.items[0];

    const title = video.snippet.title;
    const channel = video.snippet.channelTitle;
    const thumbnail = video.snippet.thumbnails.high.url;

    // =========================
    // 🎯 1. محاولة الترجمة
    // =========================
    let transcriptText = "";

    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      transcriptText = transcript.map(t => t.text).join(" ");
      console.log("تم استخدام الترجمة ✅");
    } catch {
      console.log("ما فيه ترجمة ❌ → ننتقل للصوت");
    }

    // =========================
    // 🎯 2. إذا مافيه ترجمة → تحليل الصوت
    // =========================
    if (!transcriptText) {
      try {
        console.log("🎤 إرسال الفيديو لـ AssemblyAI...");

        const uploadRes = await fetch("https://api.assemblyai.com/v2/transcript", {
          method: "POST",
          headers: {
            authorization: process.env.ASSEMBLY_API_KEY,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            audio_url: `https://www.youtube.com/watch?v=${videoId}`
          })
        });

        const uploadData = await uploadRes.json();
        const transcriptId = uploadData.id;

        let done = false;

        while (!done) {
          await new Promise(r => setTimeout(r, 3000));

          const polling = await fetch(
            `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
            {
              headers: {
                authorization: process.env.ASSEMBLY_API_KEY
              }
            }
          );

          const data = await polling.json();

          if (data.status === "completed") {
            transcriptText = data.text;
            done = true;
            console.log("تم تحليل الصوت ✅");
          }

          if (data.status === "error") {
            throw new Error("فشل تحليل الصوت");
          }
        }

      } catch (err) {
        console.log(err);
        return res.json({
          title,
          channel,
          thumbnail,
          summary: "تعذر استخراج محتوى الفيديو ❌"
        });
      }
    }

    // =========================
    // 🎯 3. التلخيص
    // =========================
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `لخص هذا الفيديو بدقة من النص التالي:\n${transcriptText}`
        }
      ]
    });

    return res.json({
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

// مهم للـ Railway
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
