/**
 * Public legal pages (Google Play Console: Privacy policy URL + Account deletion URL).
 *   GET /legal/privacy
 *   GET /legal/delete-account
 * Plain static HTML: no scripts, no trackers, no cookies, no external fonts.
 */
const express = require('express');

const router = express.Router();

const SUPPORT_EMAIL = 'projectshanmukh@gmail.com';
const UPDATED = '16 October 2026';

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>${title} - Zenvy</title>
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#1a1a1a; --muted:#5b5b5b; --line:#e3e3e3; --accent:#8a6d1f; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f0f10; --fg:#ececec; --muted:#a8a8a8; --line:#2a2a2c; --accent:#d8b65c; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.6 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.6rem; line-height:1.25; margin: 0 0 4px; }
  h2 { font-size: 1.15rem; margin: 28px 0 8px; padding-top: 12px; border-top: 1px solid var(--line); }
  p, li { margin: 6px 0; }
  ul, ol { padding-left: 22px; }
  .muted { color: var(--muted); font-size: .9rem; }
  a { color: var(--accent); }
  table { width:100%; border-collapse: collapse; font-size:.92rem; }
  th, td { text-align:left; vertical-align: top; padding: 8px 6px; border-bottom: 1px solid var(--line); }
  .box { border:1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 14px 0; }
</style>
</head>
<body><main>
${body}
<p class="muted" style="margin-top:36px">Zenvy (package com.srm.hostelbites) · Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> · <a href="/legal/privacy">Privacy policy</a> · <a href="/legal/delete-account">Delete your account</a></p>
</main></body>
</html>`;

const PRIVACY = page('Privacy policy', `
<h1>Zenvy privacy policy</h1>
<p class="muted">Last updated: ${UPDATED}</p>
<p>Zenvy is a campus delivery and campus community app for college students (food, groceries and essentials delivered to your hostel, plus the Campus Buddy social features). This policy explains what we collect, why, who we share it with, how long we keep it and how you can delete it. Zenvy is run by Shanmukesh Kunjam ("we", "us"). Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

<h2>1. Data we collect</h2>
<table>
<tr><th>Data</th><th>When / why</th></tr>
<tr><td>Name, mobile number</td><td>When you sign up. Your number is verified by SMS code and is how you sign in. Riders and stores see your name and number for an order you placed, so they can deliver it.</td></tr>
<tr><td>Email address (optional)</td><td>If you add one or sign in with Google: account recovery and receipts.</td></tr>
<tr><td>College email</td><td>Only if you verify your student status for Campus Buddy features.</td></tr>
<tr><td>Hostel block and room number, delivery address and instructions</td><td>To deliver your orders.</td></tr>
<tr><td>Location during orders</td><td>The delivery spot you choose for an order (hostel, gate or pin), and the live location of the rider delivering it, so you can track the order. The customer app does not read your phone's GPS.</td></tr>
<tr><td>Orders, wallet and payments</td><td>Items, prices, order history, Zenvy Wallet balance and transactions. Payment is cash on delivery or Zenvy Wallet; we do not collect card or bank details.</td></tr>
<tr><td>Photos</td><td>Only photos you choose to upload (profile picture, lost &amp; found items, posts, chat photos), picked with the system photo picker or taken with the camera when you ask.</td></tr>
<tr><td>Date of birth, gender and Connect preferences</td><td>Only if you join Connect (optional, 18+): your date of birth is used to check you are 18 or older (others see your age, never the date); gender and who you want to meet are used to show you profiles. Connect photos are shown to other Connect users; a liveness selfie, if requested, is used only to confirm you are a real person and is deleted after the check.</td></tr>
<tr><td>Chat messages</td><td>Messages you send in campus chats. Automatically deleted 7 days after they are sent.</td></tr>
<tr><td>Pulse posts and community content</td><td>Posts, replies, polls, votes and reactions you publish. Pulse posts are automatically deleted 30 days after they are posted.</td></tr>
<tr><td>Voice in Spaces and calls</td><td>Microphone (and camera for video calls) only while you are in a call or speaking in a Space. Audio and video are streamed live and are not recorded or stored by us.</td></tr>
<tr><td>Device push token</td><td>To send order updates and messages as notifications.</td></tr>
<tr><td>Contacts</td><td>Only if you choose to sync contacts to find friends on Zenvy. Numbers are compared to find matches and are not stored. The current app version does not access your contacts.</td></tr>
<tr><td>Support tickets and reports</td><td>What you write to us, and reports you file about content or users.</td></tr>
<tr><td>Technical logs</td><td>IP address, app version and error logs, kept briefly for security and to fix problems.</td></tr>
</table>
<p>We do not use advertising IDs, we do not show ads and we do not sell your data.</p>

<h2>2. How we use it</h2>
<ul>
<li>To create and secure your account (sign-in, SMS verification, fraud and abuse prevention).</li>
<li>To take, prepare, deliver and support your orders, and to keep your wallet balance.</li>
<li>To run Campus Buddy features you choose to use (chat, Pulse, Spaces, lost &amp; found, ride pooling, rentals).</li>
<li>To send notifications about your orders, messages and account.</li>
<li>To moderate content, act on reports and keep the community safe.</li>
</ul>

