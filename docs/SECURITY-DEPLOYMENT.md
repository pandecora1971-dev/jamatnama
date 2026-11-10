> বর্তমান Vercel + Supabase + R2 ডিপ্লয়মেন্টের ধাপ: [DEPLOYMENT.md](DEPLOYMENT.md)। নিচের SQLite, SSE ও একক সার্ভার-সংক্রান্ত অংশ পুরোনো ব্যবস্থার জন্য; মালিকানা, origin ও AI বিষয়ক পরামর্শ এখনও প্রাসঙ্গিক।

# JAMATNAMA: নিরাপদে লাইভ করার প্রস্তুতি

এই প্রজেক্ট বর্তমানে একটি Node.js অ্যাপ, এক SQLite ডেটাবেস ও ব্যক্তিগত প্রমাণ সংরক্ষণের জন্য প্রস্তুত। ডোমেইন বা সার্ভার কেনা হয়নি, কোনো বাইরের অ্যাকাউন্ট কনফিগার করা হয়নি। এটি ১০,০০০ সমসাময়িক ব্যবহারকারী বা DDoS প্রতিরোধের পরীক্ষিত নিশ্চয়তা নয়।

## অ্যাপের মধ্যে যা আছে

- লগইনে প্রতি signed browser cookie-তে ১৫ মিনিটে ৫টি চেষ্টা, সব মিলিয়ে ৩০টি। সীমা ছাড়ালে 429 ও Retry-After। cookie মুছে সীমা এড়ানোর চেষ্টা global সীমায় পড়বে; distributed attack-এর জন্য edge protection প্রয়োজন। এখানে IP বা browser fingerprint দিয়ে কাউন্টার রাখা হয় না।
- অ্যাসিঙ্ক্রোনাস scrypt ও একই সময়ে সর্বোচ্চ ২টি password check। পাসওয়ার্ড ও OTP ভুলের জন্য একই বার্তা।
- TOTP authenticator এবং সফল কোড একবার ব্যবহারের নিয়ম। production-এ TOTP ছাড়া লগইন চালু হবে না।
- সার্ভারে শুধু session token-এর hash; মেয়াদ এক ঘণ্টা। লগআউট হলে token বাতিল। password/TOTP/session-secret বদলালে পুরোনো সেশন অকার্যকর।
- রিপোর্ট জমার শুরুতেই browser/global rate limit, একই সময়ে সর্বোচ্চ ৩টি upload processing। JSON body ও multipart body-র আকার ও পড়ার সময় সীমিত।
- একবারের signed form challenge ও production-এ Turnstile server validation। hostname ও action মিলতে হবে; provider ব্যর্থ হলে sensitive action অনুমোদিত হয় না। Turnstile-এ রিপোর্ট, প্রমাণ বা অভিযুক্তের তথ্য পাঠানো হয় না। browser widget-এর জন্য Cloudflare দর্শকের নেটওয়ার্ক-সংক্রান্ত তথ্য পেতে পারে।
- ফাইল সর্বোচ্চ ৩টি, প্রতিটি ৫ MB; মোট multipart ১৬ MB। ছবি পুনরায় encode হয়। PDF/audio-তে metadata/পরিচয় থাকতে পারে; malware scanner এখনও নেই।
- রিপোর্ট প্রথমে pending। সম্ভাব্য ফোন/ইমেইল, পুনরাবৃত্তি ও অতিরিক্ত লিংক private review hint হয়; এগুলো সত্যতা নির্ধারণ বা স্বয়ংক্রিয় প্রকাশ করে না।
- public report cache শুধুমাত্র public তথ্য রাখে; revision পরিবর্তনে invalidation হয়। live clients একই poller ব্যবহার করে; প্রতি process-এ সর্বোচ্চ ২৫০টি SSE connection, বাকিরা polling fallback পায়। এটি মোট visitor সংখ্যা নয়।

## লাইভ করার আগে

