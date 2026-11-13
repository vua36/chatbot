// worker.js - backend chatbot (Cloudflare Worker), bản miễn phí dùng Groq.
// Muốn đổi nhà cung cấp: chỉ cần sửa BASE_URL và MODEL (nhiều nơi dùng cùng định dạng này).

const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";
const SYSTEM_PROMPT =
  "Bạn là trợ lý riêng, thân thiện, trả lời ngắn gọn bằng tiếng Việt.";

// Hàm "gọi model" tách riêng: sau này đổi sang model tự train chỉ cần sửa hàm này.
async function callModel(messages, env) {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Lỗi API");
  return data.choices[0].message.content;
}

export default {
  async fetch(request, env) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Chatbot đang chạy", { headers: cors });
    }

    try {
      const { messages } = await request.json();
      const reply = await callModel(messages, env);
      return Response.json({ reply }, { headers: cors });
    } catch (e) {
      return Response.json(
        { error: String(e.message || e) },
        { status: 500, headers: cors }
      );
    }
  },
};