<h2>3. Who we share it with</h2>
<ul>
<li><b>Riders and stores</b>: your name, number, hostel/room and order details for orders you place.</li>
<li><b>Other users</b>: what you choose to publish (profile name and photo, posts, messages to them).</li>
<li><b>Service providers</b> who process data for us: Google Firebase (phone sign-in and push notifications), Brevo (email), our SMS provider (verification codes), and our hosting and database provider (Render).</li>
<li><b>Authorities</b>, only when the law requires it.</li>
</ul>
<p>All data is sent over encrypted connections (HTTPS / TLS).</p>

<h2>4. How long we keep it</h2>
<ul>
<li>Chat messages: 7 days. Pulse posts: 30 days. Content under an open safety report may be kept until the report is closed.</li>
<li>Account details: while your account is open.</li>
<li>Order, wallet and payment records: kept after account deletion with your personal details removed, as required for accounting and tax law.</li>
<li>Moderation and safety records (reports, sanctions): kept linked to an anonymised account to prevent abuse.</li>
</ul>

<h2>5. Deleting your data</h2>
<p>You can delete your account at any time in the app: <b>Profile → Delete my account</b>. You can also email us; see <a href="/legal/delete-account">how to delete your account</a>. When you delete your account we delete your profile, photos, chats, posts, friends, notifications and push tokens, and we remove your name, number, email, hostel and room from the order and payment records we must keep.</p>

<h2>6. Your choices</h2>
<ul>
<li>You can edit your profile, turn off notifications and deny any permission in your phone's settings; the related feature will then not work.</li>
<li>You can ask us for a copy of your data, or to correct it, by email.</li>
</ul>

<h2>7. Children</h2>
<p>Zenvy is meant for college students aged 18 and over. We do not knowingly collect data from children.</p>

<h2>8. Changes</h2>
<p>We will update this page when our practices change and show the new date above.</p>

<h2>9. Contact</h2>
<p>Questions or requests: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
`);

const DELETE = page('Delete your account', `
<h1>Delete your Zenvy account</h1>
<p class="muted">Applies to the Zenvy app (com.srm.hostelbites) · Last updated: ${UPDATED}</p>

<h2>Option 1: in the app (fastest)</h2>
<ol>
<li>Open Zenvy and sign in.</li>
<li>Go to the <b>Profile</b> tab and scroll down.</li>
<li>Tap <b>Delete my account</b>.</li>
<li>Read what will be deleted, type <b>DELETE</b>, then enter the SMS code we send to your number.</li>
</ol>
<p>Your account is closed immediately and you are signed out on every device.</p>

<h2>Option 2: by email</h2>
<p>If you can't use the app, email <a href="mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20Zenvy%20account">${SUPPORT_EMAIL}</a> with the subject "Delete my Zenvy account" from the email linked to your account, or include the mobile number you signed up with. To protect you, we will confirm the request with an SMS code or a reply from that email before deleting. We complete requests within 7 days.</p>

<div class="box">
<p><b>Please note:</b> you must not have an order or rental in progress. Any Zenvy Wallet balance and reward points are forfeited when the account is deleted, so please use them first.</p>
</div>

<h2>What is deleted</h2>
<ul>
<li>Your profile: name, mobile number, email, Google sign-in link, hostel block, room number, address, profile photo and bio.</li>
<li>Chats and direct conversations, Pulse posts, replies, polls, votes, reactions and community posts.</li>
<li>Friends, friend requests, Campus profile, college verification, Connect profile, photos, likes and matches, lost &amp; found posts, uploaded photos, reviews, notifications and device push tokens.</li>
<li>Your Firebase phone sign-in record.</li>
</ul>

<h2>What is kept, and for how long</h2>
<ul>
<li>Order, wallet and payment records, with your name, number, address and notes removed, as required for accounting and tax law (up to 8 years).</li>
<li>Safety and moderation records (for example reports about abuse), linked only to an anonymised account, to prevent fraud and abuse.</li>
</ul>
`);

// Links inside the pages stay relative (they work on every address the API answers on). With
// PUBLIC_API_URL set (own domain), a canonical link tells search engines / Play which address is the real one.
const withCanonical = (html, path) => {
  const base = require('../utils/publicUrl').envBase('PUBLIC_API_URL');
  if (!base) return html;
  const href = `${base}${path}`.replace(/"/g, '%22');
  return html.replace('</head>', `<link rel="canonical" href="${href}">\n</head>`);
};

const send = (html, path) => {
  const body = withCanonical(html, path);
  return (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(body);
  };
};

router.get('/privacy', send(PRIVACY, '/legal/privacy'));
router.get('/privacy-policy', (req, res) => res.redirect(301, '/legal/privacy'));
router.get('/delete-account', send(DELETE, '/legal/delete-account'));

module.exports = router;
