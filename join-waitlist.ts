// IMPORTS
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.34.0";
import { Resend } from "https://esm.sh/resend@3.2.0";

// CONSTANTS
const CONFIG = {
  CORS_ORIGIN: "*",
  REFERRAL_BASE_URL: "https://serveqrew.org",
  DASHBOARD_URL: "https://serveqrew.org/dashboard",
  EMAIL_FROM: "Ebube from Serveqrew <notifications@serveqrew.org>",
  EMAIL_SUBJECT: "You're on the Serveqrew waitlist",
} as const;

const VALIDATION = {
  MAX_FULL_NAME_LENGTH: 50,
  MAX_EMAIL_LENGTH: 200,
  MAX_BRAND_NAME_LENGTH: 70,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const;

const RATE_LIMIT = {
  WINDOW_MS: 120_000, // 2 minutes
  MAX_REQUESTS: 5,
  ENDPOINT: "join-waitlist",
} as const;

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": CONFIG.CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
} as const;

// ENVIRONMENT VARIABLES
const ENV_VARS = {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL")!,
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  RESEND_API_KEY: Deno.env.get("RESEND_API_KEY")!,
};

// CLIENTS
const supabase = createClient(ENV_VARS.SUPABASE_URL, ENV_VARS.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(ENV_VARS.RESEND_API_KEY);

// INTERFACES
interface WaitlistSignupRequestBody {
  full_name: string;
  email: string;
  brand_name?: string;
  ref?: string;
}

// VALIDATION HELPERS
function validateEnvVars() {
  const missing = [];
  if (!ENV_VARS.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!ENV_VARS.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ENV_VARS.RESEND_API_KEY) missing.push("RESEND_API_KEY");

  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed", message: "Only POST method is allowed." }),
      { status: HTTP_STATUS.METHOD_NOT_ALLOWED, headers: CORS_HEADERS }
    );
  }

  return null;
}

async function checkRateLimit(ip: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT.WINDOW_MS).toISOString();
  
  const { count, error: selectError } = await supabase
    .from("waitlist_rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("endpoint", RATE_LIMIT.ENDPOINT)
    .gte("created_at", windowStart);

  if (selectError) {
    console.error("Rate limit check failed:", selectError);
    return true; // Fail open
  }

  if ((count ?? 0) >= RATE_LIMIT.MAX_REQUESTS) {
    return false;
  }

  const { error: insertError } = await supabase
    .from("waitlist_rate_limits")
    .insert({ ip, endpoint: RATE_LIMIT.ENDPOINT });

  if (insertError) {
    console.error("Rate limit insert failed:", insertError);
  }

  return true;
}

function validateHeaders(req: Request): void {
  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json")) {
    throw new Error("invalid_content_type");
  }
}

function validateBody(raw: unknown): WaitlistSignupRequestBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("invalid_body");
  }

  const full_name = (raw as any).full_name?.trim();
  const email = (raw as any).email?.trim();
  const brand_name = (raw as any).brand_name?.trim();
  const ref = (raw as any).ref?.trim();

  if (!full_name) throw new Error("full_name_required");
  if (!email) throw new Error("email_required");

  if (full_name.length > VALIDATION.MAX_FULL_NAME_LENGTH) throw new Error("full_name_too_long");
  if (email.length > VALIDATION.MAX_EMAIL_LENGTH) throw new Error("email_too_long");
  if (brand_name && brand_name.length > VALIDATION.MAX_BRAND_NAME_LENGTH) {
    throw new Error("brand_name_too_long");
  }

  if (!VALIDATION.EMAIL_REGEX.test(email)) {
    throw new Error("invalid_email_format");
  }

  return { full_name, email, brand_name, ref };
}

// BUSINESS LOGIC
async function handleReferralIncrement(refCode: string | undefined): Promise<void> {
  if (!refCode) return;

  const { data: referrer, error: selectError } = await supabase
    .from("waitlist_signups")
    .select("referral_count")
    .eq("referral_code", refCode)
    .single();

  if (selectError || !referrer) {
    console.error("Referrer lookup failed:", selectError);
    return;
  }

  const { error: updateError } = await supabase
    .from("waitlist_signups")
    .update({ referral_count: (referrer.referral_count ?? 0) + 1 })
    .eq("referral_code", refCode);

  if (updateError) {
    console.error("Referral count update failed:", updateError);
  }
}

