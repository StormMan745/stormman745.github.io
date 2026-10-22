import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = legacyServiceKey || secretKeys.default;
if (!serviceKey) throw new Error("Supabase service key is not available.");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function localTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function dateKeyFromParts(parts: Record<string, string>) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function reminderOccursOnDate(reminder: Record<string, unknown>, dateKey: string) {
  const startDate = typeof reminder.date === "string" ? reminder.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || dateKey < startDate) return false;
  const repeat = reminder.repeat === "daily" || reminder.repeat === "weekly"
    ? reminder.repeat
    : "once";
  if (repeat === "once") return dateKey === startDate && reminder.completed !== true;
  if (repeat === "daily") return true;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const current = Date.parse(`${dateKey}T00:00:00Z`);
  const dayDifference = Math.round((current - start) / 86400000);
  return dayDifference % 7 === 0;
}

function reminderIsDueNow(reminder: Record<string, unknown>, now: Date, timeZone: string) {
  const time = typeof reminder.time === "string" ? reminder.time : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;

  let parts: Record<string, string>;
  try {
    parts = localTimeParts(now, timeZone || "UTC");
  } catch {
    parts = localTimeParts(now, "UTC");
  }

  const localDate = dateKeyFromParts(parts);
  const [hour, minute] = time.split(":").map(Number);
  const nowAsLocalUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const [year, month, day] = localDate.split("-").map(Number);
  const previousDate = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  for (const candidateDate of [localDate, previousDate]) {
    if (!reminderOccursOnDate(reminder, candidateDate)) continue;
    if (reminder.repeat === "once" && reminder.completed === true) continue;
    if (reminder.repeat !== "once" && reminder.completedForDate === candidateDate) continue;
    const [dueYear, dueMonth, dueDay] = candidateDate.split("-").map(Number);
    const dueAsLocalUtc = Date.UTC(dueYear, dueMonth - 1, dueDay, hour, minute, 0);
    const elapsed = nowAsLocalUtc - dueAsLocalUtc;
    // Cron runs once a minute; keep a short catch-up window for scheduler jitter.
    if (elapsed >= 0 && elapsed < 180000) return candidateDate;
  }
  return null;
}

async function hashText(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function topicFor(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let binary = "";
  digest.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "").slice(0, 32);
}

function getPetName(user: Record<string, unknown>, reminder: Record<string, unknown>) {
  const key = String(reminder.petId ?? "");
  const pets = Array.isArray(user.pets) ? user.pets as Array<Record<string, unknown>> : [];
  const current = user.pet && typeof user.pet === "object"
    ? user.pet as Record<string, unknown>
    : null;
  const candidates = current ? [...pets, current] : pets;
  const pet = candidates.find(item => String(item.dbId ?? item.id ?? "") === key);
  return typeof pet?.name === "string" && pet.name.trim() ? pet.name.trim().slice(0, 60) : "вашего питомца";
}

function formatPushError(error: unknown) {
  const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
  return statusCode ? `push_service_${statusCode}` : "push_service_error";
}

