
// worker.js - Cloudflare Worker + Groq
// Chatbot backend

const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";

const SYSTEM_PROMPT =
  "Bạn là trợ lý riêng, thân thiện, thông minh. " +
  "Luôn trả lời bằng tiếng Việt, rõ ràng, chính xác và dễ hiểu. " +
  "Ưu tiên trả lời trực tiếp, không dài dòng khi không cần thiết.";

const ALLOWED_ORIGINS = new Set([
  "https://vua36.github.io"
]);

function jsonResponse(data, status, cors) {
  return Response.json(data, {
    status,
    headers: cors
  });
}

async function callModel(messages, env) {
  if (!env.LLM_API_KEY) {
    throw new Error("Chưa cấu hình LLM_API_KEY trên Cloudflare.");
  }

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        ...messages
      ],
      max_completion_tokens: 1200,
      reasoning_effort: "low"
    }),
    signal: AbortSignal.timeout(30000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error?.message || "Groq API không phản hồi thành công."
    );

    error.status = response.status;
    throw error;
  }

  const reply = data.choices?.[0]?.message?.content;

  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("AI trả về nội dung trống.");
  }

  return reply.trim();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    const cors = {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    // Kiểm tra website được phép gọi Worker
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse(
        { error: "Website không được phép truy cập." },
        403,
        cors
      );
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    if (request.method !== "POST") {
      return new Response("Chatbot API đang hoạt động.", {
        status: 200,
        headers: cors
      });
    }

    try {
      let body;

      try {
        body = await request.json();
      } catch {
        return jsonResponse(
          { error: "Dữ liệu gửi lên không hợp lệ." },
          400,
          cors
        );
      }

      const messages = body?.messages;

      if (!Array.isArray(messages) || messages.length === 0) {
        return jsonResponse(
          { error: "Không tìm thấy nội dung tin nhắn." },
          400,
          cors
        );
      }

      // Chỉ nhận nội dung hội thoại hợp lệ
      const safeMessages = messages
        .slice(-20)
        .filter(message =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.trim().length > 0
        )
        .map(message => ({
          role: message.role,
          content: message.content.trim()
        }));

      if (safeMessages.length === 0) {
        return jsonResponse(
          { error: "Không có tin nhắn hợp lệ." },
          400,
          cors
        );
      }

      if (safeMessages.some(m => m.content.length > 12000)) {
        return jsonResponse(
          { error: "Tin nhắn quá dài." },
          413,
          cors
        );
      }

      const reply = await callModel(safeMessages, env);

      return jsonResponse(
        { reply },
        200,
        cors
      );

    } catch (error) {
      const status =
        error.name === "TimeoutError" ? 504 :
        error.status === 429 ? 429 :
        error.status === 400 ? 400 :
        500;

      return jsonResponse(
        {
          error:
            error.name === "TimeoutError"
              ? "AI phản hồi quá lâu. Hãy thử lại."
              : error.message || "Lỗi máy chủ chatbot."
        },
        status,
        cors
      );
    }
  }
};
