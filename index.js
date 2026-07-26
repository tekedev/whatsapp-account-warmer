"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

// ======== Configuration ========
const CONFIG = {
  // IMPORTANT: Replace with real E.164 numbers WITHOUT the leading +, e.g. "905321112233"
  phoneA: process.env.WA_PHONE_A || "905000000001",
  phoneB: process.env.WA_PHONE_B || "905000000002",
  // Persistent profiles to avoid repeated QR scans
  userDataDirA: path.resolve(__dirname, "user-data/accountA"),
  userDataDirB: path.resolve(__dirname, "user-data/accountB"),
  headless: false, // WhatsApp Web requires a visible browser for QR scanning
  // Daily exchange limits (one exchange = A sends, B replies)
  dailyMinExchanges: 30,
  dailyMaxExchanges: 50,
  // Delays
  betweenMsgMinSec: 10,
  betweenMsgMaxSec: 60,
  betweenExchangesMinSec: 120, // add natural gaps between exchanges
  betweenExchangesMaxSec: 600,
  // Probability that B uses a short reply (0.0 - 1.0)
  shortReplyChance: 0.35,
};

// Ensure user-data directories exist
fs.mkdirSync(CONFIG.userDataDirA, { recursive: true });
fs.mkdirSync(CONFIG.userDataDirB, { recursive: true });

// ======== Helpers ========
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => Math.random() * (max - min) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ======== Message pool generation (≈400 items) ========
function buildMessagePool() {
  const starters = [
    "Merhaba", "Selam", "Günaydın", "İyi akşamlar", "Naber?", "Ne var ne yok?", "Günaydın :)", "Selamlar", "Hey!", "Hoş geldin",
    "Nasıl gidiyor?", "Bugün nasılsın?", "Orada mısın?", "Müsait misin?", "Vaktin var mı?", "Uygun olduğunda yaz", "Hadi konuşalım",
    "Yo!", "Selammm", "Alo?", "Burada mısın?", "Günaydınn", "Uyanık mısın?", "Mola var mı?", "Toplantın bitti mi?"
  ];
  const middles = [
    "kahve içiyorum", "çalışıyorum", "dışarı çıkacağım", "yoldayım", "evdeyim", "spordayım", "marketten geliyorum", "müzik dinliyorum",
    "film izliyorum", "bir şeyler atıştırıyorum", "oyun oynuyorum", "yemek yapıyorum", "dinleniyorum", "kitap okuyorum", "hava güzel",
    "hava kapalı", "yağmur yağıyor", "güneş açtı", "trafik fena", "moralim iyi", "biraz yorgunum", "enerjim yüksek", "işler yoğun",
    "bugün sakin", "keyfim yerinde", "ufak bir mola", "toplantıdayım", "az sonra müsaitim", "mesaj attım", "bir şey soracaktım"
  ];
  const endings = [
    "sen ne yapıyorsun?", "haber ver", "müsaitsen ara", "görüşürüz", "tamam mı?", "nasıl olsun?", "harika!", "süper!", "olur",
    "uygun mu?", "şahane", "teşekkürler", "görüşmek üzere", "bekliyorum", "sonra konuşalım", "bakar mısın?", "haberleşiriz",
    "ayarlayalım", "hallederiz", "bir ara yapalım", "ne dersin?", "uyar", "olabilir", "mantıklı", "not ettim"
  ];
  const emojis = [
    "😊", "👍", "🙌", "😂", "😅", "😉", "🔥", "✨", "💪", "👌", "🤙", "🙏", "🎉", "🥳", "☕", "🍀", "🌞", "🌧️", "🚀"
  ];

  const fixedShorts = [
    "Tamam", "Olur", "Süper", "Harika", "Aynen", "Tabii", "Olmaz", "Belki", "Evet", "Hayır",
    "Kanka", "Tamamdır", "Şahane", "Sıkıntı yok", "Yapılır", "Bakarız", "Güzel", "Mükemmel", "Okey",
    "😂", "👍", "🙌", "😉", "👌", "🤙", "🙏"
  ];

  const pool = new Set();
  // Seed with fixed short ones too (kept for consistency across runs)
  fixedShorts.forEach((s) => pool.add(s));

  // Generate combinations until we reach ~400
  while (pool.size < 400) {
    const s = `${pick(starters)} ${pick(middles)}, ${pick(endings)} ${Math.random() < 0.7 ? pick(emojis) : ""}`.trim();
    pool.add(s);
  }

  return { messages: Array.from(pool), shortReplies: fixedShorts };
}

