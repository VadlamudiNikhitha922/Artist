import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, getPhonePeAccessToken } from "../_shared/phonepe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Sign in to check this booking" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Invalid session" }, 401);

  let merchantOrderId = "";
  try { merchantOrderId = String((await req.json()).merchant_order_id ?? ""); } catch { /* invalid body below */ }
  if (!/^AP[a-f0-9]{24}$/i.test(merchantOrderId)) return json({ error: "Invalid merchant order ID" }, 400);

  const { data: payment, error: paymentError } = await admin.from("payments")
    .select("id,booking_id,amount,provider_order_id,bookings!inner(user_id,amount,status)")
    .eq("provider", "phonepe").eq("provider_order_id", merchantOrderId).maybeSingle();
  if (paymentError || !payment) return json({ error: "Payment order not found" }, 404);
  const booking = Array.isArray(payment.bookings) ? payment.bookings[0] : payment.bookings;
  if (!booking || (booking.user_id !== user.id && !(await isOwner(admin, user.id)))) {
    return json({ error: "You cannot access this payment" }, 403);
  }

  try {
    const { token, base } = await getPhonePeAccessToken();
    const response = await fetch(`${base}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true`, {
      headers: { Authorization: `O-Bearer ${token}` },
    });
    const statusPayload = await response.json();
    if (!response.ok) {
      console.error("PhonePe status query failed", response.status, statusPayload);
      return json({ error: "Could not verify payment with PhonePe" }, 502);
    }

    const state = String(statusPayload.state ?? "").toUpperCase();
    const expectedPaise = Math.round(Number(payment.amount) * 100);
    const reportedAmount = Number(statusPayload.amount);
    // Only accept a COMPLETED order with the exact expected amount.
    if (state === "COMPLETED" && Number.isFinite(reportedAmount) && reportedAmount === expectedPaise) {
      const transactionId = statusPayload.paymentDetails?.[0]?.transactionId ?? statusPayload.orderId ?? null;
      await admin.from("payments").update({ status: "paid", provider_payment_id: transactionId }).eq("id", payment.id);
      await admin.from("bookings").update({ status: "confirmed" }).eq("id", payment.booking_id).eq("status", "pending");
      return json({ status: "paid", booking_id: payment.booking_id });
    }
    if (state === "FAILED" || state === "REJECTED") {
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id).eq("status", "pending");
      await admin.from("bookings").update({ status: "failed" }).eq("id", payment.booking_id).eq("status", "pending");
      return json({ status: "failed", booking_id: payment.booking_id });
    }
    return json({ status: "pending", booking_id: payment.booking_id });
  } catch (error) {
    console.error("Payment verification error", error);
    return json({ error: "Payment status could not be verified. Please retry." }, 500);
  }
});

async function isOwner(admin: ReturnType<typeof createClient>, userId: string) {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "owner";
}
