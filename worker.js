// worker.js - backend chatbot Vua36 (Cloudflare Worker) dùng Groq (miễn phí) + Workers AI cho ảnh.

const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
// Model hiện tại còn free trên Groq (llama-3.1-8b-instant đã bị gỡ ngày 16/08/2026).
const TEXT_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
const VISION_MODELS = ["qwen/qwen3.8-27b"];
const ALLOWED_ORIGIN = "https://vua36.github.io";
const MAX_MESSAGES = 40;
const MAX_CHARS = 20000;
const MAX_IMAGE_CHARS = 4000000;
const MAX_TOKENS = 8000;

function systemPrompt() {
  const today = new Date().toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "numeric", month: "numeric", year: "numeric",
  });
  return [
    "Tên bạn là Vua36, một trợ lý AI cá nhân do HuuDuong tạo ra. Khi được hỏi tên hoặc bạn là ai, hãy giới thiệu bạn là Vua36. Khi ai đó hỏi bạn được tạo ra bởi ai, hãy trả lời bạn được tạo ra bởi HuuDuong. Không tự nhận là ChatGPT hay sản phẩm của OpenAI, Google hay công ty nào khác.",
    "Mặc định trả lời bằng tiếng Việt tự nhiên, thân thiện, đi thẳng vào câu trả lời; nếu người dùng viết bằng ngôn ngữ khác thì trả lời bằng ngôn ngữ đó.",
    "Câu hỏi đơn giản thì trả lời ngắn gọn. Vấn đề phức tạp thì giải thích từng bước, rõ ràng. Bạn có thể trả lời dài, chi tiết, không bị giới hạn độ dài.",
    "Không biết hoặc không chắc thì nói thẳng, tuyệt đối không bịa số liệu, tên người hay đường link. Bạn không có internet nên không biết tin tức mới.",
    "Người dùng có thể gửi ảnh, hoặc nội dung tệp nằm ngay trong tin nhắn (trong khối ```). Hãy dựa vào đó để trả lời.",
    "Bạn được dùng markdown (in đậm, danh sách, bảng, khối code ```) và công thức toán bằng LaTeX: đặt trong $...$ cho công thức nằm trong dòng, $$...$$ cho công thức đứng riêng.",
    "Khi người dùng yêu cầu tạo ảnh, hãy trả lời bằng đúng định dạng: [GENERATE_IMAGE: mô tả ảnh chi tiết bằng tiếng Anh] rồi sau đó viết lời giải thích ngắn. Chỉ dùng tag này khi thật sự cần tạo ảnh.",
    "Khi người dùng yêu cầu tạo tệp (code, document, v.v.), hãy trả lời bằng đúng định dạng: [CREATE_FILE: tên_file.ext]\n```\nnội dung tệp\n``` rồi sau đó viết lời giải thích. Có thể tạo nhiều tệp bằng nhiều tag.",
    "Bạn không bị giới hạn nội dung trả lời (trừ việc không bịa đặt). Hãy hỗ trợ hết mình.",
    "Hôm nay là " + today + ".",
  ].join("\n");
}

function cleanMessages(input) {
  if (!Array.isArray(input)) throw new Error("Dữ liệu không hợp lệ");
  const recent = input
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-MAX_MESSAGES);
  let imageUsed = false;
  const out = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const { role, content } = recent[i];
    let clean = "";
    if (typeof content === "string") {
      clean = content.slice(0, MAX_CHARS);
    } else if (role === "user" && Array.isArray(content)) {
      const parts = [];
      for (const p of content) {
        if (p && p.type === "text" && typeof p.text === "string") {
          parts.push({ type: "text", text: p.text.slice(0, MAX_CHARS) });
        } else if (
          p && p.type === "image_url" && !imageUsed &&
          typeof p.image_url?.url === "string" &&
          p.image_url.url.startsWith("data:image/") &&
          p.image_url.url.length <= MAX_IMAGE_CHARS
        ) {
          parts.push({ type: "image_url", image_url: { url: p.image_url.url } });
          imageUsed = true;
        }
      }
      if (parts.length) clean = parts;
    }
    if (clean && (typeof clean !== "string" || clean.trim())) out.unshift({ role, content: clean });
  }
  return out;
}

const hasImage = (msgs) =>
  msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));

async function callModel(messages, env) {
  const models = hasImage(messages) ? VISION_MODELS : TEXT_MODELS;
  let lastError = "Lỗi không rõ";
  for (const model of models) {
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: "system", content: systemPrompt() }, ...messages],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Lỗi " + res.status);
      const text = (data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) throw new Error("Model không trả nội dung");
      return text;
    } catch (e) {
      lastError = model + ": " + (e.message || e);
    }
  }
  throw new Error(lastError);
}

async function generateImage(prompt, env) {
  try {
    const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
      prompt: prompt.slice(0, 2048),
      steps: 4,
    });
    if (result && result.image) {
      return `data:image/jpeg;base64,${result.image}`;
    }
  } catch (e) {
    console.error("Image gen error:", e);
  }
  return null;
}

function extractSpecials(text) {
  const images = [];
  const files = [];
  let clean = text;

  // Images
  const imgRegex = /\[GENERATE_IMAGE:\s*([^\]]+)\]/gi;
  let match;
  while ((match = imgRegex.exec(text)) !== null) {
    images.push(match[1].trim());
  }
  clean = clean.replace(imgRegex, "").trim();

  // Files
  const fileRegex = /\[CREATE_FILE:\s*([^\]]+)\]\s*```[\w]*\n([\s\S]*?)\n```/gi;
  while ((match = fileRegex.exec(text)) !== null) {
    files.push({ name: match[1].trim(), content: match[2] });
  }
  clean = clean.replace(fileRegex, "").trim();

  return { clean, images, files };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin");
    const cors = {
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "origin",
    };
    if (origin && origin !== ALLOWED_ORIGIN) return new Response("Không được phép", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("Chatbot đang chạy", { headers: cors });

    try {
      const body = await request.json();
      const messages = cleanMessages(body.messages);
      if (!messages.length) throw new Error("Chưa có tin nhắn");
      let reply = await callModel(messages, env);

      const { clean, images, files } = extractSpecials(reply);
      reply = clean || reply;

      let generatedImage = null;
      if (images.length && env.AI) {
        generatedImage = await generateImage(images[0], env);
      }

      return Response.json({
        reply,
        image: generatedImage,
        files: files.length ? files : undefined,
      }, { headers: cors });
    } catch (e) {
      return Response.json({ error: String(e.message || e) }, { status: 500, headers: cors });
    }
  },
};
