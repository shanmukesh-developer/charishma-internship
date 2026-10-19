/**
 * Public legal pages (Google Play Console: Privacy policy URL + Account deletion URL, and C4 compliance).
 *   GET /legal                        index of every policy
 *   GET /legal/terms                  Terms of Service
 *   GET /legal/privacy                Privacy Policy (the Play listing URL; keep it)
 *   GET /legal/refunds                Cancellation & Refund Policy
 *   GET /legal/grievance              Grievance redressal (officer + process)
 *   GET /legal/community-guidelines   Community Guidelines
 *   GET /legal/delete-account         How to delete your account
 *
 * Server-rendered HTML: no scripts, no trackers, no cookies, no external fonts. Business / grievance
 * details, version and effective date come from GlobalConfig LEGAL_SETTINGS (admin Config → Legal); the
 * numbers (cancel windows, refund %, retention days) come from the same settings and env the code enforces
 * (utils/legalFacts.js). Nothing is invented: a missing value is shown as "will be published here".
 */
const express = require('express');
const { gather } = require('../utils/legalFacts');

const router = express.Router();

const esc = (v) => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escMultiline = (v) => esc(v).replace(/\r?\n/g, '<br>');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : esc(ymd);
};
const mail = (addr, subject) => `<a href="mailto:${esc(addr)}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}">${esc(addr)}</a>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hours = (h) => (h % 24 === 0 && h >= 24 ? plural(h / 24, 'day') : plural(h, 'hour'));

const NAV = [
  ['/legal/terms', 'Terms of Service'],
  ['/legal/privacy', 'Privacy Policy'],
  ['/legal/refunds', 'Cancellation & Refunds'],
  ['/legal/grievance', 'Grievance Redressal'],
  ['/legal/community-guidelines', 'Community Guidelines'],
  ['/legal/delete-account', 'Delete your account'],
];

const page = (f, title, body, { showVersion = true } = {}) => {
  const s = f.settings;
  const biz = esc(s.businessName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>${esc(title)} - ${biz}</title>
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#1a1a1a; --muted:#5b5b5b; --line:#e3e3e3; --accent:#8a6d1f; --warn:#8a4b00; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f0f10; --fg:#ececec; --muted:#a8a8a8; --line:#2a2a2c; --accent:#d8b65c; --warn:#f0b35a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.6 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; overflow-wrap: anywhere; }
  h1 { font-size: 1.6rem; line-height:1.25; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 28px 0 8px; padding-top: 12px; border-top: 1px solid var(--line); }
  h3 { font-size: 1rem; margin: 18px 0 6px; }
  p, li { margin: 6px 0; }
  ul, ol { padding-left: 22px; }
  .muted { color: var(--muted); font-size: .9rem; }
  a { color: var(--accent); }
  table { width:100%; border-collapse: collapse; font-size:.92rem; }
  th, td { text-align:left; vertical-align: top; padding: 8px 6px; border-bottom: 1px solid var(--line); }
  .box { border:1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 14px 0; }
  .pending { color: var(--warn); }
  nav.legal { margin-top: 36px; padding-top: 12px; border-top: 1px solid var(--line); font-size: .9rem; }
  nav.legal a { display: inline-block; margin: 2px 12px 2px 0; }
</style>
</head>
<body><main>
${showVersion ? `<p class="muted">${biz} · Version ${esc(s.policyVersion)} · Effective ${fmtDate(s.effectiveDate)}</p>` : ''}
${body}
<nav class="legal" aria-label="Legal">
<a href="/legal">All policies</a>${NAV.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('')}
</nav>
<p class="muted">${biz} (package com.srm.hostelbites) · Contact: ${mail(s.contactEmail)}</p>
</main></body>
</html>`;
};

const operatorLine = (s) => {
  const parts = [];
  if (s.operatorName) parts.push(`${esc(s.businessName)} is operated by ${esc(s.operatorName)} ("we", "us").`);
  else parts.push(`${esc(s.businessName)} ("we", "us").`);
  if (s.registeredAddress) parts.push(`Address: ${escMultiline(s.registeredAddress)}.`);
  parts.push(`Contact: ${mail(s.contactEmail)}.`);
  return parts.join(' ');
};

/** Grievance officer block. Never invents details: incomplete -> "will be published here". */
const officerHtml = (f) => {
  const s = f.settings;
  const g = s.grievanceOfficer;
  if (!f.grievanceComplete) {
    return `<div class="box"><p><b>Grievance Officer:</b> <span class="pending">details will be published here.</span></p>
<p>Until then, send grievances to ${mail(s.contactEmail, 'Grievance')} and they will be handled under the timelines below.</p></div>`;
  }
  const addr = g.address || s.registeredAddress;
  return `<div class="box">
<p><b>Grievance Officer</b></p>
<p>${esc(g.name)}, ${esc(g.designation)}</p>
<p>Email: ${mail(g.email, 'Grievance')}</p>
${g.phone ? `<p>Phone: <a href="tel:${esc(g.phone.replace(/[\s-]/g, ''))}">${esc(g.phone)}</a></p>` : ''}
${addr ? `<p>Address: ${escMultiline(addr)}</p>` : ''}
</div>`;
};

const jurisdictionText = (s) => (s.jurisdictionCity
  ? `the courts at ${esc(s.jurisdictionCity)}, India`
  : 'the competent courts in India <span class="pending">(the city will be published here)</span>');

// ─── Index ────────────────────────────────────────────────────────────────────
const INDEX = (f) => page(f, 'Legal', `
<h1>${esc(f.settings.businessName)} policies</h1>
<p>These pages explain the rules for using ${esc(f.settings.businessName)} and how we handle your data. They apply to the Zenvy customer app and the Zenvy partner apps (Rider, Restaurant, Vendor and Auto Driver).</p>
<ul>
${NAV.map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('\n')}
</ul>
<p>Questions: ${mail(f.settings.contactEmail)}.</p>
`);

