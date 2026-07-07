"use client";
import React, { useState, useMemo } from 'react';
import { Customizations } from '@/context/CartContext';

type ProductType = 'cake' | 'pizza' | 'biryani' | 'beverage' | 'burger' | 'dessert' | 'sweets' | 'fruit' | 'laundry' | 'rental' | 'pharmacy' | 'general-food' | 'general';

const DETECTION: { type: ProductType; keywords: RegExp }[] = [
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

function detectProductType(name: string, tags?: string[], category?: string): ProductType {
  const searchStr = `${name} ${(tags || []).join(' ')} ${category || ''}`.toLowerCase();
  for (const d of DETECTION) {
    if (d.keywords.test(searchStr)) return d.type;
  }
  return 'general';
}

interface OptionConfig {
  label: string;
  key: keyof Customizations;
  type: 'select' | 'multi' | 'text' | 'number';
  options?: { label: string; value: string; priceAdd?: number }[];
  placeholder?: string;
}

function getOptionsForType(type: ProductType, basePrice: number): OptionConfig[] {
  switch (type) {
    case 'cake':
      return [
        {
          label: 'Weight', key: 'weight', type: 'select',
          options: [
            { label: '0.5 Kg', value: '0.5 Kg', priceAdd: 0 },
            { label: '1 Kg', value: '1 Kg', priceAdd: Math.round(basePrice * 0.8) },
            { label: '1.5 Kg', value: '1.5 Kg', priceAdd: Math.round(basePrice * 1.5) },
            { label: '2 Kg', value: '2 Kg', priceAdd: Math.round(basePrice * 2.5) },
          ]
        },
        {
          label: 'Flavor', key: 'flavor', type: 'select',
          options: [
            { label: 'Chocolate', value: 'Chocolate' },
            { label: 'Vanilla', value: 'Vanilla' },
            { label: 'Butterscotch', value: 'Butterscotch' },
            { label: 'Red Velvet', value: 'Red Velvet', priceAdd: 50 },
            { label: 'Strawberry', value: 'Strawberry' },
            { label: 'Pineapple', value: 'Pineapple' },
            { label: 'Black Forest', value: 'Black Forest' },
            { label: 'Mango', value: 'Mango', priceAdd: 30 },
          ]
        },
        {
          label: 'Egg Preference', key: 'eggPreference', type: 'select',
          options: [
            { label: 'Regular (With Egg)', value: 'With Egg' },
            { label: 'Eggless', value: 'Eggless', priceAdd: 20 },
          ]
        },
        { label: 'Message on Cake', key: 'cakeMessage', type: 'text', placeholder: 'e.g. Happy Birthday Shanmukh' },
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'Any dietary needs, allergies...' },
      ];

    case 'pizza':
      return [
        {
          label: 'Size', key: 'size', type: 'select',
          options: [
            { label: 'Small (7")', value: 'Small', priceAdd: 0 },
            { label: 'Medium (10")', value: 'Medium', priceAdd: 60 },
            { label: 'Large (13")', value: 'Large', priceAdd: 120 },
          ]
        },
        {
          label: 'Crust', key: 'crust', type: 'select',
          options: [
            { label: 'Classic Hand Tossed', value: 'Hand Tossed' },
            { label: 'Thin Crust', value: 'Thin Crust' },
            { label: 'Cheese Burst', value: 'Cheese Burst', priceAdd: 70 },
            { label: 'Stuffed Crust', value: 'Stuffed Crust', priceAdd: 90 },
          ]
        },
        {
          label: 'Slices', key: 'slices', type: 'select',
          options: [
            { label: '4 Slices', value: '4' },
            { label: '6 Slices', value: '6' },
            { label: '8 Slices', value: '8' },
          ]
        },
        {
          label: 'Extra Toppings', key: 'toppings', type: 'multi',
          options: [
            { label: 'Extra Cheese', value: 'Extra Cheese', priceAdd: 40 },
            { label: 'Olives', value: 'Olives', priceAdd: 25 },
            { label: 'Jalapeños', value: 'Jalapeños', priceAdd: 20 },
            { label: 'Mushrooms', value: 'Mushrooms', priceAdd: 25 },
            { label: 'Onions', value: 'Onions', priceAdd: 15 },
            { label: 'Paneer', value: 'Paneer', priceAdd: 35 },
            { label: 'Corn', value: 'Corn', priceAdd: 15 },
          ]
        },
        { label: 'Spice Level', key: 'spiceLevel', type: 'select', options: [
          { label: 'Mild', value: 'Mild' }, { label: 'Medium', value: 'Medium' },
          { label: 'Spicy', value: 'Spicy' }, { label: 'Extra Spicy', value: 'Extra Spicy' },
        ]},
      ];

    case 'biryani':
      return [
        {
          label: 'Portion', key: 'size', type: 'select',
          options: [
            { label: 'Half (1 person)', value: 'Half', priceAdd: 0 },
            { label: 'Full (2-3 persons)', value: 'Full', priceAdd: Math.round(basePrice * 0.7) },
            { label: 'Family Pack (4-5)', value: 'Family', priceAdd: Math.round(basePrice * 1.8) },
          ]
        },
        { label: 'Spice Level', key: 'spiceLevel', type: 'select', options: [
          { label: 'Mild', value: 'Mild' }, { label: 'Medium', value: 'Medium' },
          { label: 'Spicy 🌶️', value: 'Spicy' }, { label: 'Extra Spicy 🔥', value: 'Extra Spicy' },
        ]},
        {
          label: 'Add-ons', key: 'toppings', type: 'multi',
          options: [
            { label: 'Raita', value: 'Raita', priceAdd: 25 },
            { label: 'Salan', value: 'Salan', priceAdd: 20 },
            { label: 'Extra Masala', value: 'Extra Masala', priceAdd: 15 },
            { label: 'Boiled Egg', value: 'Boiled Egg', priceAdd: 15 },
          ]
        },
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'Less oil, extra onions...' },
      ];

    case 'beverage':
      return [
        {
          label: 'Size', key: 'size', type: 'select',
          options: [
            { label: 'Small (250ml)', value: 'Small', priceAdd: 0 },
            { label: 'Medium (350ml)', value: 'Medium', priceAdd: 20 },
            { label: 'Large (500ml)', value: 'Large', priceAdd: 40 },
          ]
        },
        { label: 'Sugar Level', key: 'sugarLevel', type: 'select', options: [
          { label: 'No Sugar', value: 'No Sugar' }, { label: 'Less Sugar', value: 'Less Sugar' },
          { label: 'Normal', value: 'Normal' }, { label: 'Extra Sweet', value: 'Extra Sweet' },
        ]},
        { label: 'Temperature', key: 'temperature', type: 'select', options: [
          { label: '🧊 Cold', value: 'Cold' }, { label: '☕ Hot', value: 'Hot' },
          { label: 'Room Temperature', value: 'Room Temp' },
        ]},
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'No ice, extra cream...' },
      ];

    case 'burger':
      return [
        {
          label: 'Size', key: 'size', type: 'select',
          options: [
            { label: 'Regular', value: 'Regular', priceAdd: 0 },
            { label: 'Double', value: 'Double', priceAdd: 50 },
          ]
        },
        { label: 'Spice Level', key: 'spiceLevel', type: 'select', options: [
          { label: 'Mild', value: 'Mild' }, { label: 'Medium', value: 'Medium' },
          { label: 'Spicy', value: 'Spicy' },
        ]},
        {
          label: 'Add-ons', key: 'toppings', type: 'multi',
          options: [
            { label: 'Extra Cheese', value: 'Extra Cheese', priceAdd: 25 },
            { label: 'Extra Patty', value: 'Extra Patty', priceAdd: 50 },
            { label: 'Lettuce', value: 'Lettuce', priceAdd: 10 },
            { label: 'Mayo', value: 'Mayo', priceAdd: 10 },
          ]
        },
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'No onions, extra sauce...' },
      ];

    case 'dessert':
      return [
        {
          label: 'Size', key: 'size', type: 'select',
          options: [
            { label: 'Single Scoop', value: 'Single', priceAdd: 0 },
            { label: 'Double Scoop', value: 'Double', priceAdd: 40 },
            { label: 'Triple Scoop', value: 'Triple', priceAdd: 70 },
          ]
        },
        {
          label: 'Flavor', key: 'flavor', type: 'select',
          options: [
            { label: 'Chocolate', value: 'Chocolate' }, { label: 'Vanilla', value: 'Vanilla' },
            { label: 'Strawberry', value: 'Strawberry' }, { label: 'Mango', value: 'Mango' },
            { label: 'Butterscotch', value: 'Butterscotch' }, { label: 'Pista', value: 'Pista' },
          ]
        },
        {
          label: 'Toppings', key: 'toppings', type: 'multi',
          options: [
            { label: 'Chocolate Sauce', value: 'Chocolate Sauce', priceAdd: 15 },
            { label: 'Sprinkles', value: 'Sprinkles', priceAdd: 10 },
            { label: 'Nuts', value: 'Nuts', priceAdd: 20 },
            { label: 'Whipped Cream', value: 'Whipped Cream', priceAdd: 15 },
          ]
        },
      ];

    case 'sweets':
      return [
        {
          label: 'Weight', key: 'weight', type: 'select',
          options: [
            { label: '250g (Quarter)', value: '250g', priceAdd: 0 },
            { label: '500g (Half Kg)', value: '500g', priceAdd: Math.round(basePrice * 0.8) },
            { label: '1 Kg', value: '1 Kg', priceAdd: Math.round(basePrice * 2.5) },
            { label: '2 Kg', value: '2 Kg', priceAdd: Math.round(basePrice * 5.5) },
          ]
        },
        {
          label: 'Box Type', key: 'size', type: 'select',
          options: [
            { label: 'Regular Box', value: 'Regular' },
            { label: 'Gift Box', value: 'Gift Box', priceAdd: 50 },
            { label: 'Premium Gift Box', value: 'Premium Gift', priceAdd: 120 },
          ]
        },
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'Assorted mix, specific pieces...' },
      ];

    case 'fruit':
      return [
        {
          label: 'Weight', key: 'weight', type: 'select',
          options: [
            { label: '0.5 Kg', value: '0.5 Kg', priceAdd: 0 },
            { label: '1 Kg', value: '1 Kg', priceAdd: Math.round(basePrice * 0.8) },
            { label: '2 Kg', value: '2 Kg', priceAdd: Math.round(basePrice * 2.5) },
            { label: '3 Kg', value: '3 Kg', priceAdd: Math.round(basePrice * 4.5) },
          ]
        },
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'e.g. Needs to be ripe, green, etc.' },
      ];

    case 'laundry':
      return [
        {
          label: 'Type of Clothes', key: 'clothesType', type: 'select',
          options: [
            { label: 'Mixed Casuals', value: 'Mixed Casuals' },
            { label: 'Formals (Shirts/Pants)', value: 'Formals', priceAdd: 30 },
            { label: 'Blankets/Heavy', value: 'Blankets', priceAdd: 100 },
          ]
        },
        {
          label: 'Quantity (Approx)', key: 'clothesCount', type: 'select',
          options: [
            { label: '1-5 pieces', value: '1-5 pieces' },
            { label: '6-12 pieces', value: '6-12 pieces' },
            { label: 'Bulk', value: 'Bulk' },
          ]
        },
        {
          label: 'Weight', key: 'weight', type: 'select',
          options: [
            { label: 'Under 2 Kg', value: 'Under 2 Kg' },
            { label: '2-5 Kg', value: '2-5 Kg', priceAdd: 50 },
            { label: 'Over 5 Kg', value: 'Over 5 Kg', priceAdd: 100 },
          ]
        },
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'e.g. Use gentle wash, hard stains' },
      ];

    case 'rental':
      return [
        {
          label: 'Need a Driver?', key: 'rentalDetails', type: 'select',
          options: [
            { label: 'Self Drive', value: 'Self Drive' },
            { label: 'Include Driver', value: 'With Driver', priceAdd: 500 },
          ]
        },
        { label: 'Driver/Contact Note', key: 'rentalDriverContact', type: 'text', placeholder: 'Driver assigned post-booking. Enter requests here.' },
      ];

    case 'pharmacy':
      return [
        { label: 'Patient/Special Notes', key: 'specialInstructions', type: 'text', placeholder: 'e.g. Any specific symptoms or notes?' },
      ];

    case 'general-food':
      return [
        { label: 'Spice Level', key: 'spiceLevel', type: 'select', options: [
          { label: 'Mild', value: 'Mild' }, { label: 'Medium', value: 'Medium' },
          { label: 'Spicy 🌶️', value: 'Spicy' }, { label: 'Extra Spicy 🔥', value: 'Extra Spicy' },
        ]},
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'Any preferences, allergies...' },
      ];

    default:
      return [
        { label: 'Special Instructions', key: 'specialInstructions', type: 'text', placeholder: 'Any preferences or notes?' },
      ];
  }
}

