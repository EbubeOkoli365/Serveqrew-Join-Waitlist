// IMPORTS 
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.34.0";

// ENVIRONMENT VARIABLES.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Environment validation.
if (!SUPABASE_URL) {
  console.error ("SUPABASE_URL is missing");
  throw new Error ("SUPABASE_URL is missing");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error ("SUPABASE_SERVICE_ROLE_KEY is missing");
  throw new Error ("SUPABASE_SERVICE_ROLE_KEY is missing");
}

// 3. CONSTANTS.
// Status code.
const HTTP_405_METHOD_NOT_ALLOWED = 405;
const HTTP_400_SOMETHING_WENT_WRONG = 400;
const HTTP_200_SUCCESS = 200;

// CORS.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "OPTIONS, GET"
}

serve (async (req) => {
  if (req.method === "OPTIONS") {
    return new Response ("ok", {
      status: 200,
      headers: corsHeaders
    })
  }

  if (req.method !== "GET") {
    return new Response (JSON.stringify ({
      message: "Method not allowed. Use GET only."
    }), {
      status: HTTP_405_METHOD_NOT_ALLOWED,
      headers: corsHeaders
    })
  }

  const supabase = createClient (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
      const {data, error} = await supabase
      .from ("waitlist_leaderboard")
      .select ("full_name, referral_code, referral_count")
      .order ("referral_count", {ascending: false})
      .limit (10)

      if (error) {
        console.error ("DB ERROR DETAILS: ", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        })
        throw error
      }

      const leaderboard = data.map ((user, index) => ({
        ...user,
        rank: index + 1
      }))

      return new Response (JSON.stringify(leaderboard), {
        status: HTTP_200_SUCCESS,
        headers: {...corsHeaders, 'Content-Type': 'application/json'},
      })
  } 
  catch (error) {
    console.error (error)
    return new Response (JSON.stringify ({
      error: error.message}), {
        status: HTTP_400_SOMETHING_WENT_WRONG,
        headers: {...corsHeaders, 'Content-Type': 'application/json'}
      })
  }
})
