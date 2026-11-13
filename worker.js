// worker.js - backend chatbot (Cloudflare Worker) dùng Groq (miễn phí).

const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
// Thử lần lượt từ trên xuống: model đầu bị lỗi hoặc bị gỡ thì tự chuyển sang model sau.
const MODELS = ["openai/gpt-oss-120b", "llama-3.1-8b-instant"];
// Chỉ trang web của bạn được gọi vào Worker này.
const ALLOWED_ORIGIN = "https://vua36.github.io";
const MAX_MESSAGES = 20; // số tin gần nhất được giữ lại
const MAX_CHARS = 4000;  // độ dài tối đa mỗi tin

function systemPrompt() {
  const today = new Date().toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
  return [
    "Bạn là trợ lý AI cá nhân. Mặc định trả lời bằng tiếng Việt tự nhiên, thân thiện, đi thẳng vào câu trả lời; nếu người dùng viết bằng ngôn ngữ khác thì trả lời bằng ngôn ngữ đó.",
    "Câu hỏi đơn giản thì trả lời ngắn gọn. Vấn đề phức tạp thì giải thích từng bước, rõ ràng.",
    "Không biết hoặc không chắc thì nói thẳng, tuyệt đối không bịa số liệu, tên người hay đường link. Bạn không có internet nên không biết tin tức mới.",
    "Giao diện chỉ hiển thị văn bản thường: không dùng bảng hay ký hiệu markdown như ** hoặc #. Cần liệt kê thì dùng gạch đầu dòng bắt đầu bằng dấu -, và đặt code trong khối ```.",
    "Hôm nay là " + today + ".",
  ].join("\n");
}

// Chỉ nhận tin của user/assistant, cắt độ dài, chặn việc ai đó tự chèn tin "system".
function cleanMessages(input) {
  if (!Array.isArray(input)) throw new Error("Dữ liệu không hợp lệ");
  return input
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

// Hàm "gọi model" tách riêng: sau này đổi sang model tự train chỉ cần sửa hàm này.
async function callModel(messages, env) {
  let lastError = "Lỗi không rõ";
  for (const model of MODELS) {
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          messages: [{ role: "system", content: systemPrompt() }, ...messages],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Lỗi " + res.status);
      const text = data.choices?.[0]?.message?.content;
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

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Không được phép", { status: 403 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Chatbot đang chạy", { headers: cors });
    }

    try {
      const body = await request.json();
      const messages = cleanMessages(body.messages);
      if (!messages.length) throw new Error("Chưa có tin nhắn");
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
