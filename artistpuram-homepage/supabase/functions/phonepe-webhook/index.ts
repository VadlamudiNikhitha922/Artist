import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "../_shared/phonepe.ts";

// IMPORTANT: Configure PhonePe's webhook username/password in the merchant portal and
// implement the exact authorization validation required by the account's PhonePe docs.
// This endpoint intentionally fails closed until that secret is configured. Do not treat
// a browser redirect as payment proof; verify-phonepe-payment also checks PhonePe status.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("PHONEPE_WEBHOOK_AUTHORIZATION");
  const received = req.headers.get("Authorization");
  if (!expected || !received || received !== expected) {
    return json({ error: "Webhook authentication is not configured or did not match" }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  // Event payloads vary by PhonePe product/version. We do not update money state based on
  // an unverified/unmapped event. Keep this log for mapping after merchant account setup.
  console.log("Authenticated PhonePe webhook received", JSON.stringify({
    event: body.event, type: body.type, payloadKeys: Object.keys(body),
  }));

  // TODO after PhonePe merchant portal setup: map the exact subscribed webhook payload,
  // verify event/order/amount against the order-status API, then idempotently update rows.
  // Never mark a booking paid from an event name alone.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  void admin;
  return json({ received: true, processed: false, message: "Webhook accepted; event mapping is pending merchant setup" });
});