// ─── Terms of Service ─────────────────────────────────────────────────────────
const TERMS = (f) => {
  const s = f.settings;
  const biz = esc(s.businessName);
  const ar = f.autoRide;
  const o = f.orders;
  return page(f, 'Terms of Service', `
<h1>${biz} Terms of Service</h1>
<p>${operatorLine(s)}</p>
<p>These Terms are an agreement between you and us for using the ${biz} apps and website (the "Service"). By creating an account, signing in or using the Service you agree to these Terms, our <a href="/legal/privacy">Privacy Policy</a>, our <a href="/legal/refunds">Cancellation &amp; Refund Policy</a> and our <a href="/legal/community-guidelines">Community Guidelines</a>. If you do not agree, please do not use the Service.</p>

<h2>1. What ${biz} is</h2>
<p>${biz} is a campus app for college students. It lets you order food, groceries and essentials from campus stores and local vendors for delivery to your hostel, and use campus community features (chat, Pulse, Spaces, lost &amp; found, ride pooling, student vehicle rentals, shared autos and campus events). Stores, vendors, riders, auto drivers, event organizers and other students are independent of us. We provide the platform that connects you; unless a section below says otherwise, the store, driver, organizer or student you deal with is responsible for their goods and services.</p>

<h2>2. Who can use ${biz}</h2>
<ul>
<li>You must be at least 18 years old, or a college student using ${biz} with the consent of a parent or guardian, who accepts these Terms on your behalf and is responsible for your use.</li>
<li>Features marked 18+ (such as Connect) are only for users who are 18 or older.</li>
<li>You must give true information, use your own mobile number and keep only one personal account.</li>
<li>Partner accounts (riders, stores, vendors, auto drivers) are also bound by the partner rules in section 13.</li>
</ul>

<h2>3. Your account</h2>
<ul>
<li>Your mobile number is verified by an SMS code and is how you sign in. Keep your phone, codes and password private. You are responsible for activity on your account.</li>
<li>Tell us at once at ${mail(s.contactEmail)} if you think someone else is using your account.</li>
<li>You can delete your account at any time (<a href="/legal/delete-account">how</a>).</li>
</ul>

<h2>4. Orders and prices</h2>
<ul>
<li>Prices, delivery fees, discounts and the total you pay are calculated by our server when you place the order and are shown before you confirm. The amount in your order confirmation is final; prices shown earlier (for example in a cart opened some time ago) may change.</li>
<li>An order is a request to the store. The store may decline it (for example if an item is unavailable). If the store does not accept within ${plural(o.pendingTimeoutMin, 'minute')}, or no delivery partner picks it up within ${plural(o.unclaimedTimeoutMin, 'minute')} of acceptance, the order is cancelled automatically.</li>
<li>Stores are responsible for the quality, quantity, labelling, safety and legality of the goods they sell. Report a problem with an order through the app's support section.</li>
<li>Delivery times are estimates. Please be available at the delivery spot you choose.</li>
</ul>

<h2>5. Payment: cash on delivery and Zenvy Wallet</h2>
<ul>
<li>You pay for orders by <b>cash on delivery</b> or with your <b>Zenvy Wallet</b> balance. We do not take card or net-banking payments for orders. Where a store or service asks you to pay it directly (for example by UPI), you pay that store, not us.</li>
<li><b>Zenvy Wallet</b> is in-app credit, not money held for you. It is added by refunds (for example when a wallet-paid order is cancelled) and by credits we choose to give (such as support goodwill). It ${f.walletTransfers ? 'cannot be withdrawn as cash and can only be transferred where the app offers a gift feature, within its limits' : '<b>cannot be withdrawn, cashed out or transferred</b> to another person'}, it earns no interest, and it can only be used to pay for things inside ${biz}.</li>
<li>Wallet balance and reward points are forfeited when you delete your account. We may reverse credits given by mistake or obtained by fraud.</li>
<li>Reward points (zenPoints) and badges are promotional, have no cash value and may change.</li>
</ul>

<h2>6. Cancellations and refunds</h2>
<p>You can cancel a food order while the store has not accepted it, or within ${o.customerCancelSeconds / 60} minutes of placing it, as long as no delivery partner has picked it up. The full rules for every feature (orders, Auto-Ride, Campus Events, rentals) are in our <a href="/legal/refunds">Cancellation &amp; Refund Policy</a>.</p>

<h2>7. Your content</h2>
<ul>
<li>You keep ownership of what you post (messages, posts, photos, reviews). You give us a non-exclusive, royalty-free licence to store, display and transmit it only to run the Service, for as long as it is on the Service.</li>
<li>You are responsible for what you post. It must follow our <a href="/legal/community-guidelines">Community Guidelines</a> and the law.</li>
<li>Chat messages and Pulse posts are deleted automatically after the periods stated in our <a href="/legal/privacy">Privacy Policy</a>. Do not rely on ${biz} to keep a copy of your content.</li>
</ul>

<h2>8. Moderation, reporting and blocking</h2>
<ul>
<li>You can report any post, message, profile or listing, and block any user. Reports are reviewed by our team. Some content is hidden automatically while it is reviewed (for example after several separate reports), and a word filter blocks or masks abusive language.</li>
<li>We may remove content, restrict features, suspend or close accounts that break these Terms, our Community Guidelines or the law, and we may preserve and share information with authorities when the law requires it. You can appeal a decision through the app or by email.</li>
</ul>

<h2>9. Things you must not do</h2>
<ul>
<li>Break the law, harass, threaten, bully, impersonate or defame anyone, or share someone's private information or intimate images.</li>
<li>Post sexual content involving minors, hate speech, content promoting violence or self-harm, or anything that infringes someone else's rights.</li>
<li>Sell or buy alcohol, drugs, weapons or other illegal or restricted goods through the Service.</li>
<li>Place fake orders, refuse cash-on-delivery orders without reason, abuse refunds, coupons or referrals, or create multiple accounts.</li>
<li>Scrape, reverse-engineer, overload or interfere with the Service, or try to access accounts or data that are not yours.</li>
<li>Abuse, threaten or harm riders, drivers, store staff or other students.</li>
</ul>

<h2>10. Vehicle rentals between students</h2>
<ul>
<li>Rentals let a student offer their own bike, scooter or car to other students. Every listing states whether the vehicle has a <b>commercial rental number plate</b> or a <b>private number plate</b>, and the app labels it accordingly. Commercial-plate vehicles are offered for <b>rent</b> by their <b>owner</b> to a <b>renter</b>. Private-plate vehicles may only be <b>borrowed</b>: a <b>lender</b> lends their personal vehicle to a <b>borrower</b> on a non-commercial basis (sharing costs such as fuel), not hired out as a business; lenders are responsible for making sure this is lawful for their vehicle and insurance.</li>
<li>Owners and lenders must upload the vehicle's RC, insurance and their driving licence, and each listing is reviewed before it goes live. Renters and borrowers must have a valid driving licence for the vehicle class, with its expiry date, which we check before a booking can be accepted. One licence number can be registered to one account only, and an expired licence cannot be used for new bookings.</li>
<li>Before each booking the renter or borrower must accept that booking's terms in the app. For a borrowed (private) vehicle these say that it is the lender's personal vehicle, that the borrower is responsible for damage, fuel and traffic fines (challans) during the booking period, that it must not be used commercially, and that the borrower holds a valid licence. For a rented (commercial) vehicle they say that the owner is responsible for the rental permit and insurance.</li>
<li>The rental or borrowing agreement is <b>between the two students</b>. Any rent or cost share and the security deposit are paid in cash at handover, directly between you; ${biz} never holds the money.</li>
<li>${f.rentals && f.rentals.conditionPhotosRequired === false ? 'Owners and lenders can record' : 'Owners and lenders must record'} photos of the vehicle and the odometer reading at pickup and at return; the renter or borrower can add their own. These photos are private to the two of you and our team.</li>
<li>Extra charges (extra kilometres, fuel, late return or other costs) must be explained in the app. Other charges are limited to ₹${Number((f.rentals && f.rentals.otherChargesCap) || 5000).toLocaleString('en-IN')} per trip and never more than twice the deposit. The renter or borrower can accept or dispute them within ${(f.rentals && f.rentals.chargesResponseHours) || 48} hours; if they do not answer, the charges count as accepted. Disputed charges are reviewed by our team, who may uphold, reduce or cancel them and record the reason.</li>
<li>The person driving is responsible for driving legally (licence, helmet, traffic rules, no drink driving) and for fines, tolls and damage during the booking. Owners and lenders are responsible for the vehicle being roadworthy, insured and legally permitted to be used this way.</li>
<li><b>Insurance:</b> ${biz} does not provide any insurance and is not an insurer. Whether the owner's insurance covers another driver depends on that policy. Check before you rent or lend.</li>
<li>Damage, no-show, late return, safety and payment problems can be reported in the app. We review reports and may restrict accounts, but we are not a party to the agreement and cannot force either student to pay.</li>
</ul>

<h2>11. Auto-Ride (shared autos)</h2>
<ul>
<li>Auto-Ride lets you book seats in shared autos driven by independent drivers. Drivers are not our employees. Before a driver can publish trips, we check their driving licence and the vehicle's papers (RC, permit and insurance); this check does not guarantee a driver's conduct.</li>
<li>Fares are shown before you book and are paid <b>in cash to the driver</b>${f.autoRideWallet ? ', or from your Zenvy Wallet where offered' : ''}. ${biz} does not collect cash fares.</li>
<li>A seat is held for ${plural(ar.holdMinutes, 'minute')} while you confirm. You may book up to ${plural(ar.maxSeatsPerBooking, 'seat')} per booking. An auto never carries more passengers than its approved capacity (at most ${ar.platformMaxCapacity}, and never more than its registration certificate allows).</li>
<li>Be at the pickup point on time. If you do not board within ${plural(ar.noShowGraceMinutes, 'minute')} of departure, your seat can be released.</li>
<li>In an emergency call 112. Report any safety problem in the app; we may suspend drivers while we look into it.</li>
</ul>

<h2>12. Campus Events</h2>
<ul>
<li>Events are created by student organizers, clubs or other organizers, not by us. The organizer is responsible for the event, its content, safety, any entry fee and any refund.</li>
<li>Most events are free. Where there is an entry fee it is normally <b>paid at the venue</b> to the organizer${f.eventsWallet ? ', or from your Zenvy Wallet where offered' : ''}. Your ticket is a QR code in the app; organizers scan it at entry.</li>
<li>Organizers see your name, your registration answers and your ticket status, but never your phone number or email.</li>
<li>Cancellation rules for each event are shown on the event page (see our <a href="/legal/refunds">Refund Policy</a>).</li>
</ul>

<h2>13. Partner obligations (summary)</h2>
<ul>
<li><b>Stores and vendors</b>: keep menus, prices and availability accurate; hold the licences the law requires for what you sell (for example FSSAI registration for food); prepare and pack orders safely and hygienically; honour orders you accept.</li>
<li><b>Riders</b>: hold a valid driving licence and follow traffic laws; handle customers' orders and cash honestly; your live location is shared while you are on duty or carrying an order.</li>
<li><b>Auto drivers</b>: keep your driving licence, badge, RC, permit, insurance, fitness and PUC valid; never carry more passengers than your approved capacity; collect only the fare shown in the app; drive safely and treat passengers respectfully.</li>
<li>Partners are independent and are responsible for their own taxes and legal compliance. Payouts, where applicable, are settled as agreed with us.</li>
</ul>

<h2>14. Availability and changes to the Service</h2>
<p>We try to keep ${biz} running but do not promise it will always be available or error-free. Features may be switched on or off, changed or removed, and stores may be closed or unserviceable at times.</p>

<h2>15. Limitation of liability</h2>
<ul>
<li>To the extent the law allows, we are not liable for indirect or consequential loss, or for the acts, goods, services or conduct of stores, riders, drivers, organizers or other users.</li>
<li>For anything else, our total liability to you for a claim is limited to the amount you paid through ${biz} for the order or booking concerned.</li>
<li>Nothing in these Terms limits rights you have under the Consumer Protection Act, 2019 or other laws that cannot be excluded.</li>
</ul>

<h2>16. Suspension and termination</h2>
<p>You may stop using ${biz} and delete your account at any time. We may suspend or close an account that breaks these Terms, puts others at risk or is used for fraud, with notice where reasonable. Sections that by their nature should continue (for example payment obligations, liability limits and governing law) survive termination.</p>

<h2>17. Governing law and disputes</h2>
<p>These Terms are governed by the laws of India. Please contact us first so we can try to resolve any problem (see <a href="/legal/grievance">Grievance Redressal</a>). Subject to your rights as a consumer, disputes are subject to the jurisdiction of ${jurisdictionText(s)}.</p>

<h2>18. Changes to these Terms</h2>
<p>We may update these Terms. The version and effective date are shown at the top. If a change is significant we will ask you to review and accept it in the app the next time you sign in; you can keep using ${biz} while you decide. If you do not agree, you can delete your account.</p>

<h2>19. Contact and grievances</h2>
<p>Questions: ${mail(s.contactEmail)}.</p>
${officerHtml(f)}
<p>See <a href="/legal/grievance">Grievance Redressal</a> for how complaints are handled.</p>
`);
};

