const iconv = require('iconv-lite');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FORUM_BASE = process.env.FORUM_BASE_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const GROUP_SIZE = 1;
const RATE_PER_GROUP_POSTS    = 1;
const RATE_PER_GROUP_RESPECT  = 1;
const RATE_PER_GROUP_POSITIVE = 1;

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml'
};

async function fetchDecoded(url) {
  const r = await fetch(url, { cache: 'no-store', redirect: 'follow', headers: COMMON_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = await r.arrayBuffer();
  return iconv.decode(Buffer.from(buf), 'win1251');
}

async function getPostCount(uid) {
  const html = await fetchDecoded(`${FORUM_BASE}/profile.php?id=${uid}`);
  const m = html.match(/id="pa-posts"[\s\S]{0,200}?(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

async function getBracketNumber(url) {
  const html = await fetchDecoded(url);
  const m = html.match(/\[([+\-]?\d+)\]/);
  return m ? parseInt(m[1], 10) : 0;
}

function creditFromMilestone(current, milestone, ratePerGroup) {
  if (current <= milestone) return { newMilestone: milestone, add: 0 };
  const steps = Math.floor((current - milestone) / GROUP_SIZE);
  if (steps <= 0) return { newMilestone: milestone, add: 0 };
  return { newMilestone: milestone + steps * GROUP_SIZE, add: steps * ratePerGroup };
}

// --- прямые REST-вызовы к Supabase, без библиотеки supabase-js ---
async function sbSelect(uid) {
  const url = `${SUPABASE_URL}/rest/v1/users?profile_id=eq.${uid}&select=*`;
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase select HTTP ${r.status}: ${text}`);
  const arr = JSON.parse(text);
  return arr[0] || null;
}

async function sbUpsert(row) {
  const url = `${SUPABASE_URL}/rest/v1/users`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase upsert HTTP ${r.status}: ${text}`);
  return text;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  try {
    const { user_id, secret } = req.body || {};
    if (secret !== WEBHOOK_SECRET) { res.status(401).json({ error: 'bad secret' }); return; }
    if (!user_id) { res.status(400).json({ error: 'user_id required' }); return; }

    const uid = Number(user_id);

    const posts = await getPostCount(uid);
    const respect = await getBracketNumber(`${FORUM_BASE}/respect.php?id=${uid}`);
    const positive = await getBracketNumber(`${FORUM_BASE}/positive.php?id=${uid}`);

    let row = await sbSelect(uid);
    if (!row) {
      row = { profile_id: uid, money: 0, posts_milestone: 0, respect_milestone: 0, positive_milestone: 0, ads_milestone: 0, game_milestone: 0 };
    }

    const postsResult    = creditFromMilestone(posts,    row.posts_milestone    || 0, RATE_PER_GROUP_POSTS);
    const respectResult  = creditFromMilestone(respect,  row.respect_milestone  || 0, RATE_PER_GROUP_RESPECT);
    const positiveResult = creditFromMilestone(positive, row.positive_milestone || 0, RATE_PER_GROUP_POSITIVE);

    const totalAdd = postsResult.add + respectResult.add + positiveResult.add;
    const newMoney = (row.money || 0) + totalAdd;

    await sbUpsert({
      profile_id: uid,
      money: newMoney,
      posts_milestone: postsResult.newMilestone,
      respect_milestone: respectResult.newMilestone,
      positive_milestone: positiveResult.newMilestone,
      ads_milestone: row.ads_milestone || 0,
      game_milestone: row.game_milestone || 0
    });

    res.status(200).json({ ok: true, posts, respect, positive, added: totalAdd, money: newMoney });

  } catch (e) {
    console.error('FATAL ERROR:', e && e.stack ? e.stack : e);
    res.status(500).json({
      error: e.message,
      stack: (e.stack || '').split('\n').slice(0, 5)
    });
  }
};
