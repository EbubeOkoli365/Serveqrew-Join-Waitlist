// IMPORTS.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.34.0";
import { Resend } from "https://esm.sh/resend@3.2.0";


// ENVIRONMENT VARIABLES.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;


// Environment variables validation.
if (!SUPABASE_URL) {
  console.error("SUPABASE_URL is missing.");
  throw new Error("Missing SUPABASE_URL");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY is missing.");
  throw new Error("Missing RESEND_API_KEY");
}

// CLIENT INITIALIZATION.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(RESEND_API_KEY);


// INTERFACES AND TYPES.
interface WaitlistSignup {
  id: string; // uuid
  full_name: string;
  email: string;
  brand_name?: string;
  created_at: string;
  referral_code: string;
  referred_by?: string | null;
  referral_count: number;
}

interface WaitlistSignupRequestBody {
  full_name: string;
  email: string;
  brand_name?: string;
}


// HELPERS.
// 1. Rate limiting.
const WINDOW_MS = 120_000; // 2 mins.
const MAX_REQUESTS = 5; // 5 req per 2 mins.

async function checkRateLimit(ip: string, endpoint: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const { count, error } = await supabase
    .from("waitlist_rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("endpoint", endpoint)
    .gte("created_at", windowStart);

  if (error) {
    console.error("rate limit select error: ", error);
    // Fail open on rate‑limit error so users are not blocked by logging issues.
    return true;
  }

  if ((count ?? 0) >= MAX_REQUESTS) {
    return false;
  }

  const { error: insertError } = await supabase
    .from("waitlist_rate_limits")
    .insert({ ip, endpoint });

  if (insertError) {
    console.error("rate limit insert error: ", insertError);
  }

  return true;
}


// 2. Configuration.
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://serveqrew.org", // TODO: tighten when I have a frontend link.
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// 3. Method + CORS.
function validateCors(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "method_not_allowed",
        message: "Only POST method is allowed on this endpoint.",
      }),
      {
        status: 405,
        headers: corsHeaders,
      },
    );
  }

  return null;
}

// 4. Headers function.
function validateHeaders(req: Request) {
  if (req.method !== "POST") return;

  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    console.error("Invalid Content-Type: ", contentType);
    throw new Error("invalid_content_type");
  }
}

// 5. Body function.
function validateWaitlistBody(
  raw: any,
): WaitlistSignupRequestBody & { ref?: string } {
  if (!raw || typeof raw !== "object") {
    console.error("Invalid body, not an object.");
    throw new Error("Invalid_body");
  }

  const full_name =
    typeof raw.full_name === "string" ? raw.full_name.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const brand_name =
    typeof raw.brand_name === "string" ? raw.brand_name.trim() : undefined;
  const ref = typeof raw.ref === "string" ? raw.ref.trim() : undefined;

  // Required fields.
  if (!full_name) {
    console.error("Full name is required.");
    throw new Error("Full_name field is required.");
  }

  if (!email) {
    console.error("Email is required");
    throw new Error("Email field is required.");
  }

  // Length checks.
  if (full_name.length > 35) {
    console.error("Full name cannot be more than 35 characters.");
    throw new Error("Full_name exceeds 35 chars.");
  }
  if (email.length > 50) {
    console.error("Email cannot be more than 50 characters.");
    throw new Error("Email exceeds 50 chars.");
  }
  if (brand_name && brand_name.length > 50) {
    console.error("Brand name cannot be more than 50 characters.");
    throw new Error("Brand_name exceeds 50 chars.");
  }

  // Email format check.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error("Invalid email format: ", email);
    throw new Error("Invalid_email_format");
  }

  return { full_name, email, brand_name, ref };
}