// ─── Privacy Policy ───────────────────────────────────────────────────────────
const PRIVACY = (f) => {
  const s = f.settings;
  const biz = esc(s.businessName);
  const r = f.retention;
  return page(f, 'Privacy policy', `
<h1>${biz} privacy policy</h1>
<p>${biz} is a campus delivery and campus community app for college students (food, groceries and essentials delivered to your hostel, plus campus community features). This policy explains what personal data we collect, why, who we share it with, how long we keep it and your rights under India's Digital Personal Data Protection Act, 2023. ${operatorLine(s)}</p>

<h2>1. Data we collect</h2>
<h3>Everyone</h3>
<table>
<tr><th>Data</th><th>When / why</th></tr>
<tr><td>Name, mobile number</td><td>When you sign up. Your number is verified by an SMS code and is how you sign in. Riders and stores see your name and number for an order you placed, so they can deliver it.</td></tr>
<tr><td>Email address (optional)</td><td>If you add one or sign in with Google: account recovery and service emails.</td></tr>
<tr><td>Password (optional)</td><td>Stored only as a one-way hash. Sign-in codes are stored only as a hash and expire after 5 minutes.</td></tr>
<tr><td>Hostel block, room number, delivery address and instructions</td><td>To deliver your orders.</td></tr>
<tr><td>Location during orders</td><td>The delivery spot you choose for an order (hostel, gate or a pin on the map), and the live location of the rider delivering it, so you can track the order. Text you type into address search is looked up through OpenStreetMap. The customer app does not read your phone's GPS in the background.</td></tr>
<tr><td>Orders, wallet and payments</td><td>Items, prices, order history, Zenvy Wallet balance and transactions. Payment is cash on delivery or Zenvy Wallet; we do not collect card or bank details. If a service asks you to pay a store by UPI, we store the UPI reference (UTR) and any payment screenshot you submit.</td></tr>
<tr><td>Terms acceptance</td><td>The version of these policies you accepted and when, as a record of your consent.</td></tr>
<tr><td>Device and app data</td><td>Device push token, platform and app version (to send notifications and to tell you when an update is required).</td></tr>
<tr><td>Support tickets and reports</td><td>What you write to us, and reports you file about content or users.</td></tr>
<tr><td>Technical logs</td><td>IP address, device / browser type, app version and request and error logs, used for security, abuse prevention and fixing problems.</td></tr>
</table>

<h3>Only if you use a feature</h3>
<table>
<tr><th>Feature</th><th>Data and why</th></tr>
<tr><td>Student verification</td><td>Your college email, college ID number and a photo of your <b>student ID card</b>, to confirm you are a student for campus features. The ID card photo is private: only you and our verification team can see it.</td></tr>
<tr><td>Campus profile</td><td>Branch, year, section, date of birth (to check you are 18+ where needed; others see only your age), profile photo, bio and status.</td></tr>
<tr><td>Connect (optional, 18+)</td><td>Date of birth, gender, who you want to meet, interests, photos, likes and matches. Connect photos are shown to other Connect users. A liveness selfie, if requested, is checked by a person (no face template is created) and deleted after the check.</td></tr>
<tr><td>Chats, Pulse, Spaces, forum and community posts</td><td>Messages, posts, replies, polls, votes, reactions and photos you share. Anonymous posts hide your name from other students, but we keep the real author so safety rules can be enforced.</td></tr>
<tr><td>Voice and video in Spaces and calls</td><td>Microphone (and camera for video calls) only while you are in a call or speaking in a Space. Audio and video are streamed live and are not recorded or stored.</td></tr>
<tr><td>Find friends (contacts)</td><td>Only if you choose to sync contacts. Numbers are compared to find friends on ${biz} and are not stored.</td></tr>
<tr><td>Lost &amp; found, ride and bike pooling</td><td>The text, places and photos you post.</td></tr>
<tr><td>Vehicle rentals (owners and lenders)</td><td>Vehicle details, registration number, number plate type, photos, pickup address and map location, and photos of the vehicle's <b>RC</b>, <b>insurance</b> and your <b>driving licence</b>. Documents are private to you and our review team; the full plate number is shown to a renter or borrower only after you accept their booking. Pickup and return condition photos, odometer readings and any extra-charge notes and evidence photos.</td></tr>
<tr><td>Vehicle rentals (renters and borrowers)</td><td>Your <b>driving licence</b> number, classes, expiry and photos (front and back), verified by our team; owners and lenders see only whether your licence is verified. Booking details, when you accepted the booking terms, handover PINs, condition photos you add, extra charges, your answer to them and any dispute or damage reports with photos. Condition and dispute photos are private to the two students of that booking and our team.</td></tr>
<tr><td>Auto-Ride (passengers)</td><td>Your bookings, seats and payment method. The driver sees only your first name, booking code and number of seats, never your phone number.</td></tr>
<tr><td>Campus Events</td><td>Your <b>registrations</b>, your <b>answers to the organizer's registration questions</b>, team membership, <b>tickets</b> (a QR code that contains no personal data) and check-in status. Organizers see your name, answers and ticket status, never your phone or email.</td></tr>
<tr><td>PG / hostel bookings and other services</td><td>The booking details you enter (residence, room, dates, amounts).</td></tr>
</table>

<h3>Partners (riders, auto drivers, stores and vendors)</h3>
<table>
<tr><th>Who</th><th>Data and why</th></tr>
<tr><td>Riders (Zenvy Rider app)</td><td>Name, phone, password hash, vehicle type and number, photo, emergency contact, and payout and tip records. <b>Background location</b>: while you are on duty or carrying an order, the app shares your location even when it is in the background (every 5-10 seconds with an order, every 30-60 seconds when on duty without one), so customers can track deliveries and orders can be assigned. Only your latest position is stored, not a history. SOS alerts include your location.</td></tr>
<tr><td>Auto drivers (Zenvy Auto Driver app)</td><td>Name, phone, password hash, emergency contact, <b>driving licence</b> number, expiry and photos, badge, an optional police verification certificate, your photo, and for each vehicle its registration, <b>RC</b>, <b>permit</b>, <b>insurance</b>, fitness and PUC documents. We never collect Aadhaar images. The driver app does not track your location; an SOS alert includes your location only if you allow it.</td></tr>
<tr><td>Stores and vendors</td><td>Business and contact details, menus, prices, opening hours and order history.</td></tr>
</table>
<p>We do not use advertising IDs, we do not show ads and we do not sell your data.</p>

<h2>2. Why we use it (purposes)</h2>
<ul>
<li>To create and secure your account (sign-in, SMS verification, fraud and abuse prevention).</li>
<li>To take, prepare, deliver and support your orders, bookings and registrations, and to keep your wallet balance.</li>
<li>To verify students, rental documents, licences and drivers before they can use features that need it.</li>
<li>To run the campus features you choose to use.</li>
<li>To send notifications about your orders, messages and account.</li>
<li>To moderate content, act on reports and keep the community safe.</li>
<li>To meet legal obligations (for example accounting and tax records, and lawful requests from authorities).</li>
</ul>
<p>We process your data on the basis of your consent (which you give when you create an account or turn on a feature, and can withdraw) and, where the law allows, for legitimate uses such as complying with the law.</p>

<h2>3. Who we share it with</h2>
<ul>
<li><b>Riders and stores</b>: your name, number, hostel / room and order details for orders you place.</li>
<li><b>Auto drivers, organizers and other students</b>: only what is described in the table above for that feature.</li>
<li><b>Other users</b>: what you choose to publish (profile name and photo, posts, messages to them).</li>
<li><b>Service providers</b> who process data for us under our instructions:
<ul>
${f.thirdParties.map((t) => `<li><b>${esc(t.name)}</b>: ${esc(t.what)}.</li>`).join('\n')}
</ul></li>
<li><b>Authorities</b>, only when the law requires it.</li>
</ul>
<p>Some providers may store data on servers outside India. All data is sent over encrypted connections (HTTPS / TLS).</p>

<h2>4. How long we keep it</h2>
<table>
<tr><th>Data</th><th>Kept for</th></tr>
<tr><td>Chat messages (direct, group, task, Connect and campus chats) and chat photos</td><td>${plural(r.chatDays, 'day')} after they are sent, then deleted automatically.</td></tr>
<tr><td>Campus spot room messages</td><td>24 hours.</td></tr>
<tr><td>Pulse posts, replies, polls, reactions and photos</td><td>${plural(r.pulseDays, 'day')} after posting, then deleted automatically.</td></tr>
<tr><td>Community posts</td><td>48 hours.</td></tr>
<tr><td>Connect chats after a match ends</td><td>${plural(f.connectChatDays, 'day')}.</td></tr>
<tr><td>Liveness selfies</td><td>Deleted as soon as the check is decided, or after 30 days if never reviewed.</td></tr>
<tr><td>Campus Events registration answers</td><td>${plural(f.events.retentionDays, 'day')} after the event ends, then removed. Registrations and tickets stay in your history while your account is open.</td></tr>
<tr><td>Content under an open report or appeal</td><td>Until the report or appeal is closed.</td></tr>
<tr><td>Rider location</td><td>Only the latest position is kept; it is overwritten with every update.</td></tr>
<tr><td>Student ID card, rental documents, licences and driver / vehicle documents</td><td>While your account (or listing) is open, so they can be re-checked; deleted when you delete your account. You can ask us to delete an ID card photo after verification.</td></tr>
<tr><td>Account details</td><td>While your account is open.</td></tr>
<tr><td>Order, wallet, booking and payment records</td><td>Kept after account deletion with your name, number and address removed, as required for accounting and tax law (up to 8 years).</td></tr>
<tr><td>Moderation and safety records (reports, sanctions, consents)</td><td>Kept linked to an anonymised account to prevent abuse.</td></tr>
<tr><td>Server logs</td><td>A limited period set by our hosting provider, for security and troubleshooting.</td></tr>
</table>

<h2>5. Your rights</h2>
<p>Under the Digital Personal Data Protection Act, 2023 you have the right to:</p>
<ul>
<li><b>Access</b>: ask for a summary of the personal data we hold about you and how we use it, and who we have shared it with.</li>
<li><b>Correction and updating</b>: edit your profile in the app, or ask us to correct or complete inaccurate data.</li>
<li><b>Erasure</b>: delete your account in the app (Profile → Delete my account) or <a href="/legal/delete-account">by email</a>, or ask us to erase specific data we no longer need.</li>
<li><b>Withdraw consent</b>: turn off a feature, deny a permission or delete your account. Withdrawal does not affect processing already done.</li>
<li><b>Grievance redressal</b>: complain to our Grievance Officer (<a href="/legal/grievance">details</a>). If you are not satisfied, you may complain to the Data Protection Board of India.</li>
<li><b>Nominate</b>: nominate another person to exercise these rights for you in case of death or incapacity, by emailing us.</li>
</ul>
<p>To use these rights, email ${mail(s.contactEmail, 'Privacy request')} from your registered email or mention your registered mobile number. We will confirm it is you before acting.</p>

<h2>6. Children</h2>
<p>${biz} is meant for college students aged 18 and over. Users under 18 may only use ${biz} with the consent of a parent or guardian, cannot use 18+ features such as Connect, and are never shown targeted advertising or behaviourally tracked (we do neither for anyone). If we learn that we hold data of a child without the required consent, we will delete it. Parents can contact us at ${mail(s.contactEmail)}.</p>

<h2>7. Cookies</h2>
<p>The mobile apps do not use cookies; they keep your sign-in on your device. The web admin dashboard and web sign-in use one strictly necessary, secure sign-in cookie. These legal pages set no cookies. We use no tracking or advertising cookies.</p>

<h2>8. Security</h2>
<p>We use encryption in transit, hashed passwords and codes, access controls and private storage with short-lived signed links for documents. No system is perfectly secure; if a breach affects you we will notify you and the authorities as the law requires.</p>

<h2>9. Deleting your data</h2>
<p>You can delete your account at any time in the app: <b>Profile → Delete my account</b>, or see <a href="/legal/delete-account">how to delete your account</a>. When you delete your account we delete your profile, photos, ID card and documents, chats, posts, friends, notifications and push tokens, and we remove your name, number, email, hostel and room from the order and payment records we must keep. Riders and auto drivers can delete their account in their app (Profile / Settings → Delete account); store accounts are closed by the Zenvy team on request. See <a href="/legal/delete-account">how to delete your account</a> for what partner records are kept.</p>

<h2>10. Changes</h2>
<p>We will update this page when our practices change and show the new version and date at the top. For significant changes we will ask you to review them in the app.</p>

<h2>11. Contact</h2>
<p>Questions or requests: ${mail(s.contactEmail)}.</p>
${officerHtml(f)}
`);
};

