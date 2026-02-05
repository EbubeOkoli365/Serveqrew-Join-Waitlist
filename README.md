The Join-Waitlist backend for my startup with a Frontend Engineer(dave-8bit) to better understand how production systems work and to gain experience in working in teams.
This waitlist backend was built with Supabase and Typescript, it features three production ready files, one for each user's referral dashboard, one for referral leaderboard to create competition for users and enhance the business strategy and one for the main "join-waitlist". 

**CORE FEATURES:**
Unique referral code for each user.
Real-time referral tracking.
Ranked leaderboard system.
Personalized referral dashboard.
Scalable system design.

**JOIN-WAITLIST FILE - handles the main signup logic.**
IMPORTS - Imports necessary files for usage.
CONSTANTS - declares all constants in the code including URLs, rate limiting windows, length fields, error codes, CORS headers... for future reusability.
ENVIRONMENT VARIABLES - Environment variables for security.
CLIENTS - creating clients.
INTERFACES - declaring interfaces and their types.
VALIDATION / HELPERS - handles validation of body fields, CORS, and checks for safe rate limiting without obstructing user experience.
BUSINESS LOGIC - handles business logic like email sending, referral increment... with good fail safes.
ERROR HANDLER - Checks for specific error messages and sends back user friendly responses.
MAIN HANDLER - handles database insertion, try and catch error blocks with user friendly messages, referral handling, magic links, success response.

**REFERRAL DASHBOARD FILE - handles logic for each users' personal referral dashboard.**
IMPORTS - imports necessary files.
CONSTANTS - declares all constants in the code for future reusability.
ENVIRONMENT VARIABLES - Environment variables for security.
SUPABASE CLIENT - creating Supabase clients.
MAIN HANDLER - handles authorization headers, fetches users' data like full name, email, etc from POSTGRE SQL database table and also handles try and catch block errors.

**REFERRAL LEADERBOARD FILE - allows the frontend to fetch the referral stats and names.** 
IMPORTS - Imports necessary files for usage.
CONSTANTS - declares all constants in the code for future reusability.
ENVIRONMENT VARIABLES - Environment variables for security.
MAIN HANDLER - try and catch error blocks.

**INTEGRATION:**
Good and robust error handling for better integration.
Setting of required headers like "authorization, x-client-info, etc..." for better integration.

**HOW IT WORKS**
1. A user joins the waitlist.
2. They receive a uniqure referral link.
3. Every successful invite updates:
   Their personal daashboard.
   The global leaderboard on the join-waitlist page.

**PURPOSE:**
This service was built as the foundation for Serveqrew's growth system, encouraging organic sharing and fair competition through referrals.

