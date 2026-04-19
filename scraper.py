import argparse
import json
import time

import requests

BASE_URL = "https://www.drumkits.site/api/kits"
SIGN_URL = "https://www.drumkits.site/api/sign-request"
LIMIT = 100

DATABASES = ["drum_kits", "kits4beats_drumkits", "reddit_kits"]
OUTPUT_FILE = "public/kits.ndjson"

SESSION = requests.Session()
SESSION.headers.update({
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "referer": "https://www.drumkits.site/",
})


def get_timestamp() -> str:
    return str(int(time.time() * 1000))


def fetch_signature(timestamp: str) -> str | None:
    try:
        print(f"  Fetching signature for timestamp {timestamp}...")
        resp = SESSION.post(
            SIGN_URL,
            headers={"content-type": "application/json"},
            json={"timestamp": timestamp},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        signature = (
            data.get("signature")
            or data.get("sign")
            or data.get("hash")
            or data.get("token")
        )
        if not signature:
            print(f"  Unexpected sign-request response: {data}")
        return signature
    except requests.RequestException as e:
        print(f"  Failed to fetch signature: {e}")
        return None


def fetch_page(offset: int, db: str, signature: str, timestamp: str) -> tuple[dict | list | None, bool]:
    params = {"limit": LIMIT, "offset": offset, "db": db}
    headers = {
        "x-request-timestamp": timestamp,
        "x-request-signature": signature,
    }
    try:
        resp = SESSION.get(BASE_URL, params=params, headers=headers, timeout=15)
        if resp.status_code in (401, 403):
            print(f"  Auth error ({resp.status_code}), will refresh signature.")
            return None, True
        resp.raise_for_status()
        return resp.json(), False
    except requests.RequestException as e:
        print(f"  Request error at offset {offset}: {e}")
        return None, False


def get_items(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return (
            data.get("kits")
            or data.get("data")
            or data.get("results")
            or data.get("items")
            or []
        )
    return []


def scrape_db(db: str) -> list:
    all_kits = []
    offset = 0

    timestamp = get_timestamp()
    signature = fetch_signature(timestamp)
    if not signature:
        print(f"Could not obtain signature for {db}. Skipping.")
        return []

    print(f"\nStarting fetch (db={db}, limit={LIMIT})\n")

    while True:
        print(f"Fetching offset={offset}...")
        data, needs_refresh = fetch_page(offset, db, signature, timestamp)

        if needs_refresh:
            timestamp = get_timestamp()
            signature = fetch_signature(timestamp)
            if not signature:
                print("  Could not refresh signature. Stopping.")
                break
            data, needs_refresh = fetch_page(offset, db, signature, timestamp)
            if needs_refresh or data is None:
                print("  Still failing after signature refresh. Stopping.")
                break

        if data is None:
            print("  Empty response, stopping.")
            break

        items = get_items(data)
        if not items:
            print("  No more items. Done!")
            break

        all_kits.extend(items)
        print(f"  Got {len(items)} kits. Total so far: {len(all_kits)}")

        if len(items) < LIMIT:
            print("  Last page (fewer items than limit).")
            break

        offset += LIMIT
        time.sleep(0.5)

    print(f"  Scraped {len(all_kits)} kits from {db}")
    return all_kits


def main():
    parser = argparse.ArgumentParser(description="Scrape drumkits.site databases")
    parser.add_argument(
        "--db",
        nargs="+",
        default=DATABASES,
        help=f"Database(s) to scrape (default: all). Choices: {DATABASES}",
    )
    args = parser.parse_args()

    print(f"Writing to {OUTPUT_FILE}...\n")
    total = 0
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for db in args.db:
            kits = scrape_db(db)
            for kit in kits:
                kit["_db"] = db
                f.write(json.dumps(kit, ensure_ascii=False) + "\n")
            total += len(kits)

    print(f"\nDone! {total} kits saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