// ─── Cancellation & Refund Policy ─────────────────────────────────────────────
const REFUNDS = (f) => {
  const s = f.settings;
  const biz = esc(s.businessName);
  const ar = f.autoRide;
  const ev = f.events;
  const o = f.orders;
  return page(f, 'Cancellation & Refund Policy', `
<h1>Cancellation &amp; Refund Policy</h1>
<p>This policy explains when you can cancel and what you get back, feature by feature. ${biz} accepts <b>cash on delivery</b> and <b>Zenvy Wallet</b> payments only, so refunds are made to your Zenvy Wallet; if you paid cash and nothing was delivered, there is nothing to refund. Zenvy Wallet credit is non-withdrawable, non-transferable in-app credit (see the <a href="/legal/terms">Terms</a>).</p>

<h2>1. Food, grocery and essentials orders</h2>
<table>
<tr><th>Situation</th><th>What happens</th></tr>
<tr><td>You cancel while the store has not accepted the order</td><td>Cancelled. Wallet-paid: full refund to your wallet, and any coupon you used is restored.</td></tr>
<tr><td>You cancel within ${o.customerCancelSeconds / 60} minutes of placing it, after the store accepted it, before a delivery partner picks it up</td><td>Cancelled, full refund to your wallet (wallet-paid).</td></tr>
<tr><td>After that, or once a delivery partner is on the order</td><td>You cannot cancel in the app. Contact support from the order page; we decide case by case.</td></tr>
<tr><td>The store does not accept within ${plural(o.pendingTimeoutMin, 'minute')}</td><td>Cancelled automatically, full refund to your wallet (wallet-paid).</td></tr>
<tr><td>No delivery partner takes the order within ${plural(o.unclaimedTimeoutMin, 'minute')}</td><td>Cancelled automatically, full refund to your wallet (wallet-paid).</td></tr>
<tr><td>The store or we cancel the order</td><td>Full refund to your wallet (wallet-paid).</td></tr>
<tr><td>Missing, wrong, damaged or unsafe items</td><td>Report it from the order page as soon as possible after delivery, with photos if you can. If we confirm the problem, we credit your wallet for the affected items (and delivery fee where appropriate).</td></tr>
</table>
<p><b>Timeline:</b> refunds for cancellations are credited to your Zenvy Wallet immediately when the order is cancelled. Complaints are acknowledged within 24 hours and resolved within 15 days.</p>
<p>Repeatedly refusing cash-on-delivery orders may lead to cash on delivery being turned off for your account.</p>

<h2>2. Auto-Ride (shared autos)</h2>
<ul>
<li>Fares are normally paid <b>in cash to the driver</b> when you board. If you paid cash, there is nothing for ${biz} to refund; settle any issue with the driver or contact support.</li>
${f.autoRideWallet ? `<li>Where you paid from your Zenvy Wallet:
<ul>
<li>You cancel before the trip is confirmed: <b>${ar.customerRefundBeforeConfirmPct}%</b> refund to your wallet.</li>
<li>You cancel after the trip is confirmed: <b>${ar.customerRefundAfterConfirmPct}%</b> refund to your wallet.</li>
<li>The driver, ${biz} or the system cancels the trip, or the driver does not turn up: <b>100%</b> refund to your wallet.</li>
</ul></li>` : `<li>Zenvy Wallet payment for Auto-Ride is currently off. If it is turned on, the refund rules are: cancel before the trip is confirmed: ${ar.customerRefundBeforeConfirmPct}% back to your wallet; after it is confirmed: ${ar.customerRefundAfterConfirmPct}%; trip cancelled by the driver, ${biz} or the system, or driver no-show: 100%.</li>`}
<li>If you do not board within ${plural(ar.noShowGraceMinutes, 'minute')} of departure, your seat may be released and treated as a cancellation after confirmation.</li>
</ul>

<h2>3. Campus Events</h2>
<ul>
<li>Most events are free. For paid events the fee is normally <b>paid at the venue</b> to the organizer.</li>
<li>Unless the event page says otherwise, you can cancel your registration up to <b>${hours(ev.defaultUserCancelUntilHours)}</b> before the event starts, and the refund is <b>${ev.defaultRefundPct}%</b> of what you paid. Each event can set its own cancellation window and refund percentage, shown on the event page before you register.</li>
<li>If the organizer, ${biz} or the system cancels the event: 100% refund.</li>
<li>How refunds are paid: wallet payments go back to your Zenvy Wallet${f.thirdParties.some((t) => t.key === 'razorpay') ? '; online (Razorpay) payments go back to the original payment method, normally within 5-7 working days' : ''}; cash paid at the venue is refunded by the organizer in person.</li>
<li>If you do not pay at the venue for an unpaid reservation, your place may be released.</li>
</ul>

<h2>4. Vehicle rentals between students</h2>
<ul>
<li>Rent and any security deposit are paid in cash directly between the two students at handover. ${biz} never holds this money, so ${biz} cannot refund it.</li>
<li>Before handover you can cancel a request or booking in the app. The owner must answer a request within 2 hours, otherwise it expires.</li>
<li>The owner or lender returns the deposit at return, minus any extra charges (extra kilometres, fuel, late return) that are itemised in the app. A returned booking the owner or lender does not close is completed automatically after 24 hours.</li>
<li>Extra charges only count once the renter or borrower accepts them in the app, or does not answer within ${(f.rentals && f.rentals.chargesResponseHours) || 48} hours. They can dispute the charges instead, with a note and photos; our team reviews both sides and upholds, reduces or cancels the charges, and both students are told the outcome and the reason.</li>
<li>Other damage, no-show, late return, safety or payment problems: report them in the app. We review reports, may ask both sides for photos and documents, and may restrict accounts, but the final settlement is between the two students. ${biz} is not an insurer.</li>
</ul>

<h2>5. Zenvy Wallet</h2>
<ul>
<li>Wallet balance can only be spent inside ${biz}. It cannot be withdrawn to a bank account or as cash${f.walletTransfers ? '' : ', and it cannot be transferred'}.</li>
<li>Credits given by mistake or obtained through fraud or abuse may be reversed.</li>
<li>Any balance is forfeited when you delete your account, so please use it first.</li>
</ul>

<h2>6. Questions and complaints</h2>
<p>Contact support from the order or booking in the app, or email ${mail(s.contactEmail, 'Refund')}. Complaints are acknowledged within 24 hours and resolved within 15 days. See <a href="/legal/grievance">Grievance Redressal</a>.</p>
`);
};

