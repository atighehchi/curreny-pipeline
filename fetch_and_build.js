// fetch_and_build.js
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const symbols = ["USD", "EUR", "AED", "CNY"];

// Helper: format numbers with Persian locale, no decimals
function fmt(num) {
  if (num === null || num === undefined || isNaN(num)) return "-";
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(num);
}

// 1. Fetch JSON data (بازار آزاد)
async function fetchJSON() {
  const url = "https://BrsApi.ir/Api/Market/Gold_Currency.php?key=BqCG4aT1faFTRK5ZCnGZYJBP83WqiSKv";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json"
    }
  });
  if (!res.ok) throw new Error(`JSON fetch failed: ${res.status}`);
  const data = await res.json();

  const out = {};
  if (data?.currency) {
    for (const item of data.currency) {
      const symbol = item.symbol.toUpperCase();
      if (symbols.includes(symbol)) {
        out[symbol] = {
          price: item.price,
          name: item.name_en
        };
      }
    }
  }
  return out;
}

// 2. Fetch HTML table (CBI site)
async function fetchHTML() {
  const url = "https://fxmarketrate.cbi.ir/";
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.5"
    }
  });
  if (!res.ok) throw new Error(`HTML fetch failed: ${res.status}`);
  return await res.text();
}

// 3. Parse HTML table
function parseHTML(html) {
  const $ = cheerio.load(html);
  const rows = $("#MainContent_ViewCashChequeRates_divCash table tbody tr");
  const map = {};

  rows.each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length >= 6) {
      const code = $(tds[1]).text().trim().toUpperCase();
      if (symbols.includes(code)) {
        const toNum = (s) => {
          const raw = s.replace(/,/g, "").trim();
          if (!raw) return null;
          return parseInt(raw, 10) / 10; // site values are ×10
        };
        map[code] = {
          "نرخ خرید": fmt(toNum($(tds[2]).text())),
          "نرخ فروش": fmt(toNum($(tds[3]).text())),
          "نرخ خرید حواله": fmt(toNum($(tds[4]).text())),
          "نرخ فروش حواله": fmt(toNum($(tds[5]).text()))
        };
      }
    }
  });

  return map;
}

// 4. Main pipeline
async function main() {
  try {
    const [jsonData, html] = await Promise.all([fetchJSON(), fetchHTML()]);
    const htmlData = parseHTML(html);

    const output = {};
    for (const code of symbols) {
      const freeRaw = jsonData?.[code]?.price ?? "-";
      const free = typeof freeRaw === "number" ? fmt(freeRaw) : freeRaw;

      output[code] = {
        "بازار آزاد": free,
        ...htmlData[code]
      };
    }

    // Print JSON to stdout
    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Pipeline error:", err.message);
    process.exit(1);
  }
}

main();