1. প্রকৃত ডোমেইন ঠিক করে `.env.local` বা hosting secret store-এ PUBLIC_ORIGIN দিন, যেমন `https://example.com` (শেষে slash নয়)।
2. `npm run admin:setup` দিয়ে admin credentials তৈরি করুন। `npm run admin:2fa` চালিয়ে নিজের authenticator-এ private setup key যোগ করে বর্তমান ৬-সংখ্যার কোড দিয়ে activation করুন। enrollment ফাইল প্রকাশ বা অনলাইন QR সাইটে দেবেন না। activation শেষ না হওয়া পর্যন্ত config বদলায় না।
3. Cloudflare Turnstile-এ নিজ ডোমেইনে সীমাবদ্ধ widget তৈরি করে TURNSTILE_SITE_KEY ও TURNSTILE_SECRET_KEY বসান। test key production-এ দেবেন না। এখানে widget challenge server-side যাচাই হয়; private reports বাইরে পাঠানো হয় না।
4. COOKIE_SECURE=true এবং অন্তত ৩২ অক্ষরের random SESSION_SECRET রাখুন। encrypted backup আলাদা restricted জায়গায় রাখুন। secrets Git-এ বা এই চ্যাটে দেবেন না।
5. তারপর `npm run build` এবং `npm start`। Docker-ও একই configuration যাচাই করে; অসম্পূর্ণ production config-এ process বন্ধ হবে। Local preview: `npm run dev`।
6. deployment host-এ storage encryption at rest, SSH key access, unattended security updates ও encrypted backup রাখুন। SQLite backup live database file সাধারণ copy করে নয়—SQLite backup API/consistent snapshot দিয়ে নিন। restoration পরীক্ষা করুন। DB ও evidence BLOB অ্যাপ থেকে আলাদা encryption key দিয়ে encrypt করা হয়নি; server/disk backup encryption কনফিগার করা দরকার।
7. staging-এ bot widget, OTP, full submit/review, restore ও realistic load test শেষ করে public traffic খুলুন। multi-replica অ্যাপে এই SQLite ও process-local concurrency/SSE যথেষ্ট নয়; shared PostgreSQL/Redis/queue/object-storage প্রয়োজন হবে।

## মালিকানা ও origin-এর পরিচয় কম প্রকাশ করার ব্যবস্থা

- WHOIS/RDAP redaction সমর্থিত ডোমেইন/রেজিস্ট্রার ব্যবহার করুন। এটি public registry-র ব্যক্তিগত তথ্য আড়াল করে; registrar/registry/payment provider-এর রেকর্ড মুছে দেয় না। ভুল পরিচয় দিয়ে নিবন্ধন করবেন না।
- Cloudflare Tunnel দিয়ে origin-এ outbound connection রাখুন; app port শুধু loopback/internal network-এ রাখুন। web port Internet-এ খুলবেন না। SSH-ও private access path-এ রাখুন। পুরোনো DNS records/একই IP-র mail server origin ফাঁস করতে পারে।
- `/admin` এবং `/api/admin/*`—দুটো path Cloudflare Access allowlist + MFA দিয়ে রক্ষা করুন। public reporting paths-এ user login দেবেন না। credentials/identity provider কনফিগার করার অধিকার শুধু owner রাখবেন। Access ব্যবহারে নিজের পরিচয় admin browser/provider-এ থাকবে; সাধারণ দর্শকের কাছে দেওয়া হয় না।
- edge WAF-এ login, report submission, challenge, tracking, supports ও events-এর আলাদা rules রাখুন। upload body ১৬ MB ও connection timeout enforce করুন; origin-এ সরাসরি পৌঁছানোর পথ বন্ধ না করলে edge rules bypass হতে পারে। hosting plan অনুযায়ী rules ও quotas যাচাই করুন।
- private repository, project-specific accounts/email, least-privilege roles ও production secrets-এর সীমিত access রাখুন। developer-কে source code দিলেই cloud billing, domain account বা production DB access দিতে হয় না। তবে যাঁর পূর্ণ server/account access আছে, তাঁর কাছ থেকে মালিকানা নিশ্চিতভাবে লুকানো যাবে না।
- production browser source maps প্রকাশ করা হয়নি, X-Powered-By বন্ধ। error tracker, reverse proxy, CDN, cloud access logs-এ request body, cookies, OTP, receipt code, source URLs বা operator personal identity লগ করবেন না। access log-এ IP রাখা হলে তার retention/access আলাদাভাবে ঠিক করুন। provider-এর নিজস্ব logging policies আলাদা।

সম্পূর্ণ অজ্ঞাত পরিচয়ের নিশ্চয়তা নেই: hosting, registrar, payment, provider logs, account access, Git history ও প্রকাশিত content থেকে সংযোগ বের হতে পারে। এই প্রস্তুতি সাধারণ public exposure কমায়; provider বা পূর্ণ অবকাঠামো-অধিকার থাকা ব্যক্তির কাছে পরিচয় মুছে দেয় না।

## AI বিষয়ে সিদ্ধান্ত

Brute force ও DDoS ঠেকানোর জন্য AI প্রয়োজন নেই। প্রথমে rate limits, MFA, bot verification, edge protection ও human moderation। ভবিষ্যতে private moderation queue-তে বাংলা summary, suggested category, duplicate hints ও PII redaction suggestion যুক্ত করা যায়। সিদ্ধান্ত ও প্রকাশ মানুষের হাতে রাখুন। রিপোর্ট, audio, অভিযুক্তের তথ্য বা link কোনো external LLM-এ পাঠানোর আগে provider retention, training policy, consent ও cost budget ঠিক করুন। বর্তমানে কোনো AI API call, external transcription বা auto-publication নেই। স্থানীয় rules কেবল review hint দেখায়।

## সূত্র

- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/tunnel/
- https://developers.cloudflare.com/registrar/account-options/whois-redaction/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/