const TYPE_LABELS: Record<ProductType, { emoji: string; title: string }> = {
  cake:     { emoji: '🎂', title: 'Customize Your Cake' },
  pizza:    { emoji: '🍕', title: 'Build Your Pizza' },
  biryani:  { emoji: '🍛', title: 'Configure Your Biryani' },
  beverage: { emoji: '🥤', title: 'Make Your Drink' },
  burger:   { emoji: '🍔', title: 'Build Your Burger' },
  dessert:  { emoji: '🍨', title: 'Customize Your Dessert' },
  sweets:   { emoji: '🍬', title: 'Select Your Sweets' },
  fruit:    { emoji: '🍎', title: 'Select Fruit Quantity' },
  laundry:  { emoji: '🧺', title: 'Laundry Details' },
  rental:   { emoji: '🚗', title: 'Rental Booking' },
  pharmacy: { emoji: '💊', title: 'Pharmacy Order' },
  'general-food': { emoji: '🍽️', title: 'Customize Your Meal' },
  general:  { emoji: '📦', title: 'Customize Your Order' },
};

interface CustomizeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (customizations: Customizations, finalPrice: number) => void;
  itemName: string;
  basePrice: number;
  tags?: string[];
  category?: string;
  isVegetarian?: boolean;
}

export default function CustomizeDrawer({ isOpen, onClose, onConfirm, itemName, basePrice, tags, category, isVegetarian = true }: CustomizeDrawerProps) {
  const productType = useMemo(() => detectProductType(itemName, tags, category), [itemName, tags, category]);
  const options = useMemo(() => getOptionsForType(productType, basePrice), [productType, basePrice]);
  const typeInfo = TYPE_LABELS[productType];

  const [selections, setSelections] = useState<Record<string, any>>({});

  React.useEffect(() => {
    if (isOpen) {
      const defaults: Record<string, any> = {};
      options.forEach(opt => {
        if (opt.type === 'select' && opt.options && opt.options.length > 0) {
          defaults[opt.key] = opt.options[0].value;
        } else if (opt.type === 'multi') {
          defaults[opt.key] = [];
        } else if (opt.type === 'text') {
          if (opt.key === 'cakeMessage') defaults[opt.key] = 'Happy Birthday!';
          else if (opt.key === 'specialInstructions') defaults[opt.key] = 'Please ensure fresh quality and safe packaging.';
          else if (opt.key === 'rentalDriverContact') defaults[opt.key] = 'Need an English speaking driver if possible.';
          else defaults[opt.key] = 'Standard preference applied.';
        }
      });
      setSelections(defaults);
    }
  }, [isOpen, options]);

  const computedPrice = useMemo(() => {
    let total = basePrice;
    options.forEach(opt => {
      if (opt.type === 'select' && opt.options) {
        const selected = opt.options.find(o => o.value === selections[opt.key]);
        if (selected?.priceAdd) total += selected.priceAdd;
      }
      if (opt.type === 'multi' && opt.options) {
        const selectedArr: string[] = selections[opt.key] || [];
        opt.options.forEach(o => {
          if (selectedArr.includes(o.value) && o.priceAdd) total += o.priceAdd;
        });
      }
    });
    return Math.round(total);
  }, [basePrice, selections, options]);

  const handleSelect = (key: string, value: string) => {
    setSelections(prev => ({ ...prev, [key]: value }));
  };

  const handleToggleMulti = (key: string, value: string) => {
    setSelections(prev => {
      const arr: string[] = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  };

  const handleText = (key: string, value: string) => {
    setSelections(prev => ({ ...prev, [key]: value }));
  };

  const handleConfirm = () => {
    const customizations: Customizations = {};
    Object.entries(selections).forEach(([key, val]) => {
      if (val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) {
        (customizations as any)[key] = key === 'slices' ? Number(val) : val;
      }
    });
    onConfirm(customizations, computedPrice);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col justify-end animate-in fade-in duration-200">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative bg-[#161618] border-t border-white/10 rounded-t-[32px] animate-in slide-in-from-bottom-8 duration-300 max-h-[85vh] flex flex-col shadow-2xl light:bg-white light:border-black">
        {/* Drag handle */}
        <div className="w-12 h-1.5 bg-white/15 rounded-full mx-auto mt-3.5 mb-2.5 shrink-0 light:bg-black" />

        {/* Header matching Zomato Screen 4 */}
        <div className="px-5 pb-4 pt-1.5 border-b border-white/5 flex justify-between items-start shrink-0 light:border-black">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {isVegetarian ? (
                <div className="w-4 h-4 border border-emerald-500 flex items-center justify-center p-[2.5px] rounded bg-transparent shrink-0">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                </div>
              ) : (
                <div className="w-4 h-4 border border-red-500 flex items-center justify-center p-[2.5px] rounded bg-transparent shrink-0">
                  <div className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-b-[7px] border-b-red-500" />
                </div>
              )}
              <h2 className="text-base font-black text-white light:text-gray-900 tracking-tight light:text-black">{typeInfo.title}</h2>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#EF4F5F]">{itemName}</p>
          </div>
          
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white light:text-gray-900/50 light:bg-black light:hover:bg-black/10 light:text-black transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Options list container */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">
          {options.map((opt) => (
            <div key={opt.key} className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#EF4F5F] block">
                {opt.label}
                {opt.type === 'multi' && <span className="text-white light:text-gray-900/20 normal-case tracking-normal ml-2 light:text-black">(select multiple)</span>}
              </label>

              {/* Radio (select) matching Zomato style */}
              {opt.type === 'select' && opt.options && (
                <div className="space-y-3 bg-white/[0.02] border border-white/5 p-3 rounded-2xl light:bg-black light:border-black">
                  {opt.options.map(o => {
                    const isSelected = selections[opt.key] === o.value;
                    return (
                      <button
                        key={o.value}
                        onClick={() => handleSelect(opt.key, o.value)}
                        className="w-full flex items-center justify-between py-2 text-left group focus:outline-none"
                      >
                        <div className="flex items-center gap-3">
                          {/* Radio Dot indicator */}
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'border-[#EF4F5F]' : 'border-white/20 light:border-black'
                          }`}>
                            {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-[#EF4F5F]" />}
                          </div>
                          <span className={`text-[12px] font-bold ${isSelected ? 'text-white light:text-black' : 'text-white light:text-gray-900/40 light:text-black'}`}>
                            {o.label}
                          </span>
                        </div>
                        {o.priceAdd ? (
                          <span className={`text-[11px] font-black ${isSelected ? 'text-[#EF4F5F]' : 'text-white light:text-gray-900/20 light:text-black'}`}>
                            +₹{o.priceAdd}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Checkbox (multi) matching Zomato style */}
              {opt.type === 'multi' && opt.options && (
                <div className="space-y-3 bg-white/[0.02] border border-white/5 p-3 rounded-2xl light:bg-black light:border-black">
                  {opt.options.map(o => {
                    const isSelected = (selections[opt.key] || []).includes(o.value);
                    return (
                      <button
                        key={o.value}
                        onClick={() => handleToggleMulti(opt.key, o.value)}
                        className="w-full flex items-center justify-between py-2 text-left group focus:outline-none"
                      >
                        <div className="flex items-center gap-3">
                          {/* Checkbox indicator */}
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'border-[#EF4F5F] bg-[#EF4F5F]/10' : 'border-white/20 light:border-black'
                          }`}>
                            {isSelected && <span className="text-[10px] text-[#EF4F5F] font-black">✓</span>}
                          </div>
                          <span className={`text-[12px] font-bold ${isSelected ? 'text-white light:text-black' : 'text-white light:text-gray-900/40 light:text-black'}`}>
                            {o.label}
                          </span>
                        </div>
                        {o.priceAdd ? (
                          <span className={`text-[11px] font-black ${isSelected ? 'text-[#EF4F5F]' : 'text-white light:text-gray-900/20 light:text-black'}`}>
                            +₹{o.priceAdd}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Text Area */}
              {opt.type === 'text' && (
                <input
                  type="text"
                  value={selections[opt.key] || ''}
                  onChange={e => handleText(opt.key, e.target.value)}
                  placeholder={opt.placeholder}
                  maxLength={100}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3.5 text-xs text-white light:text-gray-900 placeholder:text-white light:text-gray-900/15 outline-none focus:border-[#EF4F5F]/40 transition-all font-bold light:bg-black light:border-black light:text-black light:placeholder:text-black/20"
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer matching Zomato screen: Total Price (Left) + Confirm Red button (Right) */}
        <div className="px-5 py-4 border-t border-white/5 bg-[#0e0e10] shrink-0 flex items-center justify-between light:border-black light:bg-white">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-white light:text-gray-900/20 light:text-black">Total Price</span>
            <span className="text-xl font-black text-white light:text-gray-900 tracking-tighter light:text-black">
              ₹{computedPrice}
            </span>
          </div>

          <div className="flex gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[9px] font-black uppercase tracking-widest text-white light:text-gray-900/40 light:bg-black light:text-black transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-6 py-2.5 rounded-xl bg-[#EF4F5F] hover:bg-[#D93D4D] text-white light:text-gray-900 text-[9px] font-black uppercase tracking-widest shadow-md transition-colors"
            >
              Add Item
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function isCustomizable(name: string, tags?: string[], category?: string): boolean {
  return detectProductType(name, tags, category) !== 'general' || true;
}

export function summarizeCustomizations(c?: Customizations): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.weight) parts.push(c.weight);
  if (c.size) parts.push(c.size);
  if (c.flavor) parts.push(c.flavor);
  if (c.crust) parts.push(c.crust);
  if (c.slices) parts.push(`${c.slices} Slices`);
  if (c.eggPreference) parts.push(c.eggPreference);
  if (c.clothesType) parts.push(`Type: ${c.clothesType}`);
  if (c.clothesCount) parts.push(`Qty: ${c.clothesCount}`);
  if (c.rentalDetails) parts.push(c.rentalDetails);
  if (c.rentalDriverContact) parts.push(`Note: ${c.rentalDriverContact}`);
  if (c.spiceLevel) parts.push(c.spiceLevel);
  if (c.sugarLevel) parts.push(c.sugarLevel);
  if (c.temperature) parts.push(c.temperature);
  if (c.toppings && c.toppings.length > 0) parts.push(c.toppings.join(', '));
  if (c.cakeMessage) parts.push(`"${c.cakeMessage}"`);
  return parts.join(' • ');
}
