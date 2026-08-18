import { decodeInventory, encodeInventory } from "./codec.js";

const MAX_SLOTS = 9;
const MAIN_SLOTS = 6;
const MAX_INVENTORIES = 9;
const MIN_ITEM_COST = 50;
const CONSUMED_UPGRADE_IDS = [271, 609, 247];
const CONSUMED_UPGRADE_SET = new Set(CONSUMED_UPGRADE_IDS);
const IMAGE_BASE = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/";
const PRICE_FORMATTER = new Intl.NumberFormat("en-US");

const elements = {
  search: document.querySelector("#item-search"),
  searchShell: document.querySelector("#search-shell"),
  searchResults: document.querySelector("#search-results"),
  feedStatus: document.querySelector("#feed-status"),
  inventoryList: document.querySelector("#inventory-list"),
  addInventory: document.querySelector("#add-inventory"),
  shareAll: document.querySelector("#share-all"),
  sort: document.querySelector("#item-sort"),
  catalogCount: document.querySelector("#catalog-result-count"),
  itemGrid: document.querySelector("#item-grid"),
  helpToggle: document.querySelector("#help-toggle"),
  helpDialog: document.querySelector("#help-dialog"),
  helpClose: document.querySelector("#help-close"),
  toast: document.querySelector("#toast"),
};

function createEmptyInventory() {
  return {
    slots: Array(MAX_SLOTS).fill(null),
    upgrades: [],
    sequence: 0,
  };
}

const state = {
  items: [],
  itemsById: new Map(),
  inventories: [createEmptyInventory()],
  activeInventoryIndex: 0,
  activeSearchIndex: -1,
  searchMatches: [],
  drag: null,
};

let toastTimeout;
let copyResetTimeout;

function activeInventory() {
  return state.inventories[state.activeInventoryIndex];
}

function formatPrice(value) {
  return PRICE_FORMATTER.format(Math.max(0, Number(value) || 0));
}

