import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { Customizations } from '../context/CartContext';

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
  const { isDark } = useTheme();
  const productType = useMemo(() => detectProductType(itemName, tags, category), [itemName, tags, category]);
  const options = useMemo(() => getOptionsForType(productType, basePrice), [productType, basePrice]);
  const typeInfo = TYPE_LABELS[productType];

  const [selections, setSelections] = useState<Record<string, any>>({});

  useEffect(() => {
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

  const bg = isDark ? COLORS.bgCard : '#FFFFFF';
  const textClr = isDark ? COLORS.textPrimary : COLORS.textDark;
  const subTextClr = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const borderClr = isDark ? COLORS.borderDark : COLORS.borderLight;
  const optionBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)';

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.modalOverlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        
        <View style={[s.drawerContainer, { backgroundColor: bg }]}>
          {/* Drag Handle */}
          <View style={[s.dragHandle, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)' }]} />

          {/* Header */}
          <View style={[s.header, { borderBottomColor: borderClr }]}>
            <View style={s.headerLeft}>
              <View style={s.headerTitleRow}>
                <View style={[s.vegOuter, { borderColor: isVegetarian ? '#22C55E' : '#EF4444' }]}>
                  <View style={[s.vegInner, { backgroundColor: isVegetarian ? '#22C55E' : '#EF4444' }]} />
                </View>
                <Text style={[s.headerTitle, { color: textClr }]}>{typeInfo?.title || 'Customize Your Order'}</Text>
              </View>
              <Text style={s.itemName}>{itemName.toUpperCase()}</Text>
            </View>
            <TouchableOpacity style={[s.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} onPress={onClose}>
              <Text style={{ color: textClr, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable Options */}
          <ScrollView style={s.optionsList} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {options.map((opt) => (
              <View key={opt.key} style={s.optionSection}>
                <Text style={s.optionLabel}>
                  {opt.label.toUpperCase()}
                  {opt.type === 'multi' && <Text style={{ color: subTextClr, textTransform: 'none' }}> (select multiple)</Text>}
                </Text>

                {/* Radio selections */}
                {opt.type === 'select' && opt.options && (
                  <View style={[s.optionsBox, { backgroundColor: optionBg, borderColor: borderClr }]}>
                    {opt.options.map(o => {
                      const isSelected = selections[opt.key] === o.value;
                      return (
                        <TouchableOpacity
                          key={o.value}
                          activeOpacity={0.8}
                          onPress={() => handleSelect(opt.key, o.value)}
                          style={s.optionItem}
                        >
                          <View style={s.optionItemLeft}>
                            <View style={[s.radioDot, { borderColor: isSelected ? COLORS.red : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)') }]}>
                              {isSelected && <View style={s.radioDotInner} />}
                            </View>
                            <Text style={[s.optionItemLabel, { color: textClr }]}>{o.label}</Text>
                          </View>
                          {o.priceAdd ? (
                            <Text style={[s.priceAddText, { color: isSelected ? COLORS.red : subTextClr }]}>
                              +₹{o.priceAdd}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Multi Checkbox selections */}
                {opt.type === 'multi' && opt.options && (
                  <View style={[s.optionsBox, { backgroundColor: optionBg, borderColor: borderClr }]}>
                    {opt.options.map(o => {
                      const isSelected = (selections[opt.key] || []).includes(o.value);
                      return (
                        <TouchableOpacity
                          key={o.value}
                          activeOpacity={0.8}
                          onPress={() => handleToggleMulti(opt.key, o.value)}
                          style={s.optionItem}
                        >
                          <View style={s.optionItemLeft}>
                            <View style={[s.checkbox, { borderColor: isSelected ? COLORS.red : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'), backgroundColor: isSelected ? `${COLORS.red}20` : 'transparent' }]}>
                              {isSelected && <Text style={s.checkboxCheck}>✓</Text>}
                            </View>
                            <Text style={[s.optionItemLabel, { color: textClr }]}>{o.label}</Text>
                          </View>
                          {o.priceAdd ? (
                            <Text style={[s.priceAddText, { color: isSelected ? COLORS.red : subTextClr }]}>
                              +₹{o.priceAdd}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Text input */}
                {opt.type === 'text' && (
                  <TextInput
                    style={[s.textInput, { color: textClr, borderColor: borderClr, backgroundColor: optionBg }]}
                    value={selections[opt.key] || ''}
                    onChangeText={val => handleText(opt.key, val)}
                    placeholder={opt.placeholder}
                    placeholderTextColor={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}
                    maxLength={100}
                  />
                )}
              </View>
            ))}
          </ScrollView>

          {/* Footer */}
          <View style={[s.footer, { borderTopColor: borderClr, backgroundColor: isDark ? '#0F0F10' : '#FAFAFA' }]}>
            <View style={s.footerLeft}>
              <Text style={[s.footerPriceLabel, { color: subTextClr }]}>TOTAL PRICE</Text>
              <Text style={[s.footerPrice, { color: textClr }]}>₹{computedPrice}</Text>
            </View>

            <View style={s.footerButtons}>
              <TouchableOpacity style={s.cancelBtnFooter} onPress={onClose}>
                <Text style={[s.cancelBtnText, { color: subTextClr }]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, s.confirmBtnShadow]} onPress={handleConfirm}>
                <Text style={s.confirmBtnText}>ADD ITEM</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
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

const s = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  drawerContainer: { borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '85%', overflow: 'hidden' },
  dragHandle: { width: 48, height: 5, borderRadius: 2.5, alignSelf: 'center', marginTop: 12, marginBottom: 12 },
  
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  headerLeft: { flex: 1, paddingRight: 10 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  itemName: { fontSize: 9, fontWeight: '900', color: COLORS.red, letterSpacing: 2, marginTop: 4 },
  
  vegOuter: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegInner: { width: 6, height: 6, borderRadius: 3 },
  
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  optionsList: { paddingHorizontal: 20, paddingTop: 16 },
  
  optionSection: { marginBottom: 24 },
  optionLabel: { fontSize: 9, fontWeight: '900', color: COLORS.red, letterSpacing: 2, marginBottom: 10 },
  
  optionsBox: { borderRadius: 20, borderWidth: 1, padding: 12 },
  optionItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  optionItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  
  radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDotInner: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: COLORS.red },
  
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkboxCheck: { color: COLORS.red, fontSize: 10, fontWeight: '900' },
  
  optionItemLabel: { fontSize: 12, fontWeight: '700' },
  priceAddText: { fontSize: 11, fontWeight: '800' },
  
  textInput: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, fontSize: 12, fontWeight: '700' },
  
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1 },
  footerLeft: { flexDirection: 'column' },
  footerPriceLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  footerPrice: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  
  footerButtons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cancelBtnFooter: { paddingVertical: 10, paddingHorizontal: 16 },
  cancelBtnText: { fontSize: 9, fontWeight: '900', letterSpacing: 2 },
  
  confirmBtn: { backgroundColor: COLORS.red, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  confirmBtnShadow: {
    shadowColor: COLORS.red,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  }
});