async function sendConfirmationEmail(
  fullName: string,
  email: string,
  referralLink: string,
  magicLink: string
): Promise<void> {
  await resend.emails.send({
    from: CONFIG.EMAIL_FROM,
    to: email,
    subject: CONFIG.EMAIL_SUBJECT,
    html: `
      <p>Wassup ${fullName}?</p>
      <p>Thanks for joining the Serveqrew waitlist. We're really glad to have you on board.</p>
      <p>Here's your referral link:</p>
      <p><a href="${referralLink}">${referralLink}</a></p>
      <p>Share it with friends to move up the list.</p>
      <p>Click the link below to go to your Serveqrew referral dashboard now. </p>
      
      <p> ⚠️SECURITY NOTE: Serveqrew uses short-time magic links for your information protection. After leaving/exiting dashboard, request a fresh link by logging in on the join-waitlist page to re-enter your referral dashboard page or simply click the link below to get back to the waitlist home page if your dashboard session hasn't expired.
The name you previously used can be different (for those who won't remember the previous name they used) but the email has to be the same. </p>
 </p>
      <p><a href="${magicLink}">Open your Serveqrew dashboard</a></p>
    `,
    text: `
Wassup ${fullName}?

Thanks for joining the Serveqrew waitlist.

Here's your referral link: ${referralLink}
Share it with friends to move up the list.

Click the link below to go to your Serveqrew referral dashboard now.

⚠️SECURITY NOTE: Serveqrew uses short-time magic links for your information protection. After leaving/exiting dashboard, request a fresh link by logging in on the join-waitlist page to re-enter your referral dashboard page or simply click the link below to get back to the waitlist home page if your dashboard session has expired.
The name you previously used can be different (for those who won't remember the previous name they used) but the email has to be the same.
${magicLink}

To be sure you don't miss any updates and also to ensure our emails don't hit spam, add notifications@serveqrew.org to your contacts.
    `.trim(),
  });
}

// ERROR HANDLER
function handleError(error: unknown, headers: HeadersInit = CORS_HEADERS): Response {
  console.error("Waitlist signup error:", error);

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Content type
    if (msg === "invalid_content_type") {
      return new Response(
        JSON.stringify({ error: "invalid_content_type", message: "Content-Type must be application/json" }),
        { status: 415, headers }
      );
    }

    // Validation errors
    if (msg.includes("required")) {
      const field = msg.includes("full_name") ? "Full Name" : 
                    msg.includes("email") ? "Email" : "Field";
      return new Response(
        JSON.stringify({ error: "missing_field", message: `${field} is required`, field: field.toLowerCase() }),
        { status: HTTP_STATUS.BAD_REQUEST, headers }
      );
    }

    if (msg.includes("too_long")) {
      const field = msg.includes("full_name") ? "Full Name" : 
                    msg.includes("email") ? "Email" : "Brand Name";
      return new Response(
        JSON.stringify({ error: "field_too_long", message: `${field} is too long. Please shorten it.`, field: field.toLowerCase() }),
        { status: HTTP_STATUS.BAD_REQUEST, headers }
      );
    }

    if (msg === "invalid_email_format") {
      return new Response(
        JSON.stringify({ error: "invalid_email", message: "Please enter a valid email address." }),
        { status: HTTP_STATUS.UNPROCESSABLE_ENTITY, headers }
      );
    }

    // Specific business errors
    switch (error.message) {
      case "magic_link_error":
        return new Response(
          JSON.stringify({
            error: "magic_link_error",
            message: "Joined waitlist but magic link failed. Check your email or contact support."
          }),
          { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers }
        );
      case "email_quota_exceeded":
        return new Response(
          JSON.stringify({
            error: "email_quota_exceeded",
            message: "Joined waitlist but daily email quota reached. Check back in 24 hours."
          }),
          { status: HTTP_STATUS.NOT_IMPLEMENTED, headers }
        );
      case "email_send_failed":
        return new Response(
          JSON.stringify({
            error: "email_send_failed",
            message: "Joined waitlist but email failed. Please contact support."
          }),
          { status: HTTP_STATUS.BAD_GATEWAY, headers }
        );
    }
  }

  return new Response(
    JSON.stringify({ error: "internal_server_error", message: "Something went wrong. Please try again later." }),
    { status: HTTP_STATUS.INTERNAL_SERVER_ERROR, headers }
  );
}