const MESSAGE_POOLS = buildMessagePool();

// ======== WhatsApp helpers ========
async function waitForLogin(page, label) {
  // Keep prompting user via console until chat UI appears.
  // Avoid localized aria-labels; rely on stable testids/roles.
  const candidates = [
    'div[data-testid="chat-list"]',
    'div[data-testid="pane-side"]',
    'header [data-testid="menu-bar-apps"]',
    'div[data-testid="conversation-panel-wrapper"]',
    'main[role="main"] div[role="grid"]',
    // composer presence also implies logged-in
    '[data-testid="conversation-compose-box-input"] div[contenteditable="true"]',
    'footer div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-tab]'
  ];
  const qrSelectors = [
    'canvas[aria-label*="Scan" i]',
    'div[data-testid="qrcode"]',
  ];
  const useHereSelectors = [
    '[data-testid="resume-app"]',
    'button:has-text("Use here")',
    'button:has-text("Use Here")',
    'button:has-text("Burada kullan")'
  ];

  const start = Date.now();
  let lastReload = 0;
  while (true) {
    // Try to click "Use here" prompt if present (multi-device takeover)
    for (const s of useHereSelectors) {
      const btn = await page.$(s).catch(() => null);
      if (btn) {
        await btn.click().catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
      }
    }

    // If QR is visible, still not logged in.
    let qrVisible = false;
    for (const q of qrSelectors) {
      const qr = await page.$(q).catch(() => null);
      if (qr) { qrVisible = true; break; }
    }
    if (qrVisible) {
      console.log(`[${label}] Waiting for login (QR visible). Please scan.`);
      await sleep(4000);
      continue;
    }

    // Check for logged-in UI
    for (const sel of candidates) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        console.log(`[${label}] Logged-in UI detected.`);
        return;
      }
    }

    // Occasionally WhatsApp sticks on the home shell; try a gentle reload.
    const now = Date.now();
    if (now - start > 15000 && now - lastReload > 15000) {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      lastReload = now;
    }

    console.log(`[${label}] Waiting for login... If QR code shows, scan it. Sessions persist in user-data.`);
    await sleep(4000);
  }
}

async function openChatByPhone(page, phone, label) {
  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await waitForLogin(page, label);
  // After login, force-open the chat again (WhatsApp may leave you on home).
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  // Wait for composer to be ready
  const box = await waitForMessageBox(page, label);
  if (!box) throw new Error(`[${label}] Unable to find message box.`);
  // Small extra delay to ensure chat is fully hydrated
  await sleep(randInt(500, 1500));
}

async function waitForMessageBox(page, label) {
  const candidates = [
    '[data-testid="conversation-compose-box-input"] div[contenteditable="true"]',
    'footer div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-tab]' // fallback
  ];
  const timeoutMs = 60000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of candidates) {
      const handle = await page.$(sel).catch(() => null);
      if (handle) return handle;
    }
    await sleep(500);
  }
  console.warn(`[${label}] message box not found within ${timeoutMs}ms`);
  return null;
}

async function typeLikeHuman(page, text) {
  const perCharDelay = randInt(20, 120);
  await page.keyboard.type(text, { delay: perCharDelay });
}

async function sendMessage(page, text, label) {
  const box = await waitForMessageBox(page, label);
  if (!box) throw new Error(`[${label}] Message box missing.`);
  await box.click({ delay: randInt(10, 60) });
  await typeLikeHuman(page, text);
  await page.keyboard.press("Enter");
  console.log(`[${label}] SENT: ${text}`);
}

async function getLastIncomingText(page) {
  // Attempt to read last incoming bubble text
  const sel = 'div.message-in span.selectable-text, div.message-in span[dir="auto"]';
  const texts = await page.$$eval(sel, nodes => nodes.map(n => n.textContent || "").filter(Boolean)).catch(() => []);
  return texts?.length ? texts[texts.length - 1] : null;
}

