// IMPORTS.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.34.0";

// CONSTANTS.
// Status codes.
const HTTP_204_OK = 204;
const HTTP_405_METHOD_NOT_ALLOWED = 405;
const HTTP_401_UNAUTHORIZED = 401;
const HTTP_404_PROFILE_NOT_FOUND = 404;
const HTTP_200_SUCCESSFUL = 200;
const HTTP_500_INTERNAL_SERVER_ERROR = 500;

// CORS constants.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
};

// ENVIRONMENT VARIABLES. 
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Environment validation.
if (!SUPABASE_URL) {
  throw new Error ("SUPABASE_URL is missing");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error ("SUPABASE_SERVICE_ROLE_KEY is missing");
}

// SUPABASE CLIENT.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// MAIN HANDLER.
serve (async (req) => {
  // CORS.
  if (req.method === "OPTIONS") {
    return new Response (null, 
    {
      status: HTTP_204_OK,
      headers: CORS_HEADERS
    },
    );
  }
  if (req.method !== "GET") {
    return new Response (
      "Method not allowed", 
      {
        status: HTTP_405_METHOD_NOT_ALLOWED,
        headers: CORS_HEADERS
      },
    );
  }

  try {
    // Get user from JWT (Supabase auto-headers)
    const authHeader = req.headers.get ("Authorization");
    if (!authHeader?.startsWith ("Bearer ")) {
      return new Response (
        JSON.stringify ({
          error: "unauthorized"
        }),
        {
          status: HTTP_401_UNAUTHORIZED,
          headers: CORS_HEADERS
        },
      );
    }

    const jwt = authHeader.slice(7);
    const {data: {user}, error: authError} = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return new Response (
        JSON.stringify ({
          error: "invalid_token"
        }),
        {
          status: HTTP_401_UNAUTHORIZED,
          headers: CORS_HEADERS
        },
      );
    }

    //  Find user's waitlist entry by email.
    const {data: profile, error: profileError} = await supabase
    .from ("waitlist_signups")
    .select ("id, full_name, email, referral_code, referral_count, created_at, brand_name")
    .eq ("email", user.email!)
    .single();

    if (profileError || !profile) {
      return new Response (
        JSON.stringify ({
          error: "profile_not_found"
        }),
        {
          status: HTTP_404_PROFILE_NOT_FOUND,
          headers: CORS_HEADERS
        },
      );
    }

    // Get user's referrals.
    const {data: referrals} = await supabase
    .from ("waitlist_signups")
    .select ("id, full_name, email, brand_name, created_at")
    .eq ("referred_by", profile.referral_code)
    .order ("created_at", {ascending: false})
    .limit (50);

    return new Response (
      JSON.stringify ({
        success: true,
        profile: {
          name: profile.full_name,
          brand: profile.brand_name,
          code: profile.referral_code,
          referrals: profile.referral_count || 0,
          joined: profile.created_at,
          shareLink: `https://serveqrew.org?ref=${profile.referral_code}`
        },
        recentReferrals: (referrals || []).map(r => ({
          name: r.full_name,
          brand: r.brand_name,
          email: r.email,
          joined: r.created_at
        }))
      }),
      {
        status: HTTP_200_SUCCESSFUL,
        headers: CORS_HEADERS
      },
    );
    } catch (error) {
      console.error ("Dashboard error: ", error);
      return new Response (
        JSON.stringify ({
          error: "internal_server_error"
        }),
        {
          status: HTTP_500_INTERNAL_SERVER_ERROR,
          headers: CORS_HEADERS
        },
      );
    }
});