function normalizeSearch(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function itemLabel(item) {
  return item.displayName || item.nameLocalized;
}

function imageUrl(item) {
  const slug = item.name.replace(/^item_/, "");
  return `${IMAGE_BASE}${encodeURIComponent(slug)}.png`;
}

function initials(item) {
  return itemLabel(item)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

function qualityColor(item) {
  return {
    1: "#9ca8b8",
    2: "#7aa5c9",
    3: "#a486c9",
    4: "#d18b55",
  }[item.quality] || "#f08a43";
}

function createImage(item, loading = "lazy") {
  const wrapper = document.createElement("span");
  wrapper.className = "item-image-wrap";

  const fallback = document.createElement("span");
  fallback.className = "item-fallback";
  fallback.textContent = initials(item);
  wrapper.append(fallback);

  const image = document.createElement("img");
  image.src = imageUrl(item);
  image.alt = "";
  image.loading = loading;
  image.decoding = "async";
  image.addEventListener("error", () => image.classList.add("is-broken"), { once: true });
  wrapper.append(image);
  return wrapper;
}

function createPrice(value, className) {
  const price = document.createElement("span");
  price.className = className;
  const coin = document.createElement("i");
  coin.className = "coin-dot";
  coin.setAttribute("aria-hidden", "true");
  price.append(coin, document.createTextNode(formatPrice(value)));
  return price;
}

function showToast(message) {
  clearTimeout(toastTimeout);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimeout = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

function inventoryItems(inventory) {
  const slotItems = inventory.slots
    .filter(Boolean)
    .map((slot) => state.itemsById.get(slot.itemId))
    .filter(Boolean);
  const upgradeItems = inventory.upgrades
    .map((upgrade) => state.itemsById.get(upgrade.itemId))
    .filter(Boolean);
  return [...slotItems, ...upgradeItems];
}

function inventoryTotal(inventory) {
  return inventoryItems(inventory).reduce((sum, item) => sum + item.cost, 0);
}

function inventoryPayload(inventory) {
  const lastFilledIndex = inventory.slots.findLastIndex(Boolean);
  const compactSlots = lastFilledIndex < 0
    ? []
    : inventory.slots.slice(0, lastFilledIndex + 1).map((slot) => slot?.itemId || 0);
  if (!inventory.upgrades.length) return compactSlots;
  return [
    ...inventory.slots.map((slot) => slot?.itemId || 0),
    ...CONSUMED_UPGRADE_IDS.filter((id) => inventory.upgrades.some((upgrade) => upgrade.itemId === id)),
  ];
}

function shareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("i");
  url.searchParams.delete("b");
  url.searchParams.delete("a");

  if (state.inventories.length === 1) {
    const payload = inventoryPayload(state.inventories[0]);
    if (payload.length) url.searchParams.set("i", encodeInventory(payload));
  } else {
    url.searchParams.set(
      "b",
      state.inventories.map((inventory) => encodeInventory(inventoryPayload(inventory))).join("."),
    );
    url.searchParams.set("a", String(state.activeInventoryIndex + 1));
  }
  return url;
}

function updateUrl() {
  window.history.replaceState(null, "", shareUrl());
}

function markActiveInventory() {
  elements.inventoryList.querySelectorAll(".comparison-card").forEach((card, index) => {
    const active = index === state.activeInventoryIndex;
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-current", active ? "true" : "false");
  });
}

function selectInventory(index) {
  if (index < 0 || index >= state.inventories.length) return;
  state.activeInventoryIndex = index;
  markActiveInventory();
  updateUrl();
}

function addInventory() {
  if (state.inventories.length >= MAX_INVENTORIES) {
    showToast("You can compare up to nine inventories.");
    return;
  }
  state.inventories.push(createEmptyInventory());
  state.activeInventoryIndex = state.inventories.length - 1;
  renderInventories();
  showToast(`New inventory added. It is selected with Alt+${state.activeInventoryIndex + 1}.`);
}

function removeInventory(index) {
  if (state.inventories.length === 1) return;
  state.inventories.splice(index, 1);
  if (state.activeInventoryIndex > index) state.activeInventoryIndex -= 1;
  state.activeInventoryIndex = Math.min(state.activeInventoryIndex, state.inventories.length - 1);
  renderInventories();
  showToast("Inventory removed.");
}

function clearInventory(index) {
  const inventory = state.inventories[index];
  if (!inventory || (!inventory.slots.some(Boolean) && !inventory.upgrades.length)) return;
  inventory.slots = Array(MAX_SLOTS).fill(null);
  inventory.upgrades = [];
  renderInventories();
  showToast("Inventory cleared.");
}

function focusSearch(select = false) {
  elements.search.focus({ preventScroll: true });
  if (select) elements.search.select();
}

function createIconButton(className, label, symbol, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = symbol;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function removeFromSlot(inventoryIndex, slotIndex) {
  const inventory = state.inventories[inventoryIndex];
  const slot = inventory?.slots[slotIndex];
  if (!slot) return;
  const item = state.itemsById.get(slot.itemId);
  inventory.slots[slotIndex] = null;
  renderInventories();
  if (item) showToast(`${itemLabel(item)} removed.`);
}

function removeUpgrade(inventoryIndex, itemId) {
  const inventory = state.inventories[inventoryIndex];
  const item = state.itemsById.get(itemId);
  if (!inventory) return;
  inventory.upgrades = inventory.upgrades.filter((upgrade) => upgrade.itemId !== itemId);
  renderInventories();
  if (item) showToast(`${itemLabel(item)} removed.`);
}

function addUpgrade(itemId, inventoryIndex = state.activeInventoryIndex) {
  const inventory = state.inventories[inventoryIndex];
  const item = state.itemsById.get(itemId);
  if (!inventory || !item) return;
  if (inventory.upgrades.some((upgrade) => upgrade.itemId === itemId)) {
    showToast(`${itemLabel(item)} is already consumed in this inventory.`);
    return;
  }
  inventory.sequence += 1;
  inventory.upgrades.push({ itemId, sequence: inventory.sequence });
  renderInventories();
}

function toggleUpgrade(inventoryIndex, itemId) {
  const inventory = state.inventories[inventoryIndex];
  if (inventory.upgrades.some((upgrade) => upgrade.itemId === itemId)) {
    removeUpgrade(inventoryIndex, itemId);
  } else {
    state.activeInventoryIndex = inventoryIndex;
    addUpgrade(itemId, inventoryIndex);
  }
}

function createInventorySlot(inventory, inventoryIndex, slotIndex) {
  const slotData = inventory.slots[slotIndex];
  const backpack = slotIndex >= MAIN_SLOTS;
  const slot = document.createElement("div");
  slot.className = `inventory-slot ${slotData ? "is-filled" : "is-empty"}${backpack ? " is-backpack" : ""}`;
  slot.dataset.inventoryIndex = inventoryIndex;
  slot.dataset.slotIndex = slotIndex;
  slot.tabIndex = 0;

  const number = document.createElement("span");
  number.className = "slot-number";
  number.textContent = backpack ? `B${slotIndex - MAIN_SLOTS + 1}` : String(slotIndex + 1).padStart(2, "0");
  slot.append(number);

  if (!slotData) {
    slot.setAttribute("role", "button");
    slot.setAttribute("aria-label", `Empty ${backpack ? "backpack" : "inventory"} slot. Focus item search.`);
    const emptyCopy = document.createElement("span");
    emptyCopy.className = "empty-slot-copy";
    emptyCopy.textContent = "Empty slot";
    slot.append(emptyCopy);
    slot.addEventListener("click", () => {
      selectInventory(inventoryIndex);
      focusSearch();
    });
  } else {
    const item = state.itemsById.get(slotData.itemId);
    if (!item) return slot;
    slot.setAttribute(
      "aria-label",
      `${itemLabel(item)}, ${formatPrice(item.cost)} gold${backpack ? ", in backpack" : ""}.`,
    );
    slot.style.setProperty("--quality-color", qualityColor(item));

    const slotItem = document.createElement("div");
    slotItem.className = "slot-item";
    const visual = document.createElement("div");
    visual.className = "slot-visual";
    visual.append(createImage(item, "eager"));

    const details = document.createElement("div");
    details.className = "slot-details";
    const name = document.createElement("span");
    name.className = "slot-name";
    name.textContent = itemLabel(item);
    details.append(name, createPrice(item.cost, "slot-price"));
    visual.append(details);

    const quality = document.createElement("div");
    quality.className = "slot-quality";
    slotItem.append(visual, quality);

    const remove = createIconButton("remove-item", `Remove ${itemLabel(item)}`, "×", () => {
      removeFromSlot(inventoryIndex, slotIndex);
    });
    remove.addEventListener("pointerdown", (event) => event.stopPropagation());
    slot.append(slotItem, remove);

    slotItem.addEventListener("pointerdown", (event) => {
      selectInventory(inventoryIndex);
      startPointerDrag(event, inventoryIndex, slotIndex, item);
    });
    slot.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      removeFromSlot(inventoryIndex, slotIndex);
    });
  }

  slot.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      removeFromSlot(inventoryIndex, slotIndex);
    } else if (!slotData && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectInventory(inventoryIndex);
      focusSearch();
    }
  });
  return slot;
}

