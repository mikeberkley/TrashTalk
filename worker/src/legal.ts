import { offer, offerPrice } from "../../packages/contracts/src/generation";
const contact = '<a href="mailto:mike@earthly.art">mike@earthly.art</a>';
const navigation =
  '<nav aria-label="Footer"><a href="/">TrashTalk</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="mailto:mike@earthly.art">Contact</a></nav>';
function page(title: string, content: string) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${title} for TrashTalk, operated by Mike Berkley."><title>${title} · TrashTalk</title><style>html{color-scheme:dark}body{margin:0;background:#101318;color:#f2f4f7;font:17px/1.7 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:32px 22px 64px}a{color:#ccff66;text-underline-offset:4px}a:focus-visible{outline:3px solid #ccff66;outline-offset:5px}h1{font-size:clamp(30px,6vw,44px);line-height:1.15}h2{font-size:23px;margin-top:32px;line-height:1.3}p,li{overflow-wrap:anywhere}li{margin:8px 0}.meta{color:#b7bec9}nav{display:flex;flex-wrap:wrap;gap:12px 24px;border-top:1px solid #46505c;margin-top:40px;padding-top:20px}.brand{font-weight:800;text-decoration:none;font-size:20px}</style></head><body><main><a class="brand" href="/">TRASHTALK ↗</a><h1>${title}</h1>${content}${navigation}</main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    },
  );
}
export function publicPage(path: string): Response | null {
  if (path === "/privacy")
    return page(
      "Privacy Policy",
      `
<p class="meta">Effective October 12, 2026</p>
<p>TrashTalk is operated by Mike Berkley (“we,” “us”). This policy explains how we handle information when you use trashtalk.fanlift.ai and its preview app to create sports memes. Contact ${contact} with privacy questions or requests.</p>
<h2>Information we collect</h2>
<ul><li><strong>Account and session information.</strong> We assign an anonymous account identifier and use a necessary session cookie. When you sign in with Google, we receive and verify a Google identity token and store its unique account identifier to link your images and credits across visits. The token may contain basic profile information, but our account database does not store your Google name, email or profile photo. We do not receive your Google password or request access to Gmail, Drive, contacts or calendars.</li>
<li><strong>Your content.</strong> We process your selected game and team, optional word, uploaded reference photo, generated captions and images, research context, and generation status. Photos can contain people, pets and other information you choose to supply.</li>
<li><strong>Purchases.</strong> Stripe handles checkout and payment details. We store purchase identifiers, amount, status, credit balances and accounting entries. Our app does not receive or store your full card number or security code. Stripe may collect billing and contact details directly.</li>
<li><strong>Technical and support information.</strong> Our hosting and service providers process network details such as IP addresses and request information to deliver and secure the service. The app uses a date-scoped hash of an IP address for some abuse controls. Hashing is not a guarantee of anonymity. We also process error and job records and information you send when contacting us.</li></ul>
<h2>How we use information</h2>
<p>We use information to sign you in, create and deliver requested memes, maintain your private history, publish images you choose to share, process purchases, account for credits, recover interrupted jobs, respond to support requests, prevent misuse, and meet applicable legal obligations.</p>
<h2>AI processing and service providers</h2>
<p>We use Cloudflare for hosting, storage, databases, image processing and background jobs; Google for sign-in; Stripe for payments; and OpenRouter to route caption and image requests to AI model providers, currently xAI. Your optional word, relevant game context and caption instructions are processed by the AI services. Your uploaded photo is sent through OpenRouter to the image model provider for the generation you request. Uploaded photo bytes are not sent to the separate sports-research or caption-generation steps. Sports research can use a web-search provider, currently Exa, through OpenRouter.</p>
<p>These providers process data under their applicable terms and privacy policies and may process it in countries other than yours. We do not promise that all providers have zero retention or that all submitted content is excluded from provider training; treatment can depend on the provider and request configuration. Avoid uploading sensitive documents or information you do not want processed by these services.</p>
<p>We do not sell personal information or use your uploads for targeted advertising. We do not operate our own model-training program using your uploads. We may disclose information when reasonably necessary to comply with law, protect people or the service, or respond to a lawful request.</p>
<h2>Private history and public sharing</h2>
<p>Uploads and generated history are private to your app session or signed-in account by default. Pressing Share publishes a page containing the finished image, caption and game information. Anyone with the link can view or redistribute that page, and it may be indexed. A generated image may visibly include the person or pet from your reference photo. We do not publish the original uploaded file through the share page. Downloaded or shared copies held by other people are outside our control.</p>
<h2>Cookies and browser storage</h2>
<p>A necessary, secure session cookie lasts up to 30 days. Browser session storage preserves selections and active-job information. Google sign-in and Stripe checkout may use their own cookies or similar technologies under their policies. Blocking necessary storage may prevent sign-in, private history or checkout from working. We count public page views and use a first-party visitor cookie lasting up to 90 days to estimate unique browsers. Hashed visitor identifiers are retained for 90 days; aggregate daily page counts are retained longer. These counts may include bots and repeat visits. The app does not include advertising trackers.</p>
<h2>Retention and deletion</h2>
<p>Our cleanup process is designed to remove unattached uploads after 24 hours and uploads attached to generation jobs after seven days from attachment. Deletion occurs during scheduled cleanup and may be delayed by outages. This cleanup does not delete generated images. Generated images, job history, account identifiers, share links and credit records currently have no automatic deletion deadline. We retain them to provide history, account continuity, accounting and support. Provider logs and backups may follow different retention periods.</p>
<p>You can remove an unused upload through the app. To request access, correction, account deletion, deletion of generated content or removal of a public share link, contact ${contact}. There is currently no self-service account-deletion button. We may ask for information needed to verify ownership; never send your password or card details. We may retain records needed for security, accounting, disputes or legal obligations and explain applicable limitations. Removing information from our service cannot recall copies already downloaded or shared elsewhere.</p>
<h2>Your choices and rights</h2>
<p>Uploading a photo is optional. You can use the free trial without Google sign-in; sign-in is required for purchases. Depending on where you live, applicable law may give you rights to access, correct, delete or obtain a copy of your information, object to certain processing, or complain to a privacy regulator. Contact us to exercise applicable rights. We will handle requests under the law that applies to you.</p>
<h2>Age and security</h2>
<p>TrashTalk is intended for adults aged 18 and over and is not directed to children. Do not upload photos of children. If you believe a child has provided personal information, contact us. We use access controls, secure transport and private storage to protect information, but no system can guarantee complete security.</p>
<h2>Changes and contact</h2>
<p>We may update this policy and will change its effective date. Material changes will receive additional notice when required by law. Questions and requests: Mike Berkley, ${contact}.</p>`,
    );
  if (path === "/terms")
    return page(
      "Terms of Service",
      `
<p class="meta">Effective October 12, 2026</p>
<p>These terms govern your use of TrashTalk at trashtalk.fanlift.ai and its preview app, operated by Mike Berkley (“we,” “us”). By using the service, you agree to these terms. If you do not agree, do not use the service. Contact ${contact} with questions. Our <a href="/privacy">Privacy Policy</a> explains our data practices.</p>
<h2>The service and eligibility</h2>
<p>TrashTalk creates AI-generated sports comedy from a selected game and participating team, an optional word, and up to one optional reference photo. You must be at least 18 and able to enter a binding agreement to use it. Keep your account and devices secure. You are responsible for activity you authorize and must not bypass trial limits, security measures or payment controls.</p>
<h2>Credits and payments</h2>
<p>The free trial includes three successful generations. Additional packs currently cost ${offerPrice} USD for ${offer.credits} image credits. Purchases are one-time payments, not subscriptions, and may be repeated. Checkout displays the amount due before you pay. Google sign-in is required for purchases. Purchased credits do not expire, are tied to your account, are not transferable and have no cash value except where a refund is required by law or approved by us.</p>
<p>One credit is used when a generation successfully completes and the image is stored. A credit may be temporarily reserved while work is in progress. Failed jobs release their reservation; an uncertain provider response may require an explicit retry. A successfully delivered image uses a credit even if you dislike its style or the model alters text, likeness or branding. This does not limit rights or remedies you have under applicable law. Prices for future purchases may change; existing paid credits retain their generation value.</p>
<h2>Refunds and payment issues</h2>
<p>For duplicate charges, missing credits, service failures or refund requests, contact ${contact} with the approximate purchase date and receipt or session identifier. Do not send card details. We review requests individually and honor applicable mandatory refund and consumer rights. Approved refunds can remove unused credits associated with the refunded purchase. Refunds or disputes involving spent credits may require account review. The app does not offer automatic self-service refunds. Preview payments using Stripe test mode do not move real money or create production credits.</p>
<h2>Your uploads and permitted use</h2>
<p>You retain any rights you have in your uploads. You give us and our service providers permission to process, store, transform and transmit them as needed to provide the service, and to display finished content publicly when you choose to share it. You must have the necessary rights and permissions for your uploads, including permission from identifiable people shown. Do not upload photos of children or confidential or sensitive records.</p>
<p>Do not use TrashTalk for unlawful activity, threats, targeted harassment, hateful abuse, sexual exploitation, deceptive impersonation, fraudulent endorsements, privacy violations or infringement of another person’s rights. Do not present generated scenes as documentary evidence of real events. Do not attack, scrape abusively, reverse engineer access controls, or interfere with the service. We may refuse requests or restrict accounts to address misuse, payment disputes or security concerns.</p>
<h2>AI output and sports information</h2>
<p>Generated scenes are fictional sports comedy. AI can make mistakes, produce offensive material, change words, misrepresent logos or likenesses, or produce similar output for different users. Sports feeds and research may be delayed or inaccurate. Review an image before sharing it. We do not guarantee a particular creative result, exact lettering, accurate logo reproduction, uniqueness, copyright protection or clearance of third-party rights.</p>
<p>You may download and share your generated images subject to these terms and applicable third-party rights. We do not claim ownership of your original uploads or any rights in generated output that belong to you. Team names, logos and other marks belong to their respective owners. TrashTalk is not affiliated with or endorsed by the leagues, teams, athletes or data providers depicted or mentioned. No trademark or other third-party license is granted by these terms.</p>
<h2>Sharing and availability</h2>
<p>Choosing Share creates a public link. Others can save or redistribute the finished image; deleting our copy cannot recall theirs. Contact us to request removal of a share page. Keep copies of images you want to retain. We may maintain, update, suspend or discontinue parts of the service. If a permanent shutdown prevents use of unused paid credits, contact us for resolution consistent with applicable law.</p>
<h2>Disclaimers and responsibility</h2>
<p>To the extent permitted by applicable law, the service is provided “as is” and “as available,” without promises of uninterrupted availability, fitness for a particular purpose or error-free results. We are not responsible for third-party outages or for how others use content you make public, except where applicable law provides otherwise. Nothing in these terms excludes liability or limits consumer rights that cannot lawfully be excluded or limited.</p>
<h2>Changes and contact</h2>
<p>We may revise these terms for changes to the service, prices for future purchases or legal requirements. We will update the effective date and give additional notice of material changes when required. Changes do not remove mandatory rights or retroactively change completed purchase prices. Questions, support and rights complaints: Mike Berkley, ${contact}.</p>`,
    );
  return null;
}
export function launchPage() {
  return page(
    "Sports rivalry. Made personal.",
    `<p>TrashTalk turns your team loyalty into an AI-generated sports meme. Choose a game, pick your side, add an optional word or photo, and generate a fictional roast to download or share.</p><p>We’re getting ready for kickoff. The app is not yet open for purchases or generation.</p><p>At launch: three free successful generations, then ${offerPrice} USD for ${offer.credits} image credits. No subscription. Google sign-in connects your private history and purchased credits.</p><p>Operated by Mike Berkley. Support and privacy requests: ${contact}.</p>`,
  );
}
