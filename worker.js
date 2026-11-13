// worker.js - backend chatbot Vua36 (Cloudflare Worker) dùng Groq (miễn phí).

const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
// Thử lần lượt từ trên xuống: model đầu lỗi hoặc bị gỡ thì tự chuyển sang model sau.
const TEXT_MODELS = ["openai/gpt-oss-120b", "llama-3.1-8b-instant"];
const VISION_MODELS = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b"]; // dùng khi tin nhắn có ảnh
const ALLOWED_ORIGIN = "https://vua36.github.io";
const MAX_MESSAGES = 20;
const MAX_CHARS = 9000;          // độ dài tối đa mỗi tin (đủ cho tệp đã cắt)
const MAX_IMAGE_CHARS = 3000000; // kích thước tối đa của 1 ảnh (base64)

function systemPrompt() {
  const today = new Date().toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "numeric", month: "numeric", year: "numeric",
  });
  return [
    "Tên bạn là Vua36, một trợ lý AI cá nhân. Khi được hỏi tên hoặc bạn là ai, hãy giới thiệu bạn là Vua36. Không tự nhận là ChatGPT hay sản phẩm của công ty nào; nếu được hỏi cụ thể về model hay công nghệ phía sau, nói thật là bạn không chắc về chi tiết kỹ thuật.",
    "Mặc định trả lời bằng tiếng Việt tự nhiên, thân thiện, đi thẳng vào câu trả lời; nếu người dùng viết bằng ngôn ngữ khác thì trả lời bằng ngôn ngữ đó.",
    "Câu hỏi đơn giản thì trả lời ngắn gọn. Vấn đề phức tạp thì giải thích từng bước, rõ ràng.",
    "Không biết hoặc không chắc thì nói thẳng, tuyệt đối không bịa số liệu, tên người hay đường link. Bạn không có internet nên không biết tin tức mới.",
    "Người dùng có thể gửi ảnh, hoặc nội dung tệp nằm ngay trong tin nhắn (trong khối ```). Hãy dựa vào đó để trả lời.",
    "Giao diện chỉ hiển thị văn bản thường: không dùng bảng hay ký hiệu markdown như ** hoặc #. Cần liệt kê thì dùng gạch đầu dòng bắt đầu bằng dấu -, và đặt code trong khối ```.",
    "Hôm nay là " + today + ".",
  ].join("\n");
}

// Chỉ nhận tin user/assistant, cắt độ dài, tối đa 1 ảnh (ảnh mới nhất).
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

// Hàm "gọi model" tách riêng: sau này đổi sang model tự train chỉ cần sửa hàm này.
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
          max_tokens: 3000,
          messages: [{ role: "system", content: systemPrompt() }, ...messages],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Lỗi " + res.status);
      // Một số model có chèn phần "suy nghĩ" trong <think>...</think>, bỏ đi cho gọn.
      const text = (data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) throw new Error("Model không trả nội dung");
      return text;
    } catch (e) {
      lastError = model + ": " + (e.message || e);
    }
  }
  throw new Error(lastError);
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
      const reply = await callModel(messages, env);
      return Response.json({ reply }, { headers: cors });
    } catch (e) {
      return Response.json({ error: String(e.message || e) }, { status: 500, headers: cors });
    }
  },
};
