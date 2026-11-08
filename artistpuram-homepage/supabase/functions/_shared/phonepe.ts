export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "http://localhost:5173",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function phonePeBaseUrl() {
  const mode = (Deno.env.get("PHONEPE_ENV") ?? "SANDBOX").toUpperCase();
  if (mode === "SANDBOX") return "https://api-preprod.phonepe.com/apis/pg-sandbox";
  if (mode === "PRODUCTION") return "https://api.phonepe.com/apis/pg";
  throw new Error("PHONEPE_ENV must be SANDBOX or PRODUCTION");
}

export async function getPhonePeAccessToken() {
  const clientId = Deno.env.get("PHONEPE_CLIENT_ID");
  const clientSecret = Deno.env.get("PHONEPE_CLIENT_SECRET");
  const clientVersion = Deno.env.get("PHONEPE_CLIENT_VERSION");
  if (!clientId || !clientSecret || !clientVersion) {
    throw new Error("PhonePe credentials are not configured in Supabase secrets");
  }

  const base = phonePeBaseUrl();
  const response = await fetch(`${base}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_version: clientVersion,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    console.error("PhonePe token request failed", response.status, payload);
    throw new Error("Could not authenticate with PhonePe. Check credentials and environment.");
  }
  return { token: payload.access_token as string, base };
}