function createUpgradeSlot(inventory, inventoryIndex, itemId) {
  const item = state.itemsById.get(itemId);
  if (!item) return null;
  const owned = inventory.upgrades.some((upgrade) => upgrade.itemId === itemId);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `consumed-upgrade${owned ? " is-owned" : ""}`;
  button.title = `${owned ? "Remove" : "Consume"} ${itemLabel(item)} (${formatPrice(item.cost)} gold)`;
  button.setAttribute("aria-label", button.title);
  button.append(createImage(item, "eager"));

  const status = document.createElement("span");
  status.className = "upgrade-status";
  status.textContent = owned ? "✓" : "+";
  button.append(status);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    selectInventory(inventoryIndex);
    toggleUpgrade(inventoryIndex, itemId);
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (owned) removeUpgrade(inventoryIndex, itemId);
  });
  return button;
}

function createInventoryCard(inventory, inventoryIndex) {
  const card = document.createElement("article");
  const active = inventoryIndex === state.activeInventoryIndex;
  card.className = `inventory-card comparison-card panel${active ? " is-active" : ""}`;
  card.dataset.inventoryIndex = inventoryIndex;
  card.setAttribute("aria-current", active ? "true" : "false");
  card.setAttribute("aria-label", `Inventory ${inventoryIndex + 1}, ${formatPrice(inventoryTotal(inventory))} gold`);
  card.addEventListener("pointerdown", () => selectInventory(inventoryIndex));

  const tools = document.createElement("div");
  tools.className = "inventory-card-tools";
  const hotkey = document.createElement("kbd");
  hotkey.textContent = `Alt+${inventoryIndex + 1}`;
  tools.append(hotkey);
  tools.append(createIconButton("card-icon-button", "Clear inventory", "↺", () => clearInventory(inventoryIndex)));
  if (state.inventories.length > 1) {
    tools.append(createIconButton("card-icon-button danger", "Remove inventory", "×", () => removeInventory(inventoryIndex)));
  }
  card.append(tools);

  const slots = document.createElement("div");
  slots.className = "slot-grid";
  slots.setAttribute("aria-label", "Six inventory slots and three backpack slots");
  inventory.slots.forEach((_, slotIndex) => {
    slots.append(createInventorySlot(inventory, inventoryIndex, slotIndex));
  });
  card.append(slots);

  const upgradeRow = document.createElement("div");
  upgradeRow.className = "consumed-upgrades";
  upgradeRow.setAttribute("aria-label", "Consumed permanent upgrades");
  CONSUMED_UPGRADE_IDS.forEach((itemId) => {
    const upgrade = createUpgradeSlot(inventory, inventoryIndex, itemId);
    if (upgrade) upgradeRow.append(upgrade);
  });
  card.append(upgradeRow);

  const summary = document.createElement("div");
  summary.className = "inventory-summary";
  const label = document.createElement("span");
  label.className = "total-label";
  label.textContent = "Total net worth";
  const total = document.createElement("div");
  total.className = "gold-total";
  const icon = document.createElement("span");
  icon.className = "gold-icon";
  icon.setAttribute("aria-hidden", "true");
  const output = document.createElement("output");
  output.textContent = formatPrice(inventoryTotal(inventory));
  total.append(icon, output);
  summary.append(label, total);
  card.append(summary);
  return card;
}

