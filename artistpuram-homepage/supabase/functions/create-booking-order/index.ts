import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, getPhonePeAccessToken } from "../_shared/phonepe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Sign in before booking" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Invalid session. Please sign in again." }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  let input: { workshop_id?: string; age?: number; gender?: string; place?: string };
  try { input = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const age = Number(input.age);
  const gender = String(input.gender ?? "").trim();
  const place = String(input.place ?? "").trim();
  if (!input.workshop_id || !Number.isInteger(age) || age < 1 || age > 120 || !gender || !place) {
    return json({ error: "Workshop, valid age, gender and place are required" }, 400);
  }

  const { data: workshop, error: workshopError } = await admin.from("workshops")
    .select("id,name,price,capacity,is_open,workshop_date").eq("id", input.workshop_id).maybeSingle();
  if (workshopError || !workshop) return json({ error: "Workshop not found" }, 404);
  if (!workshop.is_open) return json({ error: "This workshop is not open for booking" }, 409);
  if (Number(workshop.price) <= 0) return json({ error: "This workshop price cannot be processed as an online payment" }, 400);

  // This is a preliminary capacity check. For high-concurrency launches, replace it with
  // a Postgres RPC that reserves a seat atomically before creating the payment order.
  const { count, error: countError } = await admin.from("bookings").select("id", { count: "exact", head: true })
    .eq("workshop_id", workshop.id).in("status", ["pending", "confirmed"]);
  if (countError) return json({ error: "Could not verify workshop availability" }, 500);
  if ((count ?? 0) >= workshop.capacity) return json({ error: "This workshop is full" }, 409);

  const amountRupees = Number(workshop.price);
  const amountPaise = Math.round(amountRupees * 100);
  const merchantOrderId = `AP${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;

  const { data: booking, error: bookingError } = await admin.from("bookings").insert({
    user_id: user.id, workshop_id: workshop.id, age, gender, place,
    amount: amountRupees, status: "pending",
  }).select("id").single();
  if (bookingError || !booking) {
    console.error("Booking insert failed", bookingError);
    return json({ error: "Could not create booking" }, 500);
  }

  const { error: paymentInsertError } = await admin.from("payments").insert({
    booking_id: booking.id, provider: "phonepe", provider_order_id: merchantOrderId,
    amount: amountRupees, status: "pending",
  });
  if (paymentInsertError) {
    await admin.from("bookings").update({ status: "failed" }).eq("id", booking.id);
    console.error("Payment row insert failed", paymentInsertError);
    return json({ error: "Could not initialize payment record" }, 500);
  }

  try {
    const { token, base } = await getPhonePeAccessToken();
    const appOrigin = Deno.env.get("APP_ORIGIN");
    if (!appOrigin) throw new Error("APP_ORIGIN is not configured");
    const payResponse = await fetch(`${base}/checkout/v2/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}` },
      body: JSON.stringify({
        merchantOrderId,
        amount: amountPaise,
        expireAfter: 1200,
        metaInfo: { udf1: booking.id, udf2: user.id, udf3: "ArtistPuram" },
        paymentFlow: {
          type: "PG_CHECKOUT",
          message: `ArtistPuram - ${workshop.name}`,
          merchantUrls: { redirectUrl: `${appOrigin}/payment-result?merchantOrderId=${encodeURIComponent(merchantOrderId)}` },
        },
      }),
    });
    const payPayload = await payResponse.json();
    if (!payResponse.ok || !payPayload.redirectUrl) {
      console.error("PhonePe create payment failed", payResponse.status, payPayload);
      await admin.from("payments").update({ status: "failed" }).eq("provider_order_id", merchantOrderId);
      await admin.from("bookings").update({ status: "failed" }).eq("id", booking.id);
      return json({ error: "PhonePe could not start checkout. Check gateway setup and try again." }, 502);
    }
    return json({ booking_id: booking.id, merchant_order_id: merchantOrderId, redirect_url: payPayload.redirectUrl });
  } catch (error) {
    console.error("PhonePe setup error", error);
    await admin.from("payments").update({ status: "failed" }).eq("provider_order_id", merchantOrderId);
    await admin.from("bookings").update({ status: "failed" }).eq("id", booking.id);
    return json({ error: error instanceof Error ? error.message : "Payment initialization failed" }, 500);
  }
});
