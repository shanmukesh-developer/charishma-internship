# Product options (weights, sizes, flavours, types) and product details

Owner, 28 Oct 2026: "the user unable to set weights or cake types, flavours, kg types ... add that in the whole
customer application"; "if admin gave 3 types of weights like 1000g, 500g and 250g it has to be in different
sections and the price should be given by the admin"; "correct product details alignment, how admin entered, in
order".

## Stored on the product: `MenuItem.specs`

```jsonc
"options": [                                   // in the order the admin entered them (max 8 groups)
  { "name": "Weight",  "type": "variant",      // ONE group at most; each choice is a FULL price
    "choices": [ { "label": "1 kg", "price": 400 }, { "label": "500 g", "price": 220 }, { "label": "250 g", "price": 120 } ] },
  { "name": "Flavour", "type": "single", "required": true,   // pick exactly one; price = EXTRA on top (0 allowed)
    "choices": [ { "label": "Chocolate", "price": 0 }, { "label": "Butterscotch", "price": 20 } ] },
  { "name": "Cake type", "type": "single", "required": false,
    "choices": [ { "label": "Eggless", "price": 30 } ] },
  { "name": "Add-ons", "type": "multi", "max": 3,           // pick any (up to max); each choice EXTRA
    "choices": [ { "label": "Candles", "price": 10 }, { "label": "Knife", "price": 0 } ] },
  { "name": "Message on cake", "type": "text", "maxLength": 40 }   // free text, no price
],
"details": [                                   // product details shown exactly in this order
  { "label": "Brand", "value": "Amul" },
  { "label": "Shelf life", "value": "6 months" }
]
```

Rules (enforced by `backend/utils/productOptions.js` `normalizeOptions` on every admin save):
- group `name`: 1-30 chars, unique in the product (case-insensitive). `type`: `variant` | `single` | `multi` | `text`.
- `variant`: at most one per product, always required, 1-20 choices, each `price` > 0 = the full unit price.
  The product's own `price` is set to the LOWEST variant price (lists show "from ₹120").
- `single` / `multi`: 1-20 choices, `price` >= 0 = extra per unit. `required` (single only). `max` (multi, >= 1).
- `text`: `maxLength` 1-100 (default 40), never priced, optional unless `required`.
- choice `label`: 1-30 chars, unique in its group (case-insensitive). Prices are rupees, at most 2 decimals, <= 100000.
- `details`: max 20 rows, `label` 1-30 chars, `value` 1-200 chars.
- Max 8 groups. `options: []` or `null` removes options.

## In the basket / order: `customizations`

The app sends the customer's picks keyed by group NAME with choice LABELS (exactly as stored):

```json
{ "Weight": "500 g", "Flavour": "Chocolate", "Add-ons": ["Candles"], "Message on cake": "Happy birthday Ravi" }
```

Server (`computeOrderQuote` -> `priceWithOptions`): a product WITH `specs.options` is priced only from them:
unit = (chosen variant price, else `price`) + sum of chosen extras. Unknown group / label, a missing required
pick, too many picks, or text over its limit -> 400 `OPTION_INVALID` with a message naming the product. The stored
order line keeps the cleaned `customizations` in the admin's group order, so the store, rider, admin and receipt all
show "500 g · Chocolate · Candles". Products WITHOUT `specs.options` keep today's behaviour.

Same product with different picks = separate basket lines (the app's cart key already includes customizations).
