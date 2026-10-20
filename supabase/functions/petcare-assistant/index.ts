const allowedOrigins = new Set(["https://stormman745.github.io"]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

const MAX_REQUEST_BYTES = 64 * 1024;

async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) throw new RangeError("Request body too large");

  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Empty request body");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RangeError("Request body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(bytes));
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return new Response("Forbidden origin", { status: 403, headers: corsHeaders(request) });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Разрешены только POST-запросы." }, 405);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return jsonResponse(request, { error: "На сервере не настроен ключ OpenAI (OPENAI_API_KEY)." }, 503);
  }

  let body: { messages?: unknown; pet?: Record<string, unknown> };
  try {
    const parsed = await readJsonBody(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("Invalid JSON object");
    }
    body = parsed as { messages?: unknown; pet?: Record<string, unknown> };
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse(request, { error: "Слишком большой запрос." }, 413);
    }
    return jsonResponse(request, { error: "Не удалось прочитать вопрос." }, 400);
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
        .slice(-12)
        .filter((item): item is { role: string; content: string } =>
          !!item && typeof item === "object" &&
          ["user", "assistant"].includes((item as { role?: string }).role || "") &&
          typeof (item as { content?: unknown }).content === "string")
        .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 1200) }))
        .filter((item) => item.content.length > 0)
    : [];

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return jsonResponse(request, { error: "Напиши вопрос, чтобы начать разговор." }, 400);
  }

  const pet = body.pet && typeof body.pet === "object" ? body.pet : {};
  const petContext = [
    cleanText(pet.name, 80) && `Имя: ${cleanText(pet.name, 80)}`,
    cleanText(pet.breed, 100) && `Порода: ${cleanText(pet.breed, 100)}`,
    cleanText(pet.animal, 40) && `Тип животного: ${cleanText(pet.animal, 40)}`,
    cleanText(pet.weight, 20) && `Вес: ${cleanText(pet.weight, 20)} кг`,
  ].filter(Boolean).join("; ");

  const instructions = [
    "Ты — PetCare AI, дружелюбный русскоязычный помощник по повседневному уходу за домашними животными.",
    "Отвечай понятно и по делу, учитывай вид животного и его данные, если они переданы.",
    "Не ставь диагнозы, не назначай лекарства и дозировки, не заменяй ветеринарного врача.",
    "При затруднённом дыхании, судорогах, потере сознания, сильном кровотечении, подозрении на отравление или быстром ухудшении состояния советуй немедленно обратиться в ближайшую круглосуточную ветеринарную клинику.",
    "Если информации недостаточно, задай уточняющий вопрос. Не выдумывай факты.",
    petContext ? `Данные питомца: ${petContext}.` : "Пользователь пока не указал данные питомца.",
  ].join("\n");

  try {
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-6-astra",
        instructions,
        input: messages,
        max_output_tokens: 600,
        store: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!openAiResponse.ok) {
      const status = openAiResponse.status;
      console.error("OpenAI request failed with status:", status);
      if (status === 401 || status === 403) {
        return jsonResponse(request, { error: "Ключ OpenAI не принят. Проверь секрет OPENAI_API_KEY в Supabase." }, 502);
      }
      if (status === 429) {
        return jsonResponse(request, { error: "Сейчас исчерпан лимит запросов OpenAI. Попробуй немного позже." }, 503);
      }
      return jsonResponse(request, { error: "OpenAI временно не смог ответить. Попробуй ещё раз." }, 502);
    }

    const result = await openAiResponse.json();
    const answer = Array.isArray(result.output)
      ? result.output
          .flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
          .filter((item: { type?: string; text?: string }) => item.type === "output_text" && typeof item.text === "string")
          .map((item: { text: string }) => item.text)
          .join("\n")
          .trim()
      : "";

    if (!answer) {
      return jsonResponse(request, { error: "Модель не вернула текстовый ответ. Попробуй задать вопрос иначе." }, 502);
    }

    return jsonResponse(request, { answer });
  } catch (error) {
    console.error("PetCare assistant request failed:", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse(request, { error: "Не удалось связаться с ИИ. Проверь интернет и попробуй ещё раз." }, 502);
  }
});
