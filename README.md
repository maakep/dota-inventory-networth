# Dota Inventory Net Worth

A dependency-free Dota 2 inventory value calculator built for GitHub Pages. Build and compare up to nine simultaneously visible inventories, each with six main slots, three compact backpack slots, and dedicated consumed-upgrade slots. Recipes, neutral-tier items, and records priced below 50 gold are excluded from the interface.

## Run locally

The app uses browser modules and fetches a local JSON file, so serve the repository instead of opening `index.html` directly:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. No install or build step is needed.

Run the small codec test suite with:

```sh
npm test
```

## Item data

`data/items.json` is a generated snapshot of Valve's official feeds:

- [Item list](https://www.dota2.com/datafeed/itemlist?language=english)
- [Item details](https://www.dota2.com/datafeed/itemdata?language=english&item_id=1)

The source does not advertise cross-origin browser access, and loading details also requires one request per item. Keeping a snapshot makes the page fast and reliable. [`.github/workflows/update-items.yml`](.github/workflows/update-items.yml) checks the feeds weekly and commits only when the normalized item records change. It can also be run manually from the Actions tab.

To refresh locally (Node.js 20+):

```sh
npm run update-items
```

The updater retries transient failures and refuses to replace the snapshot if the feed returns an implausibly small dataset.

## Share links

Ordered slot IDs—including empty gaps and consumed upgrades—are encoded as unsigned varints and then URL-safe Base64. A single inventory uses the `i` query parameter. Multi-inventory links join the same compact codes in `b` and store the selected inventory in `a`, keeping the format simple and backward compatible. The leading format byte leaves room for a future encoding migration.

## GitHub Pages

In the repository settings, open **Pages**, choose **Deploy from a branch**, and select `main` / `/ (root)`. All asset paths are relative, so the site works both on a project Pages URL and a custom domain. The `.nojekyll` marker keeps the static files untouched.

## Controls

- Click a catalog result or press Enter on a search result to add it.
- Start typing anywhere to send text directly to item search; `/` also focuses it.
- Click an inventory or press `Alt + 1` through `Alt + 9` to select its item target. A missing hotkey target creates one new inventory.
- Press `Tab` to cycle inventories or `Shift + Tab` to cycle backwards.
- Press `Alt + C` to clear the selected inventory or `Alt + D` to remove it.
- Drag an inventory item onto any slot to swap positions.
- Use the hover ×, right-click, or focus a slot and press Backspace/Delete to remove one item.
- Press the global Delete key to remove the most recently added remaining item from the selected inventory.
- Aghanim's Blessing, Aghanim's Shard, and Moon Shard use dedicated consumed-upgrade slots and do not occupy normal inventory space.
- Use **Copy link to inventories** to share the complete comparison.

Dota 2 is a trademark of Valve Corporation. This project is not affiliated with Valve.