// MAIN HANDLER
validateEnvVars();

serve(async (req) => {
  // CORS & Method validation
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Rate limiting
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
  const rateLimitOk = await checkRateLimit(ip);
  
  if (!rateLimitOk) {
    return new Response(
      JSON.stringify({
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait 2 minutes."
      }),
      { status: HTTP_STATUS.TOO_MANY_REQUESTS, headers: CORS_HEADERS }
    );
  }

  try {
    // Request validation
    validateHeaders(req);
    const body = validateBody(await req.json());

    // Database operations.
    // Checking if user exists.
    const {data: existingProfile} = await supabase
    .from ("waitlist_signups")
    .select ("referral_code")
    .eq ("email", body.email)
    .single();

    if (existingProfile) {
      // Existing user => resend magic link.
      const referralLink = `${CONFIG.REFERRAL_BASE_URL}?ref=${existingProfile.referral_code}`;
      const {data: linkData} = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: body.email,
        options: {redirectTo: CONFIG.DASHBOARD_URL}
      });

      if (!linkData?.properties?.action_link) {
        throw new Error ("Failed to generate magic link.")
      }

      await resend.emails.send({
        from: "Serveqrew <notifications@serveqrew.org>",
        to: body.email,
        subject: "Access Your Dashboard.",
        html: `
        <h2> Welcome back!</h2>   
        <p>Click to access your referral dashboard:</p>
        <a href="${linkData.properties.action_link}"
        style="background: #10b981; color: white; padding: 16px 32px;
        text-decoration: none; border-radius: 8px; font-weight: 600;">
        Open dashboard (${existingProfile.referral_count || 0} referrals)
        </a>
        `
      })

      return new Response (
        JSON.stringify ({
          message: "Dashboard magic link has been sent to your email."
        }),
        {
          status: HTTP_STATUS.OK,
          headers: CORS_HEADERS
        }
      );
    }

    // New user = insert + magic link.
    const { data, error: insertError } = await supabase
      .from("waitlist_signups")
      .insert({ full_name: body.full_name, email: body.email, brand_name: body.brand_name, referred_by: body.ref ?? null })
      .select("referral_code")
      .single();

    if (insertError) {
      console.error("DB insert error:", insertError);
      
      if (insertError.message.toLowerCase().includes("duplicate")) {
        return new Response(
          JSON.stringify({
            error: "duplicate_entry",
            message: "This email is already on the waitlist. Check your spam folder."
          }),
          { status: HTTP_STATUS.CONFLICT, headers: CORS_HEADERS }
        );
      }
      
      throw insertError;
    }

    // Referral handling
    await handleReferralIncrement(body.ref);

    // Generate links
    const referralLink = `${CONFIG.REFERRAL_BASE_URL}?ref=${data.referral_code}`;
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: body.email,
      options: { redirectTo: CONFIG.DASHBOARD_URL }
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("Magic link error:", linkError);
      throw new Error("magic_link_error");
    }

    // Send email
    try {
      await sendConfirmationEmail(body.full_name, body.email, referralLink, linkData.properties.action_link);
    } catch (emailError: any) {
      console.error("Email error:", emailError);
      
      if (emailError?.status === 429 || 
          emailError?.message?.includes("quota") || 
          emailError?.code === "daily_quota_exceeded") {
        throw new Error("email_quota_exceeded");
      }
      throw new Error("email_send_failed");
    }

    // Success
    return new Response(
      JSON.stringify({
        message: "Successfully joined waitlist! Check your email for confirmation, might take some minutes before you receive it."
      }),
      { status: HTTP_STATUS.CREATED, headers: CORS_HEADERS }
    );

  } catch (error) {
    return handleError(error, CORS_HEADERS);
  }
});