// ─── Grievance Redressal ──────────────────────────────────────────────────────
const GRIEVANCE = (f) => {
  const s = f.settings;
  const biz = esc(s.businessName);
  return page(f, 'Grievance Redressal', `
<h1>Grievance Redressal</h1>
<p>In line with the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, the Consumer Protection (E-Commerce) Rules, 2020 and the Digital Personal Data Protection Act, 2023, ${biz} has a grievance officer to handle complaints about the Service, content on it, orders, refunds and your personal data.</p>
${officerHtml(f)}

<h2>How to complain</h2>
<ol>
<li><b>In the app (fastest):</b> open your Profile → Help &amp; Support → Support tickets and raise a ticket. For an order, use the help option on that order.</li>
<li><b>By email:</b> write to ${mail(f.grievanceComplete ? s.grievanceOfficer.email : s.contactEmail, 'Grievance')}.</li>
</ol>
<p>Please include your name, the mobile number on your account, what happened, the order / booking / post concerned (ID, link or screenshot) and what you would like us to do.</p>

<h2>What happens next</h2>
<ul>
<li>We <b>acknowledge</b> your complaint <b>within 24 hours</b>.</li>
<li>We <b>resolve</b> it <b>within 15 days</b> of receiving it and tell you the outcome and reasons.</li>
<li>Complaints about content that exposes someone's private parts, shows them in a sexual act, or impersonates them (including morphed images) are acted on within 24 hours.</li>
</ul>

<h2>If you are not satisfied</h2>
<ul>
<li>For decisions about content or your account, you may appeal to the Grievance Appellate Committee set up by the Government of India within 30 days.</li>
<li>For consumer complaints you can also contact the National Consumer Helpline or the consumer commission.</li>
<li>For personal data complaints you may approach the Data Protection Board of India after using this process.</li>
</ul>

<h2>Other contact</h2>
<p>General questions: ${mail(s.contactEmail)}.${s.registeredAddress ? ` Address: ${escMultiline(s.registeredAddress)}.` : ''}</p>
`);
};

