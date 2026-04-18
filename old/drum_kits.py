import requests
import json
import time

BASE_URL = "https://www.drumkits.site/api/kits"
LIMIT = 100
OUTPUT_FILE = "drum_kits.json"

HEADERS = {
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
    "x-request-signature": "449eb91cd5f95f72b294199a7db0190e224a9300235ce022d4cd148e81fc3c39",
    "x-request-timestamp": "1776533687073",
    "referer": "https://www.drumkits.site/",
}


def fetch_page(offset: int) -> dict | None:
    params = {
        "limit": LIMIT,
        "offset": offset,
        "db": "drum_kits",
    }
    try:
        response = requests.get(
            BASE_URL,
            headers=HEADERS,
            params=params,
            timeout=15,
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"  Error fetching offset {offset}: {e}")
        return None


def main():
    all_kits = []
    offset = 0

    print("Starting fetch...\n")

    while True:
        print(f"Fetching offset={offset}, limit={LIMIT}...")
        data = fetch_page(offset)

        if data is None:
            print("  Request failed, stopping.")
            break

        # Handle both list and dict responses
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            # Try common keys
            items = data.get("kits") or data.get("data") or data.get("results") or []
        else:
            items = []

        if not items:
            print("  No more items returned. Done!")
            break

        all_kits.extend(items)
        print(f"  Got {len(items)} kits. Total so far: {len(all_kits)}")

        if len(items) < LIMIT:
            print("  Last page reached (fewer items than limit).")
            break

        offset += LIMIT
        time.sleep(0.5)  # polite delay between requests

    print(f"\nSaving {len(all_kits)} kits to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_kits, f, indent=2, ensure_ascii=False)

    print(f"Done! Saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()