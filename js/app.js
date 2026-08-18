import { decodeInventory, encodeInventory } from "./codec.js";

const MAX_SLOTS = 6;
const IMAGE_BASE = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/";
const PRICE_FORMATTER = new Intl.NumberFormat("en-US");

const elements = {
  search: document.querySelector("#item-search"),
  searchShell: document.querySelector("#search-shell"),
  searchResults: document.querySelector("#search-results"),
  feedStatus: document.querySelector("#feed-status"),
  slots: document.querySelector("#inventory-slots"),
  slotCount: document.querySelector("#slot-count"),
  deleteLast: document.querySelector("#delete-last"),
  clear: document.querySelector("#clear-inventory"),
  total: document.querySelector("#total-value"),
  totalWrap: document.querySelector(".gold-total"),
  totalCaption: document.querySelector("#total-caption"),
  itemCount: document.querySelector("#item-count"),
  highestItem: document.querySelector("#highest-item"),
  share: document.querySelector("#share-build"),
  filterTabs: document.querySelector("#filter-tabs"),
  sort: document.querySelector("#item-sort"),
  catalogCount: document.querySelector("#catalog-result-count"),
  itemGrid: document.querySelector("#item-grid"),
  toast: document.querySelector("#toast"),
};

const state = {
  items: [],
  itemsById: new Map(),
  slots: Array(MAX_SLOTS).fill(null),
  sequence: 0,
  activeFilter: "all",
  activeSearchIndex: -1,
  searchMatches: [],
  drag: null,
};

let toastTimeout;
let shareResetTimeout;

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

function imageSlug(item) {
  const slug = item.name.replace(/^item_/, "");
  return item.recipe ? "recipe" : slug;
}

function imageUrl(item) {
  return `${IMAGE_BASE}${encodeURIComponent(imageSlug(item))}.png`;
}

function itemLabel(item) {
  return item.displayName || item.nameLocalized;
}