// ─── Community Guidelines ─────────────────────────────────────────────────────
const COMMUNITY = (f) => {
  const s = f.settings;
  const biz = esc(s.businessName);
  const sla = f.sla;
  return page(f, 'Community Guidelines', `
<h1>Community Guidelines</h1>
<p>These rules apply to everything people share on ${biz}: chats, Pulse, Spaces, the forum, community and lost &amp; found posts, campus spots, polls, Connect profiles, rental listings, events, reviews and profiles. They are part of our <a href="/legal/terms">Terms</a>.</p>

<h2>1. Be respectful</h2>
<ul>
<li>No harassment, bullying, threats, stalking or hate based on religion, caste, gender, sexuality, disability, region or anything else.</li>
<li>No unwanted sexual messages. Sexual content involving anyone under 18 is never allowed and is reported to the authorities.</li>
</ul>
<h2>2. Protect privacy</h2>
<ul>
<li>Do not share anyone's phone number, address, room, photos or private conversations without their permission.</li>
<li>Never share intimate images of anyone, and do not impersonate anyone (including morphed or AI-made images).</li>
</ul>
<h2>3. Keep it honest and legal</h2>
<ul>
<li>No scams, spam, fake listings, fake reviews or misleading information.</li>
<li>No selling alcohol, drugs, weapons or other illegal items. No academic cheating services.</li>
<li>Do not post content that encourages violence or self-harm. If you or someone else is in danger, call 112.</li>
<li>Respect copyright: only post content you have the right to share.</li>
</ul>
<h2>4. Anonymous posting</h2>
<p>Anonymous posts hide your name from other students, but we keep the real author so these rules still apply. Anonymity can be lifted by our moderators for a serious safety reason, and every such step is recorded.</p>

<h2>5. Reporting and blocking</h2>
<ul>
<li>Use <b>Report</b> on any post, message, profile, listing or event. Reports are reviewed by people; a report alone is not proof.</li>
<li>Use <b>Block</b> to stop someone contacting you.</li>
<li>A filter blocks severe abuse and masks milder bad language automatically.</li>
<li>Content reported by ${f.ugcAutoHide} different people on campus feeds, or reported as a threat, self-harm or a privacy violation by ${f.friendsAutoHide} different people, is hidden while we review it.</li>
</ul>

<h2>6. How fast we act</h2>
<table>
<tr><th>Type of report</th><th>Target review time</th></tr>
<tr><td>Threats of violence, self-harm</td><td>${hours(sla.critical)}</td></tr>
<tr><td>Harassment, hate, sexual content, privacy violations</td><td>${hours(sla.high)}</td></tr>
<tr><td>Impersonation, defamation, academic integrity</td><td>${hours(sla.medium)}</td></tr>
<tr><td>Spam and other</td><td>${hours(sla.low)}</td></tr>
</table>
<p>Complaints sent to our Grievance Officer are acknowledged within 24 hours and resolved within 15 days (see <a href="/legal/grievance">Grievance Redressal</a>).</p>

<h2>7. What happens if rules are broken</h2>
<p>We may remove content, warn you, limit features, or suspend or close your account, depending on how serious and how repeated the problem is. Illegal content may be preserved and shared with authorities when the law requires. You can appeal any decision in the app or by email at ${mail(s.contactEmail, 'Appeal')}.</p>
`);
};