function renderInventories({ syncUrl = true } = {}) {
  elements.inventoryList.replaceChildren();
  state.inventories.forEach((inventory, index) => {
    elements.inventoryList.append(createInventoryCard(inventory, index));
  });
  elements.addInventory.disabled = state.inventories.length >= MAX_INVENTORIES;
  if (syncUrl) updateUrl();
}

function addItem(itemId, sourceElement) {
  const item = state.itemsById.get(Number(itemId));
  if (!item) return;
  if (CONSUMED_UPGRADE_SET.has(item.id)) {
    addUpgrade(item.id);
    return;
  }

  const inventory = activeInventory();
  const openIndex = inventory.slots.findIndex((slot) => slot === null);
  if (openIndex < 0) {
    showToast("The selected inventory is full. Remove an item before adding another.");
    return;
  }
  inventory.sequence += 1;
  inventory.slots[openIndex] = { itemId: item.id, sequence: inventory.sequence };
  renderInventories();

  if (sourceElement) {
    sourceElement.classList.remove("is-added");
    requestAnimationFrame(() => sourceElement.classList.add("is-added"));
  }
}

function deleteLastAdded() {
  const inventory = activeInventory();
  let newest = null;
  inventory.slots.forEach((slot, index) => {
    if (slot && (!newest || slot.sequence > newest.sequence)) {
      newest = { type: "slot", index, sequence: slot.sequence };
    }
  });
  inventory.upgrades.forEach((upgrade) => {
    if (!newest || upgrade.sequence > newest.sequence) {
      newest = { type: "upgrade", itemId: upgrade.itemId, sequence: upgrade.sequence };
    }
  });
  if (!newest) return;
  if (newest.type === "slot") removeFromSlot(state.activeInventoryIndex, newest.index);
  else removeUpgrade(state.activeInventoryIndex, newest.itemId);
}

