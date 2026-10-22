const allowedOrigins = new Set([
  "https://stormman745.github.io",
  "https://www.stormman745.github.io",
]);

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.has(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

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

  if (origin && isAllowedOrigin(origin)) {
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

class GigaChatApiError extends Error {
  constructor(readonly status: number, readonly stage: "auth" | "chat") {
    super(`GigaChat ${stage} request failed with status ${status}`);
  }
}

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;
let accessTokenRequest: Promise<string> | null = null;

async function getGigaChatAccessToken(
  authKey: string,
  scope: string,
  client?: Deno.HttpClient,
) {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }
  if (accessTokenRequest) return accessTokenRequest;

  const requestPromise = (async () => {
    const response = await fetch("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authKey}`,
        "RqUID": crypto.randomUUID(),
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      body: new URLSearchParams({ scope }),
      ...(client ? { client } : {}),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) throw new GigaChatApiError(response.status, "auth");

    const result = await response.json();
    if (typeof result.access_token !== "string" || !result.access_token) {
      throw new Error("GigaChat did not return an access token");
    }

    const expiresAt = Number(result.expires_at);
    cachedAccessToken = result.access_token;
    cachedAccessTokenExpiresAt = Number.isFinite(expiresAt) && expiresAt > 0
      ? expiresAt * 1000
      : Date.now() + 29 * 60_000;
    return cachedAccessToken;
  })();

  accessTokenRequest = requestPromise;
  try {
    return await requestPromise;
  } finally {
    if (accessTokenRequest === requestPromise) accessTokenRequest = null;
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    console.warn("PetCare assistant rejected origin:", origin);
    return new Response("Forbidden origin", { status: 403, headers: corsHeaders(request) });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Разрешены только POST-запросы." }, 405);
  }

  const authKey = (
    Deno.env.get("GIGACHAT_AUTH_KEY") ||
    Deno.env.get("GIGACHAT_API_KEY") ||
    Deno.env.get("GIGACHAT_CREDENTIALS") ||
    ""
  ).trim();
  if (!authKey) {
    return jsonResponse(request, { error: "В Supabase не настроен ключ GigaChat (GIGACHAT_AUTH_KEY)." }, 503);
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

  const caCertificate = Deno.env.get("GIGACHAT_CA_CERT")?.trim();
  let httpClient: Deno.HttpClient | undefined;
  try {
    if (caCertificate?.includes("-----BEGIN CERTIFICATE-----")) {
      httpClient = Deno.createHttpClient({ caCerts: [caCertificate] });
    }

    const scope = Deno.env.get("GIGACHAT_SCOPE") || "GIGACHAT_API_PERS";
    const accessToken = await getGigaChatAccessToken(authKey, scope, httpClient);
    const response = await fetch("https://api.giga.chat/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("GIGACHAT_MODEL") || "GigaChat-2",
        messages: [
          { role: "system", content: instructions },
          ...messages,
        ],
        max_tokens: 600,
        temperature: 0.7,
        stream: false,
      }),
      ...(httpClient ? { client: httpClient } : {}),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) throw new GigaChatApiError(response.status, "chat");

    const result = await response.json();
    const answer = typeof result.choices?.[0]?.message?.content === "string"
      ? result.choices[0].message.content.trim()
      : "";

    if (!answer) {
      return jsonResponse(request, { error: "GigaChat не вернул текстовый ответ. Попробуй задать вопрос иначе." }, 502);
    }

    return jsonResponse(request, { answer });
  } catch (error) {
    if (error instanceof GigaChatApiError) {
      console.error(`GigaChat ${error.stage} request failed with status:`, error.status);
      if (error.stage === "auth" && (error.status === 401 || error.status === 403)) {
        return jsonResponse(request, { error: "Ключ GigaChat не принят. Проверьте секрет GIGACHAT_AUTH_KEY в Supabase." }, 502);
      }
      if (error.status === 429) {
        return jsonResponse(request, { error: "Лимит запросов GigaChat исчерпан. Попробуй немного позже." }, 503);
      }
      return jsonResponse(request, { error: "GigaChat временно не смог ответить. Попробуй ещё раз." }, 502);
    }

    console.error("PetCare GigaChat request failed:", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse(request, { error: "Не удалось связаться с GigaChat. Проверь интернет и попробуй ещё раз." }, 502);
  } finally {
    httpClient?.close();
  }
});

