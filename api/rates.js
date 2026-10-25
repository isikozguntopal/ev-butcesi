// Vercel fonksiyonu: TCMB dolar/euro satış kuru + gram altın (Truncgil).
// TCMB tarayıcıdan doğrudan okunamadığı (CORS) için kurlar buradan geçer.

const parseTr = s => Number(String(s).replace(/\./g, '').replace(',', '.'));

async function tcmb() {
  const xml = await (await fetch('https://www.tcmb.gov.tr/kurlar/today.xml')).text();
  const rate = code => {
    const m = xml.match(new RegExp(`CurrencyCode="${code}"[\\s\\S]*?<ForexSelling>([^<]*)</ForexSelling>`));
    return m ? Number(m[1]) : null;
  };
  const date = (xml.match(/Tarih="([^"]+)"/) || [])[1] || null;
  return { usd: rate('USD'), eur: rate('EUR'), date };
}

async function gold() {
  const d = await (await fetch('https://finans.truncgil.com/today.json')).json();
  return { gold: parseTr(d['gram-altin']?.['Satış']), goldDate: d.Update_Date || null };
}

module.exports = async (req, res) => {
  const [a, b] = await Promise.allSettled([tcmb(), gold()]);
  const out = {
    ...(a.status === 'fulfilled' ? a.value : { usd: null, eur: null, date: null }),
    ...(b.status === 'fulfilled' ? b.value : { gold: null, goldDate: null }),
  };
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.status(out.usd || out.gold ? 200 : 502).json(out);
};