function searchScore(item, query) {
  const name = item.searchName;
  const internal = item.searchInternal;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(" ").some((word) => word.startsWith(query))) return 2;
  const position = name.indexOf(query);
  if (position >= 0) return 3 + position / 100;
  const queryWords = query.split(" ");
  if (queryWords.every((word) => name.includes(word) || internal.includes(word))) return 5;
  if (internal.includes(query)) return 7;
  return Number.POSITIVE_INFINITY;
}

function getSearchMatches(query) {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  return state.items
    .map((item) => ({ item, score: searchScore(item, normalized) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.item.order - b.item.order)
    .slice(0, 8)
    .map((entry) => entry.item);
}

function setActiveSearchIndex(index) {
  if (!state.searchMatches.length) {
    state.activeSearchIndex = -1;
    return;
  }
  state.activeSearchIndex = (index + state.searchMatches.length) % state.searchMatches.length;
  elements.searchResults.querySelectorAll(".search-result").forEach((result, resultIndex) => {
    const active = resultIndex === state.activeSearchIndex;
    result.classList.toggle("is-active", active);
    result.setAttribute("aria-selected", String(active));
    if (active) {
      elements.search.setAttribute("aria-activedescendant", result.id);
      result.scrollIntoView({ block: "nearest" });
    }
  });
}

function closeSearchResults() {
  state.activeSearchIndex = -1;
  state.searchMatches = [];
  elements.searchResults.hidden = true;
  elements.searchResults.replaceChildren();
  elements.search.setAttribute("aria-expanded", "false");
  elements.search.removeAttribute("aria-activedescendant");
}

function selectSearchItem(item) {
  addItem(item.id);
  elements.search.value = "";
  closeSearchResults();
  focusSearch();
}

function renderSearchResults() {
  const query = elements.search.value;
  state.searchMatches = getSearchMatches(query);
  state.activeSearchIndex = state.searchMatches.length ? 0 : -1;
  elements.searchResults.replaceChildren();

  if (!normalizeSearch(query)) {
    closeSearchResults();
    return;
  }

  if (!state.searchMatches.length) {
    const empty = document.createElement("p");
    empty.className = "no-search-results";
    empty.textContent = `No items found for “${query.trim()}”.`;
    elements.searchResults.append(empty);
  } else {
    state.searchMatches.forEach((item, index) => {
      const result = document.createElement("button");
      result.type = "button";
      result.className = `search-result${index === 0 ? " is-active" : ""}`;
      result.id = `search-result-${item.id}`;
      result.setAttribute("role", "option");
      result.setAttribute("aria-selected", String(index === 0));
      result.append(createImage(item, "eager"));

      const copy = document.createElement("span");
      copy.className = "result-copy";
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = itemLabel(item);
      const meta = document.createElement("span");
      meta.className = "result-meta";
      meta.textContent = CONSUMED_UPGRADE_SET.has(item.id) ? "Consumed upgrade" : "Shop item";
      copy.append(name, meta);
      result.append(copy, createPrice(item.cost, "result-price"));
      result.addEventListener("pointerdown", (event) => event.preventDefault());
      result.addEventListener("mouseenter", () => setActiveSearchIndex(index));
      result.addEventListener("click", () => selectSearchItem(item));
      elements.searchResults.append(result);
    });
  }
  elements.searchResults.hidden = false;
  elements.search.setAttribute("aria-expanded", "true");
  if (state.searchMatches.length) {
    elements.search.setAttribute("aria-activedescendant", `search-result-${state.searchMatches[0].id}`);
  }
}

function filteredCatalogItems() {
  let items = state.items;
  if (elements.sort.value === "name") {
    items = items.toSorted((a, b) => itemLabel(a).localeCompare(itemLabel(b)));
  } else if (elements.sort.value === "price-desc") {
    items = items.toSorted((a, b) => b.cost - a.cost || itemLabel(a).localeCompare(itemLabel(b)));
  } else if (elements.sort.value === "price-asc") {
    items = items.toSorted((a, b) => a.cost - b.cost || itemLabel(a).localeCompare(itemLabel(b)));
  }
  return items;
}

function createCatalogItem(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `catalog-item${CONSUMED_UPGRADE_SET.has(item.id) ? " is-consumable" : ""}`;
  button.title = `Add ${itemLabel(item)}`;
  button.setAttribute("aria-label", `Add ${itemLabel(item)}, ${formatPrice(item.cost)} gold`);
  button.style.setProperty("--quality-color", qualityColor(item));

  const visual = document.createElement("div");
  visual.className = "catalog-visual";
  visual.append(createImage(item));
  const copy = document.createElement("div");
  copy.className = "catalog-copy";
  const name = document.createElement("span");
  name.className = "catalog-name";
  name.textContent = itemLabel(item);
  const meta = document.createElement("span");
  meta.className = "catalog-meta";
  meta.append(createPrice(item.cost, "catalog-price"));
  copy.append(name, meta);
  button.append(visual, copy);
  button.addEventListener("click", () => addItem(item.id, button));
  return button;
}

function renderCatalog() {
  const items = filteredCatalogItems();
  elements.itemGrid.replaceChildren();
  elements.catalogCount.textContent = `${formatPrice(items.length)} ${items.length === 1 ? "item" : "items"}`;
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(createCatalogItem(item)));
  elements.itemGrid.append(fragment);
}

function positionGhost(event) {
  if (!state.drag?.ghost) return;
  state.drag.ghost.style.left = `${event.clientX}px`;
  state.drag.ghost.style.top = `${event.clientY}px`;
}

function updateDragTarget(event) {
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".inventory-slot");
  const targetInventoryIndex = target ? Number(target.dataset.inventoryIndex) : -1;
  const targetSlotIndex = target ? Number(target.dataset.slotIndex) : -1;

  document.querySelectorAll(".inventory-slot.is-drag-target").forEach((slot) => {
    slot.classList.remove("is-drag-target");
  });
  if (
    targetInventoryIndex === state.drag.inventoryIndex &&
    targetSlotIndex >= 0 &&
    targetSlotIndex !== state.drag.originSlotIndex
  ) {
    target.classList.add("is-drag-target");
    state.drag.targetSlotIndex = targetSlotIndex;
  } else {
    state.drag.targetSlotIndex = -1;
  }
}

