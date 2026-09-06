// @ts-nocheck
// Runs on Deno (Supabase Edge Functions), not Next.js - type checking is off
// here so `next build` does not try to resolve Deno imports.
//
// Creating and deleting an auth user needs the service role, which must never
// reach the browser. The caller's own JWT is used only to establish that they
// are a finance administrator; every privileged action runs on a separate
// service-role client.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid session" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Authorisation is read from fin_users, never from the POS profiles table.
    const { data: caller } = await adminClient
      .from("fin_users")
      .select("role, is_active")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!caller || !caller.is_active || caller.role !== "fin_admin") {
      return json({ error: "Only a finance administrator may manage users" }, 403);
    }

    const body = await req.json();

    if (body.action === "delete") {
      const { user_id } = body;
      if (!user_id) return json({ error: "Missing user_id" }, 400);
      if (user_id === userData.user.id) {
        return json({ error: "Cannot delete your own account" }, 400);
      }

      // fin_users cascades from auth.users, and fin_user_stores from fin_users.
      const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteErr) return json({ error: deleteErr.message }, 400);
      return json({ success: true });
    }

    // default action: create
    const { email, password, name, role, all_stores, permissions, stores } = body;

    if (!email || !password || !role) {
      return json({ error: "Email, password and role are required" }, 400);
    }
    if (String(password).length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }
    if (!["fin_admin", "fin_manager", "accountant", "viewer"].includes(role)) {
      return json({ error: "Unknown role" }, 400);
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const { error: insertErr } = await adminClient.from("fin_users").insert({
      id: created.user.id,
      email: String(email).toLowerCase(),
      name: name || null,
      role,
      all_stores: !!all_stores,
      permissions: permissions || [],
      is_active: true,
      created_by: userData.user.email,
    });

    // A finance row that failed to write would leave an auth user nobody can
    // reach, so the account is rolled back rather than left half-created.
    if (insertErr) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: insertErr.message }, 400);
    }

    const scope: string[] = Array.isArray(stores) ? stores : [];
    if (scope.length > 0 && !all_stores) {
      const { error: scopeErr } = await adminClient
        .from("fin_user_stores")
        .insert(scope.map((store_id: string) => ({ user_id: created.user.id, store_id })));
      if (scopeErr) return json({ error: scopeErr.message }, 400);
    }

    return json({ success: true, user_id: created.user.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
