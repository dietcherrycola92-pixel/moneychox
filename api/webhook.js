module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const results = {};

  // Тест 1: можем ли вообще выйти в интернет (заведомо рабочий сайт)
  try {
    const r1 = await fetch('https://api.github.com');
    results.github = { ok: r1.ok, status: r1.status };
  } catch (e) {
    results.github = { error: e.message };
  }

  // Тест 2: конкретно rusff.me
  try {
    const r2 = await fetch('https://noctratest.rusff.me/profile.php?id=3');
    results.rusff = { ok: r2.ok, status: r2.status };
  } catch (e) {
    results.rusff = { error: e.message };
  }

  // Тест 3: rusff.me с User-Agent
  try {
    const r3 = await fetch('https://noctratest.rusff.me/profile.php?id=3', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    results.rusff_with_ua = { ok: r3.ok, status: r3.status };
  } catch (e) {
    results.rusff_with_ua = { error: e.message };
  }

  res.status(200).json(results);
};
