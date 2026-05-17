// backend/utils/pricingSchema.js

// This mirrors the frontend CustomizeDrawer options to securely calculate addon costs on the server.
const detectProductType = (name, tags = [], category = '') => {
  const searchStr = `${name} ${(tags || []).join(' ')} ${category || ''}`.toLowerCase();
  
  const DETECTION = [
    { type: 'cake',     keywords: /cake|pastry|brownie|cupcake|cheesecake|gateau|truffle/i },
    { type: 'pizza',    keywords: /pizza|calzone/i },
    { type: 'biryani',  keywords: /biryani|biriyani|pulao|rice bowl/i },
    { type: 'beverage', keywords: /juice|shake|coffee|tea|chai|lassi|smoothie|lemonade|mojito|cold brew|frappe|soda|milkshake|coolant/i },
    { type: 'sweets',   keywords: /sweet|laddu|ladoo|barfi|halwa|jalebi|kaju|peda|mysore pak|rasgulla|gulab jamun|soan papdi|dry fruit|mithai/i },
    { type: 'burger',   keywords: /burger|sandwich|wrap|sub|roll|frank|hotdog/i },
    { type: 'dessert',  keywords: /ice cream|kulfi|falooda|sundae|gelato|popsicle|rabri|gulab jamun|rasgulla/i },
    { type: 'fruit',    keywords: /fruit|apple|banana|mango|grapes|orange|watermelon|papaya|kiwi|berry/i },
    { type: 'laundry',  keywords: /dry wash|laundry|wash|ironing|clothes|dry clean/i },
    { type: 'rental',   keywords: /rental|car|bike|scooter|driver|cab|taxi/i },
    { type: 'pharmacy', keywords: /pharmacy|medicine|first aid|tablet|syrup|supplement|vitamin|pill|bandage|kit/i },
    { type: 'general-food', keywords: /curry|meal|rice|roti|naan|noodle|pasta|soup|salad|starter|thali|dish/i },
  ];

  for (const d of DETECTION) {
    if (d.keywords.test(searchStr)) return d.type;
  }
  return 'general';
};

const calculateCustomizationCost = (basePrice, dbItem, customizations) => {
  if (!customizations || typeof customizations !== 'object') return 0;

  const type = detectProductType(dbItem.name, dbItem.tags, dbItem.category);
  let extraCost = 0;

  const matchAddon = (val, addAmount) => {
    // Check if the value exists in single-select or multi-select array
    if (typeof customizations === 'object') {
      for (const key in customizations) {
        const fieldVal = customizations[key];
        if (Array.isArray(fieldVal) && fieldVal.includes(val)) extraCost += addAmount;
        else if (fieldVal === val) extraCost += addAmount;
      }
    }
  };

  switch (type) {
    case 'cake':
      matchAddon('1 Kg', Math.round(basePrice * 0.8));
      matchAddon('1.5 Kg', Math.round(basePrice * 1.5));
      matchAddon('2 Kg', Math.round(basePrice * 2.5));
      matchAddon('Red Velvet', 50);
      matchAddon('Mango', 30);
      matchAddon('Eggless', 20);
      break;

    case 'pizza':
      matchAddon('Medium', 60);
      matchAddon('Large', 120);
      matchAddon('Cheese Burst', 70);
      matchAddon('Stuffed Crust', 90);
      matchAddon('Extra Cheese', 40);
      matchAddon('Olives', 25);
      matchAddon('Jalapeños', 20);
      matchAddon('Mushrooms', 25);
      matchAddon('Onions', 15);
      matchAddon('Paneer', 35);
      matchAddon('Corn', 15);
      break;

    case 'biryani':
      matchAddon('Full', Math.round(basePrice * 0.7));
      matchAddon('Family', Math.round(basePrice * 1.8));
      matchAddon('Raita', 25);
      matchAddon('Salan', 20);
      matchAddon('Extra Masala', 15);
      matchAddon('Boiled Egg', 15);
      break;

    case 'beverage':
      matchAddon('Medium', 20);
      matchAddon('Large', 40);
      break;

    case 'burger':
      matchAddon('Double', 50);
      matchAddon('Extra Cheese', 25);
      matchAddon('Extra Patty', 50);
      matchAddon('Lettuce', 10);
      matchAddon('Mayo', 10);
      break;

    case 'dessert':
      matchAddon('Double', 40);
      matchAddon('Triple', 70);
      matchAddon('Chocolate Sauce', 15);
      matchAddon('Sprinkles', 10);
      matchAddon('Nuts', 20);
      matchAddon('Whipped Cream', 15);
      break;

    case 'sweets':
      matchAddon('500g', Math.round(basePrice * 0.8));
      matchAddon('1 Kg', Math.round(basePrice * 2.5));
      matchAddon('2 Kg', Math.round(basePrice * 5.5));
      matchAddon('Gift Box', 50);
      matchAddon('Premium Gift', 120);
      break;

    case 'fruit':
      matchAddon('1 Kg', Math.round(basePrice * 0.8));
      matchAddon('1.5 Kg', Math.round(basePrice * 1.5));
      matchAddon('2 Kg', Math.round(basePrice * 2.5));
      matchAddon('Cut & Packed', 50);
      break;

    case 'laundry':
      matchAddon('Wash & Iron', 20);
      matchAddon('Premium Dry Clean', 100);
      matchAddon('Shoe Cleaning', 150);
      break;

    case 'rental':
      matchAddon('With Driver', 500);
      break;

    default:
      break;
  }

  return extraCost;
};

module.exports = { calculateCustomizationCost, detectProductType };