function beginDrag(event) {
  if (!state.drag || state.drag.started) return;
  state.drag.started = true;
  const origin = elements.inventoryList.querySelector(
    `[data-inventory-index="${state.drag.inventoryIndex}"][data-slot-index="${state.drag.originSlotIndex}"]`,
  );
  origin?.classList.add("is-dragging");
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  const image = document.createElement("img");
  image.src = imageUrl(state.drag.item);
  image.alt = "";
  ghost.append(image);
  document.body.append(ghost);
  state.drag.ghost = ghost;
  positionGhost(event);
}

function movePointerDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  const distance = Math.hypot(event.clientX - state.drag.startX, event.clientY - state.drag.startY);
  if (!state.drag.started && distance < 7) return;
  beginDrag(event);
  event.preventDefault();
  positionGhost(event);
  updateDragTarget(event);
}

function endPointerDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  const { started, inventoryIndex, originSlotIndex, targetSlotIndex, ghost } = state.drag;
  document.removeEventListener("pointermove", movePointerDrag);
  document.removeEventListener("pointerup", endPointerDrag);
  document.removeEventListener("pointercancel", endPointerDrag);
  ghost?.remove();
  state.drag = null;

  if (started && targetSlotIndex >= 0 && targetSlotIndex !== originSlotIndex) {
    const slots = state.inventories[inventoryIndex].slots;
    [slots[originSlotIndex], slots[targetSlotIndex]] = [slots[targetSlotIndex], slots[originSlotIndex]];
    renderInventories();
  } else {
    document.querySelectorAll(".inventory-slot.is-dragging, .inventory-slot.is-drag-target").forEach((slot) => {
      slot.classList.remove("is-dragging", "is-drag-target");
    });
  }
}

function startPointerDrag(event, inventoryIndex, originSlotIndex, item) {
  if (event.button !== 0 || event.target.closest("button")) return;
  state.drag = {
    pointerId: event.pointerId,
    inventoryIndex,
    originSlotIndex,
    targetSlotIndex: -1,
    item,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
    ghost: null,
  };
  document.addEventListener("pointermove", movePointerDrag, { passive: false });
  document.addEventListener("pointerup", endPointerDrag);
  document.addEventListener("pointercancel", endPointerDrag);
}

