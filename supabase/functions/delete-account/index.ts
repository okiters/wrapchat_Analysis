const ALLOWED_ORIGINS = new Set([
  "https://wrapchat.vercel.app",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://wrapchat.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function readError(res: Response) {
  try {
    const body = await res.json();
    return typeof body?.message === "string" ? body.message : JSON.stringify(body);
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function deleteRows(table: string, userId: string, supabaseUrl: string, serviceKey: string) {
  const url = `${supabaseUrl}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
  });

  if (!res.ok) {
    throw new Error(`Could not delete ${table}: ${await readError(res)}`);
  }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, CORS);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: "Server is missing Supabase configuration." }, 500, CORS);
  }

  const token = getBearerToken(req.headers.get("Authorization"));
  if (!token) {
    return jsonResponse({ error: "Unauthorized" }, 401, CORS);
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!userRes.ok) {
    return jsonResponse({ error: "Unauthorized" }, 401, CORS);
  }

  const user = await userRes.json();
  const userId = typeof user?.id === "string" ? user.id : "";
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401, CORS);
  }

  try {
    await deleteRows("feedback", userId, supabaseUrl, serviceKey);
    await deleteRows("results", userId, supabaseUrl, serviceKey);
    await deleteRows("credits", userId, supabaseUrl, serviceKey);

    const deleteUserRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (!deleteUserRes.ok) {
      throw new Error(`Could not delete auth user: ${await readError(deleteUserRes)}`);
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Account deletion failed." },
      500,
      CORS,
    );
  }

  return jsonResponse({ success: true }, 200, CORS);
});