// ─── Delete account ───────────────────────────────────────────────────────────
const DELETE = (f) => {
  const s = f.settings;
  const biz = esc(s.businessName);
  return page(f, 'Delete your account', `
<h1>Delete your ${biz} account</h1>
<p class="muted">Applies to the Zenvy app (com.srm.hostelbites) and the partner apps: Zenvy Rider (com.srm.hostelbitesdelivery), Zenvy Auto Driver (com.srm.zenvyautodriver), Zenvy Restaurant (com.zenvy.restaurant) and Zenvy Vendor (com.srm.zenvyvendor). <a href="#riders">Riders and auto drivers</a> · <a href="#stores">Restaurants and vendors</a></p>

<h2>Option 1: in the app (fastest)</h2>
<ol>
<li>Open Zenvy and sign in.</li>
<li>Go to the <b>Profile</b> tab and scroll down.</li>
<li>Tap <b>Delete my account</b>.</li>
<li>Read what will be deleted, type <b>DELETE</b>, then enter the SMS code we send to your number.</li>
</ol>
<p>Your account is closed immediately and you are signed out on every device.</p>

<h2>Option 2: by email</h2>
<p>If you can't use the app, email ${mail(s.contactEmail, 'Delete my Zenvy account')} with the subject "Delete my Zenvy account" from the email linked to your account, or include the mobile number you signed up with. To protect you, we will confirm the request with an SMS code or a reply from that email before deleting. We complete requests within 7 days. Partner accounts can also be deleted by email (see below).</p>

<div class="box">
<p><b>Please note:</b> you must not have an order or rental in progress. Any Zenvy Wallet balance and reward points are forfeited when the account is deleted, so please use them first.</p>
</div>

<h2>What is deleted</h2>
<ul>
<li>Your profile: name, mobile number, email, Google sign-in link, hostel block, room number, address, profile photo and bio.</li>
<li>Chats and direct conversations, Pulse posts, replies, polls, votes, reactions and community posts.</li>
<li>Friends, friend requests, Campus profile, college verification and student ID card photo, Connect profile, photos, likes and matches, lost &amp; found posts, uploaded photos and documents, reviews, notifications and device push tokens.</li>
<li>Your Firebase phone sign-in record.</li>
</ul>

<h2>What is kept, and for how long</h2>
<ul>
<li>Order, wallet, booking and payment records, with your name, number, address and notes removed, as required for accounting and tax law (up to 8 years).</li>
<li>Safety and moderation records (for example reports about abuse), linked only to an anonymised account, to prevent fraud and abuse.</li>
</ul>

<h2 id="riders">Zenvy Rider and Zenvy Auto Driver accounts</h2>
<p>Riders and auto drivers sign up in their app, so they can delete their account in the app too:</p>
<ol>
<li><b>Zenvy Rider</b>: open the <b>Profile</b> tab and tap <b>Delete account</b>. <b>Zenvy Auto Driver</b>: open <b>Menu → Settings</b> and tap <b>Delete account</b>.</li>
<li>Read what will be deleted, type <b>DELETE</b> and confirm with your password or the SMS code we send to your number.</li>
</ol>
<p>Or email ${mail(s.contactEmail, 'Delete my Zenvy partner account')} from the mobile number's owner, as above. Before deleting you must finish or hand back any delivery or trip in progress, deposit cash you collected for ${biz}, and receive any money ${biz} still owes you; the app tells you what is left.</p>
<ul>
<li><b>Deleted</b>: name, mobile number, password, profile photo, bio, vehicle number (riders), emergency contact, live and last location, licence number, PSV badge, licence / police verification / document and vehicle photos (drivers), device push tokens, notifications, your order chat messages, support tickets not linked to an order, and sign-in codes. You are signed out on every device at once.</li>
<li><b>Kept</b>, with your personal details removed: delivery and trip records, cash collected and deposits, earnings, payouts and wallet entries (accounting and tax law, up to 8 years); vehicle registration and capacity linked to past trips, safety incidents, SOS and trip event logs, and support tickets about an order (safety, disputes and fraud prevention). Order chat is deleted after 90 days in any case.</li>
</ul>

<h2 id="stores">Zenvy Restaurant and Zenvy Vendor accounts</h2>
<p>Store accounts are created by the ${biz} team, so they are closed by the team: email ${mail(s.contactEmail, 'Close my Zenvy store account')} from the store owner's registered email or mobile number (or use <b>Settings → Delete account</b> in the store app, which opens this page). We confirm the request with the registered owner, settle any payouts, and close the account within 7 days. Order, payout, FSSAI / GST and tax records are kept as the law requires; the store login and device push tokens are removed.</p>
`, { showVersion: false });
};