async function copyInventoriesLink() {
  const link = shareUrl().href;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const temporary = document.createElement("textarea");
      temporary.value = link;
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();
      if (!document.execCommand("copy")) throw new Error("Copy command failed");
      temporary.remove();
    }
    clearTimeout(copyResetTimeout);
    elements.shareAll.classList.add("is-copied");
    elements.shareAll.lastChild.textContent = " Copied";
    copyResetTimeout = window.setTimeout(() => {
      elements.shareAll.classList.remove("is-copied");
      elements.shareAll.lastChild.textContent = " Copy link to inventories";
    }, 1800);
    showToast("Inventory link copied to your clipboard.");
  } catch {
    showToast("Couldn’t copy automatically. Copy the URL from your address bar.");
  }
}

function inventoryFromPayload(ids) {
  const inventory = createEmptyInventory();
  let missing = 0;

  ids.slice(0, MAX_SLOTS).forEach((id, index) => {
    if (id === 0) return;
    if (!state.itemsById.has(id)) {
      missing += 1;
      return;
    }
    inventory.sequence += 1;
    if (CONSUMED_UPGRADE_SET.has(id)) {
      if (!inventory.upgrades.some((upgrade) => upgrade.itemId === id)) {
        inventory.upgrades.push({ itemId: id, sequence: inventory.sequence });
      }
    } else {
      inventory.slots[index] = { itemId: id, sequence: inventory.sequence };
    }
  });

  ids.slice(MAX_SLOTS).forEach((id) => {
    if (!CONSUMED_UPGRADE_SET.has(id) || !state.itemsById.has(id)) {
      missing += 1;
      return;
    }
    if (!inventory.upgrades.some((upgrade) => upgrade.itemId === id)) {
      inventory.sequence += 1;
      inventory.upgrades.push({ itemId: id, sequence: inventory.sequence });
    }
  });
  return { inventory, missing };
}

function hydrateSharedInventories() {
  const url = new URL(window.location.href);
  const allCodes = url.searchParams.get("b");
  const singleCode = url.searchParams.get("i");
  if (!allCodes && !singleCode) return;

  try {
    let missing = 0;
    if (allCodes) {
      const codes = allCodes.split(".").filter(Boolean).slice(0, MAX_INVENTORIES);
      if (!codes.length) throw new TypeError("Empty inventory link");
      state.inventories = codes.map((code) => {
        const result = inventoryFromPayload(decodeInventory(code));
        missing += result.missing;
        return result.inventory;
      });
      const requestedIndex = Number(url.searchParams.get("a")) - 1;
      state.activeInventoryIndex = Number.isInteger(requestedIndex)
        ? Math.min(Math.max(requestedIndex, 0), state.inventories.length - 1)
        : 0;
    } else {
      const result = inventoryFromPayload(decodeInventory(singleCode));
      state.inventories = [result.inventory];
      state.activeInventoryIndex = 0;
      missing = result.missing;
    }
    if (missing) showToast(`${missing} item ${missing === 1 ? "is" : "are"} unavailable in the current item pool.`);
  } catch {
    showToast("This inventory link is invalid or from an unsupported version.");
  }
}

