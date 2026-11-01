import os, json
from build_manu_dosa_menu import ITEMS

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'owner-menus')

# Format items for JSON
json_items = []
for item in ITEMS:
    json_items.append({
        "slug": item['slug'],
        "name": item['name'],
        "price": item['price'],
        "category": item['category'],
        "dietType": item['dietType'],
        "description": item['desc'],
        "image": f"{item['slug']}.jpg"
    })

prices = [i['price'] for i in json_items]
min_price = min(prices)
max_price = max(prices)
dish_count = len(json_items)

# Store description following the exact required format:
# 1. intro: 80 to 200 chars, no newline
intro = "Manu Dosa Place, established in 2017 on Goutham Buddha Road in Mangalagiri, is famous for its 60+ inventive tawa dosas, fluffy idlis, non-veg curries and fusion pizza dosas."

on_the_menu = """**On the menu**
- Traditional tiffins: Steamed Idly, Ghee Podi Idly, and Idly with spicy Andhra Chicken Curry
- Classic & Ghee Dosas: Plain, Onion, Upma, Masala, Karam, Set Dosa, and Ghee-roasted varieties
- Specialty & Cheese: Butter Masala, Cheese Dosa, Paneer Cheese, Corn Cheese, Kaju Corn, and Lays Dosa
- Pizza Dosas: Italian-Andhra fusion Pizza Dosa, Corn Pizza, Paneer Pizza, Kaju Pizza, and Mixed Pizza Dosa
- Non-Veg & Egg Specials: Egg Dosa, Egg Keema Dosa, Chicken Keema Dosa, Cheese Keema Dosa, and Parota with Chicken Curry"""

good_to_know = f"""**Good to know**
- Open every day, 7:00 AM to 11:00 PM
- {dish_count} dishes, from ₹{min_price} to ₹{max_price}
- Authentic street-style counter located on Goutham Buddha Road, near NRI General Hospital, Autonagar, Mangalagiri"""

full_description = f"{intro}\n\n{on_the_menu}\n\n{good_to_know}"

store_data = {
    "version": 1,
    "key": "owner-menu:manu-dosa-place",
    "note": "Owner, 1 Nov 2026: 'add this to our live db with related images and no duplicate images and valid description with related images and description take ref from amrutham restaurant which we currently having'. Real menu card photographed at Manu Dosa Place Since 2017, Mangalagiri. 60 unique dishes across traditional tiffins, ghee dosas, butter dosas, cheese dosas, specialty fusion dosas, pizza dosas, and non-veg specials at exact printed prices. Real, unique photos checked and Exif-stripped for every dish. Store photo is the authentic storefront night photo cropped to 2:1 banner frame.",
    "imagesDir": "images/manu-dosa-place",
    "store": {
        "name": "Manu Dosa Place",
        "location": "Goutham Buddha Road, near NRI General Hospital, opposite Honda Showroom, Autonagar, Mangalagiri",
        "lat": 16.4214,
        "lon": 80.5608,
        "vendorType": "RESTAURANT",
        "image": "storefront-banner.jpg",
        "tags": [
            "dosa",
            "south indian",
            "tiffin",
            "idly",
            "breakfast",
            "keema dosa",
            "pizza dosa",
            "ghee dosa",
            "parota"
        ],
        "description": full_description,
        "operatingHours": {
            "start": "07:00",
            "end": "23:00"
        }
    },
    "items": json_items
}

target_file = os.path.join(DATA_DIR, 'manu-dosa-place-v1-2026-11-01.json')
with open(target_file, 'w', encoding='utf-8') as f:
    json.dump(store_data, f, indent=2, ensure_ascii=False)

print(f"Successfully generated {target_file} with {dish_count} items!")