// Links inside the pages stay relative (they work on every address the API answers on). With
// PUBLIC_API_URL set (own domain), a canonical link tells search engines / Play which address is the real one.
const withCanonical = (html, path) => {
  const base = require('../utils/publicUrl').envBase('PUBLIC_API_URL');
  if (!base) return html;
  const href = `${base}${path}`.replace(/"/g, '%22');
  return html.replace('</head>', `<link rel="canonical" href="${href}">\n</head>`);
};

const send = (render, path) => async (req, res) => {
  try {
    const facts = await gather();
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(withCanonical(render(facts), path));
  } catch (err) {
    console.error('[LEGAL_PAGE_ERROR]', path, err.message);
    res.status(500).type('text').send('This page is temporarily unavailable. Please try again in a minute.');
  }
};

router.get('/', send(INDEX, '/legal'));
router.get('/terms', send(TERMS, '/legal/terms'));
router.get('/terms-of-service', (req, res) => res.redirect(301, '/legal/terms'));
router.get('/privacy', send(PRIVACY, '/legal/privacy'));
router.get('/privacy-policy', (req, res) => res.redirect(301, '/legal/privacy'));
router.get('/refunds', send(REFUNDS, '/legal/refunds'));
router.get('/refund-policy', (req, res) => res.redirect(301, '/legal/refunds'));
router.get('/grievance', send(GRIEVANCE, '/legal/grievance'));
router.get('/community-guidelines', send(COMMUNITY, '/legal/community-guidelines'));
router.get('/delete-account', send(DELETE, '/legal/delete-account'));

module.exports = router;
module.exports.renderers = { INDEX, TERMS, PRIVACY, REFUNDS, GRIEVANCE, COMMUNITY, DELETE };
module.exports.esc = esc;