function initials(item) {
  return itemLabel(item)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

function itemType(item) {
  if (item.recipe) return "Recipe";
  if (item.neutralTier >= 0) return `Neutral · Tier ${item.neutralTier + 1}`;
  return "Shop item";
}

function qualityColor(item) {
  if (item.recipe) return "#85827e";
  if (item.neutralTier >= 0) {
    return ["#8db3cf", "#8bc69a", "#b18bd2", "#e08e65", "#d5b45b"][item.neutralTier] || "#b18bd2";
  }

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

function inventoryValues() {
  const lastFilledIndex = state.slots.findLastIndex(Boolean);
  if (lastFilledIndex < 0) return [];
  return state.slots.slice(0, lastFilledIndex + 1).map((slot) => slot?.itemId || 0);
}

function updateUrl() {
  const url = new URL(window.location.href);
  const values = inventoryValues();
  if (values.length) {
    url.searchParams.set("i", encodeInventory(values));
  } else {
    url.searchParams.delete("i");
  }
  window.history.replaceState(null, "", url);
}

function animateTotal() {
  elements.totalWrap.classList.remove("is-updated");
  requestAnimationFrame(() => elements.totalWrap.classList.add("is-updated"));
}

function renderSummary(animate = true) {
  const selected = state.slots
    .filter(Boolean)
    .map((slot) => state.itemsById.get(slot.itemId))
    .filter(Boolean);
  const total = selected.reduce((sum, item) => sum + item.cost, 0);
  const highest = selected.reduce((current, item) => (!current || item.cost > current.cost ? item : current), null);

  elements.slotCount.textContent = selected.length;
  elements.itemCount.textContent = `${selected.length} / ${MAX_SLOTS}`;
  elements.total.textContent = formatPrice(total);
  elements.highestItem.textContent = highest ? itemLabel(highest) : "—";
  elements.totalCaption.textContent = selected.length
    ? selected.length === MAX_SLOTS
      ? "A complete six-slot build."
      : `${MAX_SLOTS - selected.length} open ${MAX_SLOTS - selected.length === 1 ? "slot" : "slots"} remaining.`
    : "Add an item to start your build.";
  elements.deleteLast.disabled = selected.length === 0;
  elements.clear.disabled = selected.length === 0;
  if (animate) animateTotal();
}

function focusSearch() {
  elements.search.focus({ preventScroll: true });
  elements.search.select();
}

function renderSlots({ animate = true, syncUrl = true } = {}) {
  elements.slots.replaceChildren();

  state.slots.forEach((slotData, index) => {
    const slot = document.createElement("div");
    slot.className = `inventory-slot ${slotData ? "is-filled" : "is-empty"}`;
    slot.dataset.slotIndex = index;
    slot.tabIndex = 0;

    const number = document.createElement("span");
    number.className = "slot-number";
    number.textContent = String(index + 1).padStart(2, "0");
    slot.append(number);

    if (!slotData) {
      slot.setAttribute("role", "button");
      slot.setAttribute("aria-label", `Empty inventory slot ${index + 1}. Focus item search.`);
      const emptyCopy = document.createElement("span");
      emptyCopy.className = "empty-slot-copy";
      emptyCopy.textContent = "Empty slot";
      slot.append(emptyCopy);
      slot.addEventListener("click", focusSearch);
    } else {
      const item = state.itemsById.get(slotData.itemId);
      if (!item) return;

      slot.setAttribute(
        "aria-label",
        `${itemLabel(item)}, ${formatPrice(item.cost)} gold. Drag to rearrange, or press Delete to remove.`,
      );
      slot.style.setProperty("--quality-color", qualityColor(item));

      const slotItem = document.createElement("div");
      slotItem.className = "slot-item";
      slotItem.dataset.dragHandle = "true";

      const visual = document.createElement("div");
      visual.className = "slot-visual";
      const image = createImage(item, "eager");
      visual.append(image);

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

      const remove = document.createElement("button");
      remove.className = "remove-item";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${itemLabel(item)}`);
      remove.addEventListener("pointerdown", (event) => event.stopPropagation());
      remove.addEventListener("click", () => removeFromSlot(index));

      slot.append(slotItem, remove);
      slotItem.addEventListener("pointerdown", (event) => startPointerDrag(event, index, item));
      slot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        removeFromSlot(index);
      });
    }

    slot.addEventListener("keydown", (event) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        if (state.slots[index]) removeFromSlot(index);
      } else if (!state.slots[index] && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        focusSearch();
      }
    });

    elements.slots.append(slot);
  });

  renderSummary(animate);
  if (syncUrl) updateUrl();
}

function addItem(itemId, sourceElement) {
  const openIndex = state.slots.findIndex((slot) => slot === null);
  const item = state.itemsById.get(Number(itemId));
  if (!item) return;

  if (openIndex < 0) {
    showToast("Your inventory is full. Remove an item before adding another.");
    return;
  }

  state.sequence += 1;
  state.slots[openIndex] = { itemId: item.id, sequence: state.sequence };
  renderSlots();

  if (sourceElement) {
    sourceElement.classList.remove("is-added");
    requestAnimationFrame(() => sourceElement.classList.add("is-added"));
  }
}

function removeFromSlot(index) {
  const item = state.itemsById.get(state.slots[index]?.itemId);
  if (!state.slots[index]) return;
  state.slots[index] = null;
  renderSlots();
  if (item) showToast(`${itemLabel(item)} removed.`);
}

function deleteLastAdded() {
  let newestIndex = -1;
  let newestSequence = -1;
  state.slots.forEach((slot, index) => {
    if (slot && slot.sequence > newestSequence) {
      newestSequence = slot.sequence;
      newestIndex = index;
    }
  });
  if (newestIndex >= 0) removeFromSlot(newestIndex);
}

function clearInventory() {
  if (!state.slots.some(Boolean)) return;
  state.slots = Array(MAX_SLOTS).fill(null);
  renderSlots();
  showToast("Inventory cleared.");
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
      meta.textContent = itemType(item);
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
  if (state.activeSearchIndex >= 0) {
    elements.search.setAttribute("aria-activedescendant", `search-result-${state.searchMatches[0].id}`);
  }
}

function filteredCatalogItems() {
  let items = state.items.filter((item) => {
    if (state.activeFilter === "shop") return !item.recipe && item.neutralTier < 0;
    if (state.activeFilter === "neutral") return item.neutralTier >= 0;
    if (state.activeFilter === "recipe") return item.recipe;
    return true;
  });

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
  button.className = "catalog-item";
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
  const type = document.createElement("span");
  type.className = "item-type";
  type.textContent = itemType(item);
  meta.append(type);
  copy.append(name, meta);
  button.append(visual, copy);
  button.addEventListener("click", () => addItem(item.id, button));
  return button;
}

function renderCatalog() {
  const items = filteredCatalogItems();
  elements.itemGrid.replaceChildren();
  elements.catalogCount.textContent = `${formatPrice(items.length)} ${items.length === 1 ? "item" : "items"}`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "catalog-empty";
    empty.textContent = "No items match this filter.";
    elements.itemGrid.append(empty);
    return;
  }

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
  const targetIndex = target ? Number(target.dataset.slotIndex) : -1;

  document.querySelectorAll(".inventory-slot.is-drag-target").forEach((slot) => {
    slot.classList.remove("is-drag-target");
  });

  if (targetIndex >= 0 && targetIndex !== state.drag.originIndex) {
    target.classList.add("is-drag-target");
    state.drag.targetIndex = targetIndex;
  } else {
    state.drag.targetIndex = -1;
  }
}

function beginDrag(event) {
  if (!state.drag || state.drag.started) return;
  state.drag.started = true;
  const origin = elements.slots.querySelector(`[data-slot-index="${state.drag.originIndex}"]`);
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
  const { started, originIndex, targetIndex, ghost } = state.drag;
  document.removeEventListener("pointermove", movePointerDrag);
  document.removeEventListener("pointerup", endPointerDrag);
  document.removeEventListener("pointercancel", endPointerDrag);
  ghost?.remove();
  document.querySelectorAll(".inventory-slot.is-dragging, .inventory-slot.is-drag-target").forEach((slot) => {
    slot.classList.remove("is-dragging", "is-drag-target");
  });
  state.drag = null;

  if (started && targetIndex >= 0 && targetIndex !== originIndex) {
    [state.slots[originIndex], state.slots[targetIndex]] = [state.slots[targetIndex], state.slots[originIndex]];
    renderSlots();
  }
}

function startPointerDrag(event, originIndex, item) {
  if (event.button !== 0 || event.target.closest("button")) return;
  state.drag = {
    pointerId: event.pointerId,
    originIndex,
    targetIndex: -1,
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

async function copyBuildLink() {
  const link = window.location.href;
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

    clearTimeout(shareResetTimeout);
    elements.share.classList.add("is-copied");
    elements.share.lastChild.textContent = " Link copied";
    shareResetTimeout = window.setTimeout(() => {
      elements.share.classList.remove("is-copied");
      elements.share.lastChild.textContent = " Copy build link";
    }, 1800);
    showToast("Build link copied to your clipboard.");
  } catch {
    showToast("Couldn’t copy automatically. Copy the URL from your address bar.");
  }
}

function hydrateSharedInventory() {
  const code = new URL(window.location.href).searchParams.get("i");
  if (!code) return;

  try {
    const ids = decodeInventory(code);
    let missing = 0;
    ids.slice(0, MAX_SLOTS).forEach((id, index) => {
      if (id === 0) return;
      if (!state.itemsById.has(id)) {
        missing += 1;
        return;
      }
      state.sequence += 1;
      state.slots[index] = { itemId: id, sequence: state.sequence };
    });
    if (missing) showToast(`${missing} item ${missing === 1 ? "is" : "are"} no longer in the current feed.`);
  } catch {
    showToast("This build link is invalid or from an unsupported version.");
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
  document.addEventListener("keydown", (event) => {
    const editable = event.target.matches("input, textarea, select, [contenteditable='true']");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      focusSearch();
    } else if (event.key === "/" && !editable) {
      event.preventDefault();
      focusSearch();
    } else if (event.key === "Delete" && !editable) {
      event.preventDefault();
      deleteLastAdded();
    }
  });

  elements.deleteLast.addEventListener("click", deleteLastAdded);
  elements.clear.addEventListener("click", clearInventory);
  elements.share.addEventListener("click", copyBuildLink);
  elements.sort.addEventListener("change", renderCatalog);
  elements.filterTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.activeFilter = button.dataset.filter;
    elements.filterTabs.querySelectorAll("button").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    renderCatalog();
  });
}

async function loadItems() {
  elements.itemGrid.innerHTML = '<div class="catalog-loading">Fetching the shopkeeper’s ledger…</div>';
  try {
    const response = await fetch("./data/items.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    if (!Array.isArray(snapshot.items) || snapshot.items.length === 0) throw new Error("Empty item snapshot");

    const localizedNameCounts = new Map();
    snapshot.items.forEach((item) => {
      localizedNameCounts.set(item.nameLocalized, (localizedNameCounts.get(item.nameLocalized) || 0) + 1);
    });
    state.items = snapshot.items.map((item) => {
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

    hydrateSharedInventory();
    renderSlots({ animate: false });
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
renderSlots({ animate: false, syncUrl: false });
loadItems();