async function getLastOutgoingText(page) {
  const sel = 'div.message-out span.selectable-text, div.message-out span[dir="auto"]';
  const texts = await page.$$eval(sel, nodes => nodes.map(n => n.textContent || "").filter(Boolean)).catch(() => []);
  return texts?.length ? texts[texts.length - 1] : null;
}

function msUntilNextLocalMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function validatePhones() {
  const numA = (CONFIG.phoneA || "").replace(/\D/g, "");
  const numB = (CONFIG.phoneB || "").replace(/\D/g, "");
  if (numA.length < 8 || numB.length < 8) {
    console.warn("[WARN] Configure valid WA_PHONE_A and WA_PHONE_B (E.164 without +). Using placeholders.");
  }
}

async function main() {
  validatePhones();

  console.log("Launching persistent contexts...");
  const contextA = await chromium.launchPersistentContext(CONFIG.userDataDirA, {
    headless: CONFIG.headless,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const contextB = await chromium.launchPersistentContext(CONFIG.userDataDirB, {
    headless: CONFIG.headless,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const pageA = contextA.pages()[0] || await contextA.newPage();
  const pageB = contextB.pages()[0] || await contextB.newPage();

  // Open WhatsApp and ensure chats are open on both sides
  await Promise.all([
    openChatByPhone(pageA, CONFIG.phoneB, "A"),
    openChatByPhone(pageB, CONFIG.phoneA, "B"),
  ]);

  let exchangesToday = 0;
  let todayTarget = randInt(CONFIG.dailyMinExchanges, CONFIG.dailyMaxExchanges);
  console.log(`[SYSTEM] Daily target exchanges: ${todayTarget}`);

  process.on("SIGINT", async () => {
    console.log("\n[SHUTDOWN] Closing browsers...");
    await Promise.allSettled([contextA.close(), contextB.close()]);
    process.exit(0);
  });

  while (true) {
    // Reset at local midnight
    if (exchangesToday >= todayTarget) {
      const ms = msUntilNextLocalMidnight() + randInt(30_000, 300_000); // +0.5–5min jitter
      console.log(`[SYSTEM] Daily limit hit (${exchangesToday}/${todayTarget}). Sleeping ${(ms/3600000).toFixed(2)}h until next day...`);
      await sleep(ms);
      exchangesToday = 0;
      todayTarget = randInt(CONFIG.dailyMinExchanges, CONFIG.dailyMaxExchanges);
      console.log(`[SYSTEM] New day. New target exchanges: ${todayTarget}`);
    }

    // A -> B
    const msgA = pick(MESSAGE_POOLS.messages);
    await sendMessage(pageA, msgA, "A->B");

    // Log that B received it (from B's perspective)
    await sleep(randInt(1200, 2500));
    const lastInOnB = await getLastIncomingText(pageB);
    if (lastInOnB) console.log(`[B RECEIVED] ${lastInOnB}`);

    // Random wait before B replies
    await sleep(randInt(CONFIG.betweenMsgMinSec, CONFIG.betweenMsgMaxSec) * 1000);

    // B -> A
    const useShort = Math.random() < CONFIG.shortReplyChance;
    const replyB = useShort ? pick(MESSAGE_POOLS.shortReplies) : pick(MESSAGE_POOLS.messages);
    await sendMessage(pageB, replyB, "B->A");

    // Log that A received it
    await sleep(randInt(1200, 2500));
    const lastInOnA = await getLastIncomingText(pageA);
    if (lastInOnA) console.log(`[A RECEIVED] ${lastInOnA}`);

    exchangesToday += 1;

    // Random wait before the next exchange cycle
    const gap = randInt(CONFIG.betweenExchangesMinSec, CONFIG.betweenExchangesMaxSec);
    console.log(`[SYSTEM] Waiting ${(gap/60).toFixed(1)} minutes before next exchange (${exchangesToday}/${todayTarget})...`);
    await sleep(gap * 1000);
  }
}

main().catch(async (err) => {
  console.error("[FATAL]", err);
  process.exitCode = 1;
});