// MAIN HANDLER.
serve(async (req) => {
  // 1. CORS + Method handling.
  const corsResponse = validateCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  // 2. Identifying client.
  const ip =
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const endpoint = "join-waitlist";

  // 3. Rate limit handling.
  const allowed = await checkRateLimit(ip, endpoint);
  if (!allowed) {
    return new Response(
      JSON.stringify({
        error: "rate_limit_exceeded",
        message: "Too many requests. Please try again after 2 minutes.🙏🏿",
      }),
      {
        status: 429,
        headers: corsHeaders,
      },
    );
  }

  // 4. Core logic.
  try {
    // 4a. Headers validation.
    validateHeaders(req);

    // 4b. Parse JSON body.
    const rawBody = await req.json();

    // 4c. Body validation.
    const { full_name, email, brand_name, ref } = validateWaitlistBody(rawBody);

    // 4d. DB insertion – get referral_code back.
    const { data, error: insertError } = await supabase
      .from("waitlist_signups")
      .insert({
        full_name,
        email,
        brand_name,
        referred_by: ref ?? null,
      })
      .select("referral_code")
      .single();

    if (insertError) {
      console.error("DB insertion error: ", insertError);

      if (
        typeof insertError.message === "string" &&
        insertError.message.toLowerCase().includes("duplicate")
      ) {
        return new Response(
          JSON.stringify({
            error: "duplicate_entry",
            message:
              "This email is already on the waitlist. If you did not get an email, please check your spam or promotions folder in your email or try again later or best still contact support.",
          }),
          {
            status: 409,
            headers: corsHeaders,
          },
        );
      }

      return new Response(
        JSON.stringify({
          error: "db_error",
          message:
            "Could not join the waitlist rn. Please do try again later.🙏🏿",
        }),
        {
          status: 500,
          headers: corsHeaders,
        },
      );
    }

    // 4e. Increment referrer's count if ref present.
    if (ref) {
      const { data: refUser, error: refSelectError } = await supabase
        .from("waitlist_signups")
        .select("referral_count")
        .eq("referral_code", ref)
        .single();

      if (!refSelectError && refUser) {
        const { error: refUpdateError } = await supabase
          .from("waitlist_signups")
          .update({
            referral_count: (refUser.referral_count ?? 0) + 1,
          })
          .eq("referral_code", ref);

        if (refUpdateError) {
          console.error("Error incrementing referral_count: ", refUpdateError);
        }
      } else if (refSelectError) {
        console.error(
          "Error selecting referrer for referral_count: ",
          refSelectError,
        );
      }
    }

    // 4f. Build referral link for this user.
    const referralLink = `https://serveqrew.org?ref=${data.referral_code}`;

    // 4g. Generate Supabase magic link for this email.
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          redirectTo: "https://app.serveqrew.org/dashboard",
        },
      });

      if (linkError || !linkData) {
        console.error ("Error generating magic link: ", linkError);
        throw new Error ("magic_link_error");
      }

    const magicLinkUrl = linkData.properties.action_link; // Supabase’s ready-to-use magic link.

    // 4h. Send confirmation email (welcome + referral + magic link).
    try {
      await resend.emails.send({
        from: "Ebube from Serveqrew <notifications@serveqrew.org>",
        to: email,
        subject: "You’re on the Serveqrew waitlist",
        html: `
          <p>Wassup ${full_name}?</p>
          <p>Thanks for joining the Serveqrew waitlist. We’re really really glad to have you on board.</p>
          <p>Here’s your referral link:</p>
          <p><a href="${referralLink}">${referralLink}</a></p>
          <p>Share it with friends to move up the list.</p>
          <p>When you’re ready to access your Serveqrew dashboard, use this magic link:</p>
          <p><a href="${magicLinkUrl}">Open your Serveqrew dashboard</a></p>
          <p>If the button doesn’t work, copy and paste this link into your browser:</p>
          <p>${magicLinkUrl}</p>
          <p>
            To be sure you don’t miss any updates, add
            <strong>notifications@serveqrew.org</strong> to your contacts
            or move this email to your Primary tab.
          </p>
        `,
       text: `
Wassup ${full_name}?

Thanks for joining the Serveqrew waitlist. We’re really glad to have you on board.

Here’s your referral link:
${referralLink}
Share it with friends to move up the list.

When you’re ready to access your Serveqrew dashboard, use this magic link:
${magicLinkUrl}

If the button doesn’t work, copy and paste that link into your browser.

To be sure you don’t miss any updates, add notifications@serveqrew.org to your contacts.
`.trim(),

      });
    } catch (error: any) {
      console.error("Error sending waitlist confirmation email:", error);

      if (
        error?.status === 429 &&
        (error?.name === "daily_quota_exceeded" ||
          error?.code === "daily_quota_exceeded" ||
          error?.message?.includes("daily email quota"))
      ) {
        // Let outer catch handle this.
        throw new Error("email_quota_exceeded");
      }
// any other resend failure: hard fail.
      throw new Error ("email_send_failed")

    }

    // 4i. Success response.
    return new Response(
      JSON.stringify({
        message:
          "You have successfully joined the waitlist🤓. A confirmation email with your referral and dashboard link has been sent to you.🫶",
      }),
      {
        status: 201,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    console.error("Waitlist signup error: ", error);

    if (error instanceof Error && error.message === "invalid_content_type") {
      return new Response(
        JSON.stringify({
          error: "invalid_content_type",
          message: "Content-Type must be application/json.",
        }),
        {
          status: 415,
          headers: corsHeaders,
        },
      );
    }

    if (
      error instanceof Error &&
      (error.message.startsWith("Full_") ||
        error.message.startsWith("Email") ||
        error.message.startsWith("Brand_"))
    ) {
      return new Response(
        JSON.stringify({
          error: "invalid_request_body",
          message: "Full name, email, or brand name field is invalid.",
        }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    if (error instanceof Error && error.message === "Invalid_email_format") {
      return new Response(
        JSON.stringify({
          error: "invalid_email",
          message:
            "Sorry buh your Email address is not real or valid, please do well to input a valid one.",
        }),
        {
          status: 422,
          headers: corsHeaders,
        },
      );
    }

    if (error instanceof Error && error.message === "magic_link_error") {
      return new Response (
        JSON.stringify({
          error: "magic_link_error",
          message: "You have joined the waitlist buh we could not create your magic link rn. Please contact support if you did not get an email especially with a magic link in it.",        
        }), 
        {
          status: 503,
          headers: corsHeaders
        },
      );
    }

    if (error instanceof Error && error.message === "email_quota_exceeded") {
      return new Response (
        JSON.stringify ({
          error: "email_quota_exceeded",
          message: "You have joined the waitist  buh our email quota for today is full, please check after 24 hours. If you still haven't received an email contact support."
        }), 
        {
          status: 501,
          headers: corsHeaders,
        },
      );
    }

    if (error instanceof Error && error.message === "email_send_failed") {
      return new Response (
        JSON.stringify ({
          error: "email_send_failed",
          message: "You have joined the waitlist buh we couldn't send your confirmation email rn. Please contact support to fix this issue."
        }),
        {
          status: 502,
          headers: corsHeaders
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: "internal_server_error",
        message: "An internal server error occured, please try again later.🙏🏿",
      }),
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
