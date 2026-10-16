const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Разрешены только POST-запросы." }, 405);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "На сервере не настроен ключ OpenAI (OPENAI_API_KEY)." }, 503);
  }

  let body: { messages?: unknown; pet?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Не удалось прочитать вопрос." }, 400);
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
    return jsonResponse({ error: "Напиши вопрос, чтобы начать разговор." }, 400);
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
        return jsonResponse({ error: "Ключ OpenAI не принят. Проверь секрет OPENAI_API_KEY в Supabase." }, 502);
      }
      if (status === 429) {
        return jsonResponse({ error: "Сейчас исчерпан лимит запросов OpenAI. Попробуй немного позже." }, 503);
      }
      return jsonResponse({ error: "OpenAI временно не смог ответить. Попробуй ещё раз." }, 502);
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
      return jsonResponse({ error: "Модель не вернула текстовый ответ. Попробуй задать вопрос иначе." }, 502);
    }

    return jsonResponse({ answer });
  } catch (error) {
    console.error("PetCare assistant request failed:", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "Не удалось связаться с ИИ. Проверь интернет и попробуй ещё раз." }, 502);
  }
});
