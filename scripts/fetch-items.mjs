import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIST_URL = "https://www.dota2.com/datafeed/itemlist?language=english";
const DATA_URL = "https://www.dota2.com/datafeed/itemdata?language=english&item_id=";
const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../data/items.json");
const CONCURRENCY = 10;
const MAX_ATTEMPTS = 4;

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function fetchJson(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "dota-inventory-networth-data-refresh/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= MAX_ATTEMPTS) throw error;
    await wait(500 * 2 ** (attempt - 1));
    return fetchJson(url, attempt + 1);
  }
}

function normalizeTier(value) {
  return Number.isInteger(value) && value >= 0 && value < 10 ? value : -1;
}

function normalizeItem(listItem, detail, order) {
  const internalName = String(detail.name || listItem.name || "");
  const recipe = internalName.startsWith("item_recipe");

  return {
    id: Number(listItem.id),
    name: internalName,
    nameLocalized: String(detail.name_loc || listItem.name_loc || internalName.replace(/^item_/, "")),
    cost: Math.max(0, Number(detail.item_cost) || 0),
    neutralTier: normalizeTier(listItem.neutral_item_tier ?? detail.item_neutral_tier),
    quality: Number(detail.item_quality) || 0,
    recipe,
    order,
  };
}

async function loadExisting() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  console.log("Fetching the official Dota 2 item list…");
  const listPayload = await fetchJson(LIST_URL);
  const listItems = listPayload?.result?.data?.itemabilities;
  if (!Array.isArray(listItems) || listItems.length === 0) {
    throw new Error("The item list response did not contain any items");
  }

  const results = new Array(listItems.length);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < listItems.length) {
      const index = cursor;
      cursor += 1;
      const listItem = listItems[index];
      const detailPayload = await fetchJson(`${DATA_URL}${encodeURIComponent(listItem.id)}`);
      const detail = detailPayload?.result?.data?.items?.[0];

      if (!detail || detail.is_item === false) {
        results[index] = null;
      } else {
        results[index] = normalizeItem(listItem, detail, index);
      }

      completed += 1;
      if (completed % 50 === 0 || completed === listItems.length) {
        console.log(`Fetched ${completed}/${listItems.length} item records`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const items = results
    .filter(Boolean)
    .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.nameLocalized)
    .filter((item, index, collection) => collection.findIndex((candidate) => candidate.id === item.id) === index);

  if (items.length < 300) {
    throw new Error(`Only ${items.length} valid items were returned; refusing to replace the snapshot`);
  }

  const existing = await loadExisting();
  if (existing && JSON.stringify(existing.items) === JSON.stringify(items)) {
    console.log(`No item changes detected (${items.length} records).`);
    return;
  }

  const snapshot = {
    meta: {
      updatedAt: new Date().toISOString(),
      source: LIST_URL,
      count: items.length,
    },
    items,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`Wrote ${items.length} items to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