function handleGlobalKeydown(event) {
  if (elements.helpDialog.open) return;
  const editable = event.target.matches("input, textarea, select, [contenteditable='true']");
  const inventoryShortcut = event.altKey && !event.ctrlKey && !event.metaKey && /^Digit[1-9]$/.test(event.code);
  if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = (state.activeInventoryIndex + direction + state.inventories.length) % state.inventories.length;
    selectInventory(nextIndex);
    return;
  }
  if (inventoryShortcut) {
    event.preventDefault();
    const requestedIndex = Number(event.code.at(-1)) - 1;
    if (requestedIndex < state.inventories.length) selectInventory(requestedIndex);
    else addInventory();
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyC") {
    event.preventDefault();
    clearInventory(state.activeInventoryIndex);
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyD") {
    event.preventDefault();
    if (state.inventories.length > 1) removeInventory(state.activeInventoryIndex);
    else showToast("The last inventory can be cleared, but not removed.");
    return;
  }
  if (event.key === "/" && !editable) {
    event.preventDefault();
    focusSearch(true);
  } else if (event.key === "Delete" && !editable) {
    event.preventDefault();
    deleteLastAdded();
  } else if (event.key === "Backspace" && !editable && elements.search.value) {
    event.preventDefault();
    focusSearch();
    elements.search.value = elements.search.value.slice(0, -1);
    elements.search.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (!editable && !event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
    if (event.key === " " && !elements.search.value) return;
    event.preventDefault();
    focusSearch();
    elements.search.value += event.key;
    elements.search.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function bindEvents() {
  elements.search.addEventListener("input", renderSearchResults);
  elements.search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex(state.activeSearchIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex(state.activeSearchIndex - 1);
    } else if (event.key === "Enter" && state.searchMatches.length) {
      event.preventDefault();
      selectSearchItem(state.searchMatches[Math.max(0, state.activeSearchIndex)]);
    } else if (event.key === "Escape") {
      closeSearchResults();
      elements.search.blur();
    }
  });
  elements.search.addEventListener("focus", () => {
    if (elements.search.value) renderSearchResults();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!elements.searchShell.contains(event.target)) closeSearchResults();
  });
  document.addEventListener("keydown", handleGlobalKeydown);
  elements.addInventory.addEventListener("click", addInventory);
  elements.shareAll.addEventListener("click", copyInventoriesLink);
  elements.sort.addEventListener("change", renderCatalog);

  elements.helpToggle.addEventListener("click", () => elements.helpDialog.showModal());
  elements.helpClose.addEventListener("click", () => elements.helpDialog.close());
  elements.helpDialog.addEventListener("click", (event) => {
    if (event.target === elements.helpDialog) elements.helpDialog.close();
  });
}

async function loadItems() {
  elements.itemGrid.innerHTML = '<div class="catalog-loading">Fetching the shopkeeper’s ledger…</div>';
  try {
    const response = await fetch("./data/items.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    if (!Array.isArray(snapshot.items) || snapshot.items.length === 0) throw new Error("Empty item snapshot");

    const visibleItems = snapshot.items.filter(
      (item) =>
        !item.recipe &&
        item.neutralTier < 0 &&
        item.cost >= MIN_ITEM_COST &&
        !item.name.startsWith("item_recipe") &&
        !/\brecipe\b/i.test(item.nameLocalized),
    );
    const localizedNameCounts = new Map();
    visibleItems.forEach((item) => {
      localizedNameCounts.set(item.nameLocalized, (localizedNameCounts.get(item.nameLocalized) || 0) + 1);
    });
    state.items = visibleItems.map((item) => {
      const levelMatch = item.name.match(/_(\d+)$/);
      const duplicated = localizedNameCounts.get(item.nameLocalized) > 1;
      const level = levelMatch ? Number(levelMatch[1]) : 1;
      const displayName = duplicated ? `${item.nameLocalized} · Level ${level}` : item.nameLocalized;
      return {
        ...item,
        displayName,
        searchName: normalizeSearch(displayName),
        searchInternal: normalizeSearch(item.name.replace(/^item_/, "")),
      };
    });
    state.itemsById = new Map(state.items.map((item) => [item.id, item]));

    const updated = new Date(snapshot.meta.updatedAt);
    const dateLabel = Number.isNaN(updated.valueOf())
      ? "official feed"
      : updated.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
    elements.feedStatus.classList.add("is-ready");
    elements.feedStatus.lastChild.textContent = ` ${formatPrice(state.items.length)} items · ${dateLabel}`;

    hydrateSharedInventories();
    renderInventories();
    renderCatalog();
  } catch (error) {
    console.error(error);
    elements.feedStatus.classList.add("is-error");
    elements.feedStatus.lastChild.textContent = " Item data unavailable";
    elements.catalogCount.textContent = "Could not load item data";
    elements.itemGrid.innerHTML =
      '<div class="catalog-empty">The item ledger could not be loaded. Refresh the page to try again.</div>';
    showToast("Couldn’t load the Dota item snapshot.");
  }
}

bindEvents();
renderInventories({ syncUrl: false });
loadItems();
