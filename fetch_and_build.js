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

// 2. Fetch HTML table (TGJU site)
async function fetchHTML() {
  const url = "https://bonashub.com/temp_iccc_bj_prices/ice_prices.php";
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7",
      "Referer": "https://www.tgju.org/",
      "Connection": "keep-alive"
    }
  });
  if (!res.ok) throw new Error(`HTML fetch failed: ${res.status}`);
  return await res.text();
}

// 3. Parse HTML table
function parseHTML(html) {
  const $ = cheerio.load(html);
  const map = {};

  // Persian headings we care about
  const categories = {
    "فروش ( اسکناس )": "نرخ فروش (اسکناس)",
    "خرید ( اسکناس )": "نرخ خرید (اسکناس)",
    "فروش ( حواله )": "نرخ فروش (حواله)",
    "خرید ( حواله )": "نرخ خرید (حواله)"
  };

  // Loop over each table
  $("table.data-table.market-table").each((_, table) => {
    const heading = $(table).find("thead th").first().text().trim();
    if (categories[heading]) {
      const label = categories[heading];

      $(table)
        .find("tbody tr")
        .each((__, tr) => {
          const codeAttr = $(tr).attr("data-market-nameslug") || "";
          let code = null;
          if (codeAttr.includes("usd")) code = "USD";
          else if (codeAttr.includes("eur")) code = "EUR";
          else if (codeAttr.includes("aed")) code = "AED";
          else if (codeAttr.includes("cny")) code = "CNY";

          if (code) {
            const priceStr =
              $(tr).attr("data-price") ||
              $(tr).find("td.nf").first().text().trim();
            const num = parseInt(priceStr.replace(/,/g, ""), 10);
            const value = Math.round(num / 10); // plain integer, English digits
            if (!map[code]) map[code] = {};
            map[code][label] = value; // store as number
          }
        });
    }
  });

  return map;
}

// 4. Main pipeline
import fs from "fs";

async function main() {
  try {
    const [jsonData, html] = await Promise.all([fetchJSON(), fetchHTML()]);
    const htmlData = parseHTML(html);

    // --- load yesterday’s JSON if exists ---
    let yesterday = {};
    try {
      const prev = fs.readFileSync("public/prices.json", "utf8");
      yesterday = JSON.parse(prev);
    } catch (e) {}

    const output = {};
    for (const code of symbols) {
      // بازار آزاد as plain number
      const freeRaw = jsonData?.[code]?.price ?? null;
      const free = typeof freeRaw === "number" ? Math.round(freeRaw) : null;

      output[code] = {
        "بازار آزاد": free,
        ...htmlData[code]   // htmlData already stores numbers now
      };

      // --- compare all 5 prices ---
      const labels = [
        "بازار آزاد",
        "نرخ خرید (اسکناس)",
        "نرخ فروش (اسکناس)",
        "نرخ خرید (حواله)",
        "نرخ فروش (حواله)"
      ];

      for (const label of labels) {
        const prevNum = yesterday?.[code]?.[label];
        const currNum = output[code]?.[label];

        if (typeof prevNum === "number" && typeof currNum === "number") {
          if (currNum > prevNum) {
            output[code][`${label} تغییر`] = "⬆️";
          } else if (currNum < prevNum) {
            output[code][`${label} تغییر`] = "⬇️";
          } else {
            output[code][`${label} تغییر`] = "➖";
          }
        } else {
          output[code][`${label} تغییر`] = "!";
        }
      }
    }

    // --- write new JSON ---
    fs.writeFileSync("public/prices.json", JSON.stringify(output, null, 2), "utf8");
    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Pipeline error:", err.message);
    process.exit(1);
  }
}

main();