Deno.serve(async request => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { data: runtimeSecrets, error: secretError } = await admin.rpc("petcare_get_push_runtime_secrets");
    if (secretError || !runtimeSecrets?.cronToken || !runtimeSecrets?.vapid) {
      console.error("PetCare push runtime secrets are unavailable.");
      return jsonResponse({ error: "Push dispatcher is not configured" }, 503);
    }
    const receivedToken = request.headers.get("x-petcare-cron-token") || "";
    if (!constantTimeEqual(receivedToken, runtimeSecrets.cronToken)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const vapidDetails = runtimeSecrets.vapid;
    if (!vapidDetails.subject || !vapidDetails.publicKey || !vapidDetails.privateKey) {
      return jsonResponse({ error: "Push credentials are incomplete" }, 503);
    }

    const [{ data: accounts, error: accountsError }, { data: subscriptions, error: subscriptionsError }] = await Promise.all([
      admin.rpc("petcare_get_push_reminder_data"),
      admin.from("petcare_push_subscriptions")
        .select("user_id,endpoint,subscription,timezone_name")
        .limit(5000),
    ]);
    if (accountsError || subscriptionsError) {
      console.error("PetCare push data lookup failed.", accountsError?.code || subscriptionsError?.code || "unknown");
      return jsonResponse({ error: "Unable to load push data" }, 500);
    }

    const accountById = new Map<string, Record<string, unknown>>();
    for (const account of accounts || []) accountById.set(String(account.user_id), account);

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const now = new Date();
    for (const device of subscriptions || []) {
      const userId = String(device.user_id);
      const account = accountById.get(userId);
      const subscription = device.subscription;
      if (!account || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        skipped += 1;
        continue;
      }
      const reminders = Array.isArray(account.reminders)
        ? account.reminders as Array<Record<string, unknown>>
        : [];
      const endpointHash = await hashText(String(device.endpoint));

      for (const reminder of reminders) {
        const dueDate = reminderIsDueNow(reminder, now, String(device.timezone_name || "UTC"));
        const reminderId = String(reminder.id ?? "");
        const reminderText = typeof reminder.name === "string" ? reminder.name.trim().slice(0, 180) : "";
        if (!dueDate || !reminderId || !reminderText) continue;

        const notificationKey = `${userId}:${reminderId}:${dueDate}`;
        const { data: previous, error: previousError } = await admin
          .from("petcare_push_delivery_log")
          .select("status,attempt_count")
          .eq("endpoint_hash", endpointHash)
          .eq("notification_key", notificationKey)
          .maybeSingle();
        if (previousError) {
          failed += 1;
          continue;
        }
        if (previous?.status === "sent" || Number(previous?.attempt_count || 0) >= 3) {
          skipped += 1;
          continue;
        }

        const attemptCount = Number(previous?.attempt_count || 0) + 1;
        const logEntry = {
          endpoint_hash: endpointHash,
          notification_key: notificationKey,
          user_id: userId,
          reminder_id: reminderId,
          due_date: dueDate,
          status: "sending",
          attempt_count: attemptCount,
          last_attempt_at: new Date().toISOString(),
          last_error: null,
        };
        const { error: logError } = await admin
          .from("petcare_push_delivery_log")
          .upsert(logEntry, { onConflict: "endpoint_hash,notification_key" });
        if (logError) {
          failed += 1;
          continue;
        }

        const petName = getPetName(account, reminder);
        const title = petName === "вашего питомца" ? "Напоминание PetCare" : `${petName}: напоминание`;
        const notificationTag = await topicFor(notificationKey);
        const body = `${reminderText}${reminder.time ? ` · ${reminder.time}` : ""}`;
        try {
          await webpush.sendNotification(subscription, JSON.stringify({
            title,
            body,
            tag: notificationTag,
            timestamp: now.getTime(),
            url: "/?page=reminders",
          }), {
            TTL: 3600,
            urgency: "high",
            topic: notificationTag,
            vapidDetails,
          });
          const { error: updateError } = await admin
            .from("petcare_push_delivery_log")
            .update({ status: "sent", delivered_at: new Date().toISOString(), last_error: null })
            .eq("endpoint_hash", endpointHash)
            .eq("notification_key", notificationKey);
          if (updateError) throw updateError;
          sent += 1;
        } catch (error) {
          const errorCode = formatPushError(error);
          await admin
            .from("petcare_push_delivery_log")
            .update({ status: errorCode === "push_service_404" || errorCode === "push_service_410" ? "gone" : "failed", last_error: errorCode })
            .eq("endpoint_hash", endpointHash)
            .eq("notification_key", notificationKey);
          if (errorCode === "push_service_404" || errorCode === "push_service_410") {
            await admin.from("petcare_push_subscriptions").delete().eq("endpoint", device.endpoint);
          }
          failed += 1;
        }
      }
    }

    return jsonResponse({ ok: true, sent, skipped, failed });
  } catch (error) {
    console.error("PetCare push dispatcher failed:", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "Push dispatcher failed" }, 500);
  }
});
