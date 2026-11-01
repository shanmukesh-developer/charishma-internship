import os, sys, json, hashlib, time, urllib.request, urllib.parse
from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'owner-menus', 'images', 'manu-dosa-place')
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'owner-menus')
os.makedirs(OUT_DIR, exist_ok=True)

ITEMS = [
    # Idly & Tiffins
    {
        "slug": "idly-4",
        "name": "Idly (4)",
        "price": 40,
        "category": "Idly & Tiffins",
        "dietType": "veg",
        "query": "Idli sambar",
        "desc": "Four steaming hot, pillowy soft steamed idlis made from naturally fermented rice and urad dal batter. Served with freshly ground coconut chutney and spicy Andhra sambar.\n\nIngredients (Typical):\n- Steamed rice and urad dal batter\n- Coconut chutney (fresh coconut, roasted chana dal, green chillies)\n- Drumstick and vegetable sambar\n\nSpicy Level: Mild\n\nServing Suggestion: Best eaten hot with a splash of warm sambar.\n\nTaste Profile: Soft, light, earthy and comforting."
    },
    {
        "slug": "ghee-idly-4",
        "name": "Ghee Idly (4)",
        "price": 60,
        "category": "Idly & Tiffins",
        "dietType": "veg",
        "query": "Podi idli",
        "desc": "Four tender steamed idlis generously smeared with aromatic desi ghee and tossed with traditional spicy gunpowder podi. A rich, flavour-packed Andhra breakfast classic.\n\nIngredients (Typical):\n- Four steamed idlis\n- Pure desi ghee\n- Andhra idli karam podi (lentil and red chilli spice mix)\n- Coconut chutney and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Dip into coconut chutney or enjoy the ghee-coated podi flavours directly.\n\nTaste Profile: Buttery rich, nutty, aromatic and mildly fiery."
    },
    {
        "slug": "idly-chicken-curry-4",
        "name": "Idly with Chicken Curry (4)",
        "price": 100,
        "category": "Non-Veg Specials",
        "dietType": "nonveg",
        "query": "Idli chicken curry",
        "desc": "Four piping hot, fluffy steamed idlis served submerged in spicy, rich Andhra country chicken gravy with tender chicken pieces. The ultimate Andhra breakfast indulgence.\n\nIngredients (Typical):\n- Four steamed rice idlis\n- Andhra chicken curry (chicken pieces, onion, tomato, poppy seeds, ginger-garlic paste, garam masala)\n- Coriander garnish\n\nSpicy Level: Hot\n\nServing Suggestion: Crush the idlis slightly so they soak up the rich chicken curry juices.\n\nTaste Profile: Fiery, savoury, deeply spiced and succulent."
    },
    # Classic Dosas
    {
        "slug": "plain-dosa",
        "name": "Plain Dosa",
        "price": 40,
        "category": "Classic Dosas",
        "dietType": "veg",
        "query": "Plain dosa",
        "desc": "Traditional golden-brown fermented rice and lentil crepe, roasted crisp on a seasoned cast-iron flat tawa. Light, crispy on the outside and airy inside, served with two chutneys and sambar.\n\nIngredients (Typical):\n- Fermented rice and urad dal batter\n- Groundnut and coconut chutney\n- Tomato ginger chutney\n- Tangy sambar\n\nSpicy Level: Mild\n\nServing Suggestion: Tear off crisp corners and dip into freshly tempered peanut chutney.\n\nTaste Profile: Crisp, slightly fermented, earthy and savoury."
    },
    {
        "slug": "onion-dosa",
        "name": "Onion Dosa",
        "price": 50,
        "category": "Classic Dosas",
        "dietType": "veg",
        "query": "Onion dosa",
        "desc": "Crispy golden dosa topped with a generous sprinkle of finely chopped sweet red onions, fresh green chillies, and ginger bits roasted right onto the batter on the hot tawa.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Diced red onions and green chillies\n- Fresh ginger and curry leaves\n- Peanut and coconut chutneys\n\nSpicy Level: Medium\n\nServing Suggestion: Best eaten hot while the onions retain their sweet, caramelised crunch.\n\nTaste Profile: Sweet onion crunch, savoury crepe, and spicy chilli warmth."
    },
    {
        "slug": "upma-dosa",
        "name": "Upma Dosa",
        "price": 50,
        "category": "Classic Dosas",
        "dietType": "veg",
        "query": "Upma dosa",
        "desc": "The iconic Andhra street tiffin favourite: a crisp golden roast dosa rolled around a steaming mound of hot, spiced semolina upma tempered with mustard, ginger, and curry leaves.\n\nIngredients (Typical):\n- Crisp rice-lentil dosa\n- Rava upma (semolina, mustard seeds, green chillies, ginger, cashews)\n- Ginger allam pachadi and coconut chutney\n\nSpicy Level: Medium\n\nServing Suggestion: Enjoy with spicy allam (ginger) chutney and sambar.\n\nTaste Profile: Crisp exterior contrasting with velvety, savoury upma."
    },
    {
        "slug": "masala-dosa",
        "name": "Masala Dosa",
        "price": 50,
        "category": "Classic Dosas",
        "dietType": "veg",
        "query": "Masala dosa",
        "desc": "Classic South Indian masala dosa with a crisp, golden-roasted crust wrapped around a fragrant potato sabzi seasoned with mustard seeds, turmeric, onions, and fresh curry leaves.\n\nIngredients (Typical):\n- Crisp fermented dosa\n- Potato aloo masala (boiled potatoes, onions, turmeric, green chillies, ginger)\n- Coconut chutney and vegetable sambar\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: Tear a piece with potato masala and dip generously into fresh coconut chutney.\n\nTaste Profile: Crisp, comforting, turmeric-spiced and aromatic."
    },
    {
        "slug": "karam-dosa",
        "name": "Karam Dosa",
        "price": 50,
        "category": "Classic Dosas",
        "dietType": "veg",
        "query": "Karam dosa",
        "desc": "Signature Rayalaseema & Andhra street-style karam dosa, brushed generously with a fiery red paste of garlic, dry red chillies, and roasted gram before roasting to a deep crimson crisp.\n\nIngredients (Typical):\n- Crisp dosa crepe\n- Erra karam paste (Guntur red chillies, garlic, onion, cumin, tamarind)\n- Roasted gram dal podi\n- Coconut chutney\n\nSpicy Level: Hot\n\nServing Suggestion: Pairs wonderfully with mild coconut chutney to balance the fierce garlic-chilli kick.\n\nTaste Profile: Bold, garlicky, fiery and intensely flavourful."
    },
    {
        "slug": "set-dosa",
        "name": "Set Dosa",
        "price": 60,
        "category": "Classic Dosas",
        "dietType": "veg",
        "query": "Set dosa",
        "desc": "A set of three soft, thick, spongy, and golden-spotted dosas cooked on low heat until cloud-like. Light on the stomach and served with mixed vegetable saagu and coconut chutney.\n\nIngredients (Typical):\n- Rice, poha and urad dal fermented batter\n- Mixed vegetable saagu / kurma\n- Coconut and coriander chutney\n\nSpicy Level: Mild\n\nServing Suggestion: Spoon coconut chutney over the spongy surface and let it absorb before eating.\n\nTaste Profile: Soft, cloud-like, mildly tangy and buttery."
    },
    # Ghee Dosas
    {
        "slug": "ghee-dosa",
        "name": "Ghee Dosa",
        "price": 60,
        "category": "Ghee Dosas",
        "dietType": "veg",
        "query": "Ghee roast dosa",
        "desc": "Paper-crisp, wafer-thin dosa roasted with generous ladles of pure fragrant desi ghee on a smoking hot cast-iron tawa until gleaming golden-brown and delightfully fragrant.\n\nIngredients (Typical):\n- Fermented rice-lentil dosa batter\n- Pure desi cow ghee\n- Chutneys and spiced sambar\n\nSpicy Level: Mild\n\nServing Suggestion: Eat immediately upon arrival while the ghee aroma and wafer crispness are at their peak.\n\nTaste Profile: Rich, nutty, aromatic and paper-crisp."
    },
    {
        "slug": "ghee-onion-dosa",
        "name": "Ghee Onion Dosa",
        "price": 70,
        "category": "Ghee Dosas",
        "dietType": "veg",
        "query": "Ghee onion dosa",
        "desc": "Pure ghee-roasted crispy dosa topped with sweet red onions that caramelise directly on the tawa in golden ghee. Infused with green chillies and fresh coriander leaves.\n\nIngredients (Typical):\n- Dosa batter roasted in pure desi ghee\n- Diced red onions and green chillies\n- Fresh coriander\n- Coconut and peanut chutneys\n\nSpicy Level: Medium\n\nServing Suggestion: Perfect for an evening snack with a hot cup of tea or filter coffee.\n\nTaste Profile: Caramelised onion sweetness, rich ghee depth, and crispy texture."
    },
    {
        "slug": "ghee-upma-dosa",
        "name": "Ghee Upma Dosa",
        "price": 70,
        "category": "Ghee Dosas",
        "dietType": "veg",
        "query": "Ghee upma dosa",
        "desc": "Flavourful Andhra specialty: a crisp dosa roasted in pure desi ghee, filled with hot, melt-in-mouth semolina upma prepared with ginger, mustard seeds, and cashews.\n\nIngredients (Typical):\n- Desi ghee roast dosa\n- Spiced rava upma\n- Roasted cashews, ginger and curry leaves\n- Ginger allam chutney and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Dip into spicy allam pachadi for the authentic coastal Andhra combination.\n\nTaste Profile: Decadent ghee richness, hearty filling, and comforting spices."
    },
    {
        "slug": "ghee-masala-dosa",
        "name": "Ghee Masala Dosa",
        "price": 70,
        "category": "Ghee Dosas",
        "dietType": "veg",
        "query": "Ghee masala dosa",
        "desc": "A crispy, golden-brown dosa roasted with pure desi ghee on the tawa, generously filled with a spiced potato-onion mash and folded to lock in the savoury warmth.\n\nIngredients (Typical):\n- Fermented dosa batter roasted with pure cow ghee\n- Spiced potato-onion filling\n- Fresh green chillies and ginger\n- Coconut chutney and hot sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Tear through the crackling ghee crust into the warm potato centre.\n\nTaste Profile: Fragrant ghee crunch giving way to soft, turmeric-spiced potato goodness."
    },
    {
        "slug": "ghee-karam-dosa",
        "name": "Ghee Karam Dosa",
        "price": 70,
        "category": "Ghee Dosas",
        "dietType": "veg",
        "query": "Ghee karam dosa",
        "desc": "The king of Andhra street dosas: fiery red chilli and garlic karam paste sizzled directly in golden desi ghee on the crisping dosa, dusted with roasted lentil podi.\n\nIngredients (Typical):\n- Crisp rice-lentil dosa\n- Fiery red chilli-garlic karam\n- Generous drizzle of hot desi ghee\n- Chana dal gun powder podi\n\nSpicy Level: Hot\n\nServing Suggestion: Dip into cooling coconut chutney to soothe the rich chilli-garlic heat.\n\nTaste Profile: Fiery spice, rich buttery ghee, garlicky punch and intense aroma."
    },
    # Butter Dosas
    {
        "slug": "butter-dosa",
        "name": "Butter Dosa",
        "price": 60,
        "category": "Butter Dosas",
        "dietType": "veg",
        "query": "Butter dosa",
        "desc": "A thick, golden-roasted dosa finished with melting cubes of fresh dairy butter that soak into the pores of the crepe, creating an irresistible golden crust.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Generous butter slabs (dairy butter)\n- Coconut and tomato chutneys\n- Spiced lentil sambar\n\nSpicy Level: Mild\n\nServing Suggestion: Eat hot while the butter is still glistening on the crust.\n\nTaste Profile: Creamy, rich, savoury and wonderfully crisp."
    },
    {
        "slug": "butter-onion-dosa",
        "name": "Butter Onion Dosa",
        "price": 80,
        "category": "Butter Dosas",
        "dietType": "veg",
        "query": "Butter onion dosa",
        "desc": "Crispy dosa prepared with liberal dollops of rich butter and studded with sweet, sautéed red onions and mild green chillies that caramelise on the smoking hot tawa.\n\nIngredients (Typical):\n- Dosa batter and rich dairy butter\n- Chopped red onions and green chillies\n- Fresh coriander leaves\n- Peanut and ginger chutneys\n\nSpicy Level: Medium\n\nServing Suggestion: Dip into ginger chutney for an irresistible sweet-savoury kick.\n\nTaste Profile: Buttery, sweet-onion crunch with gentle chilli heat."
    },
    {
        "slug": "butter-masala-dosa",
        "name": "Butter Masala Dosa",
        "price": 80,
        "category": "Butter Dosas",
        "dietType": "veg",
        "query": "Butter masala dosa",
        "desc": "Classic potato masala dosa roasted with generous portions of rich butter on the tawa, ensuring every bite is golden, crackling, and packed with buttery potato warmth.\n\nIngredients (Typical):\n- Dosa batter roasted with butter\n- Aloo masala (boiled potatoes, mustard, turmeric, ginger, curry leaves)\n- Coconut chutney and vegetable sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Tear off crisp corners and scoop up the hot, buttery potato filling.\n\nTaste Profile: Buttery, savoury, aromatic and comforting."
    },
    # Cheese Dosas
    {
        "slug": "cheese-dosa",
        "name": "Cheese Dosa",
        "price": 100,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Cheese dosa",
        "desc": "Crispy golden crepe smothered with a rich, bubbling blanket of shredded cheese that melts into a gooey, stretchy layer across the entire inner surface of the dosa.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Shredded mozzarella and processed cheese\n- Mild spices and butter\n- Coconut and tomato chutneys\n\nSpicy Level: Mild\n\nServing Suggestion: Pull apart to enjoy the satisfying cheese pull while piping hot.\n\nTaste Profile: Creamy, cheesy, salty, savoury and crisp."
    },
    {
        "slug": "onion-cheese-dosa",
        "name": "Onion Cheese Dosa",
        "price": 100,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Onion cheese dosa",
        "desc": "Golden tawa dosa topped with finely diced crunchy onions and smothered with molten processed cheese that caramelises at the edges for a flavourful fusion treat.\n\nIngredients (Typical):\n- Crisp dosa crepe\n- Finely chopped onions and green chillies\n- Shredded cheese\n- Chutneys and sambar\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: Best enjoyed straight from the tawa with spicy tomato chutney.\n\nTaste Profile: Crunchy sweet onions, gooey melted cheese, and savoury crepe."
    },
    {
        "slug": "masala-cheese-dosa",
        "name": "Masala Cheese Dosa",
        "price": 100,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Cheese masala dosa",
        "desc": "The best of both worlds: traditional spiced potato masala spread over a crisp golden dosa, topped with a generous layer of molten melted cheese.\n\nIngredients (Typical):\n- Dosa batter\n- Aloo masala filling (potatoes, onions, green chillies, curry leaves)\n- Grated melting cheese\n- Coconut chutney and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Pair with coconut chutney and tangy sambar.\n\nTaste Profile: Cheesy, creamy, potato-savoury, and deeply satisfying."
    },
    {
        "slug": "paneer-cheese-dosa",
        "name": "Paneer Cheese Dosa",
        "price": 120,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Paneer cheese dosa",
        "desc": "A protein-rich fusion favourite: fresh, tender grated paneer tossed with subtle spices and combined with shredded molten cheese melted into the hot, crispy dosa.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Fresh grated paneer (cottage cheese)\n- Shredded processed cheese\n- Mild herbs and butter\n- Chutneys\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: Enjoy hot with coconut and peanut chutney.\n\nTaste Profile: Soft milky paneer, gooey savoury cheese, and crackling dosa crust."
    },
    {
        "slug": "corn-cheese-dosa",
        "name": "Corn Cheese Dosa",
        "price": 120,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Corn cheese dosa",
        "desc": "Sweet, juicy American sweet corn kernels scattered over a crisp dosa and smothered in melted mozzarella cheese with a dash of black pepper and herb seasoning.\n\nIngredients (Typical):\n- Dosa crepe\n- Steamed sweet corn kernels\n- Grated mozzarella and cheddar cheese\n- Pepper and herb seasoning\n- Chutneys\n\nSpicy Level: Mild\n\nServing Suggestion: Great favourite among students craving a cheesy, mild snack.\n\nTaste Profile: Sweet juicy corn bursts, creamy melted cheese, and crispy base."
    },
    {
        "slug": "kaju-corn-cheese-dosa",
        "name": "Kaju Corn Cheese Dosa",
        "price": 150,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Cashew corn cheese dosa",
        "desc": "A deluxe street creation: roasted cashew nut halves, sweet corn kernels, and rich melted cheese rolled inside a golden-brown butter-crisped dosa.\n\nIngredients (Typical):\n- Crisp dosa batter\n- Toasted kaju (cashews)\n- Sweet corn kernels\n- Grated melting cheese\n- Mild seasoning and chutneys\n\nSpicy Level: Mild\n\nServing Suggestion: Eat hot to enjoy the nutty crunch alongside stretchy melted cheese.\n\nTaste Profile: Nutty crunch, sweet corn juicy pops, and creamy cheese indulgence."
    },
    {
        "slug": "schezwan-cheese-dosa",
        "name": "Schezwan Cheese Dosa",
        "price": 130,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Schezwan cheese dosa",
        "desc": "Bold Indo-Chinese fusion: fiery red Schezwan sauce smeared across the crisp dosa, balanced by a generous blanket of molten melted cheese and crunchy capsicum.\n\nIngredients (Typical):\n- Dosa crepe\n- Spicy garlic-chilli Schezwan sauce\n- Shredded melting cheese\n- Diced capsicum and onions\n- Chutneys\n\nSpicy Level: Hot\n\nServing Suggestion: The rich cheese tames the fiery Schezwan heat perfectly.\n\nTaste Profile: Spicy, garlicky, tangy, rich and cheesy."
    },
    {
        "slug": "lays-cheese-dosa",
        "name": "Lays Cheese Dosa",
        "price": 130,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Lays cheese dosa",
        "desc": "Famous campus fusion innovation: crushed crunchy Lay's potato chips sprinkled generously over the dosa, smothered in melted cheese and mild chaat seasoning.\n\nIngredients (Typical):\n- Dosa crepe\n- Classic spicy Lay's potato chips (crushed)\n- Shredded processed cheese\n- Chaat masala and butter\n\nSpicy Level: Medium\n\nServing Suggestion: Eat immediately for maximum potato chip crunch with gooey melted cheese.\n\nTaste Profile: Extra crunchy, salty, cheesy and fun street-food delight."
    },
    {
        "slug": "corn-paneer-cheese-dosa",
        "name": "Corn Paneer Cheese Dosa",
        "price": 160,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Corn paneer cheese dosa",
        "desc": "A loaded triple-delight dosa packed with sweet corn kernels, spiced crumbled paneer, and a thick blanket of gooey melted cheese roasted on a hot buttered tawa.\n\nIngredients (Typical):\n- Crisp fermented dosa\n- Sweet corn kernels\n- Fresh grated paneer\n- Shredded processed cheese\n- Mild herbs, chutneys and sambar\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: An extremely filling plate, perfect as a full dinner.\n\nTaste Profile: Rich, creamy, milky paneer texture, sweet corn pops, and gooey cheese."
    },
    {
        "slug": "egg-cheese-dosa",
        "name": "Egg Cheese Dosa",
        "price": 120,
        "category": "Egg & Non-Veg Dosas",
        "dietType": "egg",
        "query": "Egg cheese dosa",
        "desc": "Fresh farm egg cracked and whisked with onions and pepper directly over the dosa, then topped with molten shredded cheese and folded into a rich, savoury roll.\n\nIngredients (Typical):\n- Dosa batter\n- Farm-fresh egg\n- Diced onion, green chilli and black pepper\n- Grated melting cheese\n- Coconut chutney and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Cut into bite-sized rolls and dip into spicy tomato or ginger chutney.\n\nTaste Profile: Fluffy egg omelette layer, savoury cheese, and crisp dosa envelope."
    },
    {
        "slug": "dry-fruit-cheese-dosa",
        "name": "Dry Fruit Cheese Dosa",
        "price": 180,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Dry fruit cheese dosa",
        "desc": "Royal delicacy: golden-roasted cashews, crunchy almonds, and sweet raisins blended with melted cheddar and mozzarella cheese inside a butter-roasted crispy dosa.\n\nIngredients (Typical):\n- Crisp dosa crepe\n- Roasted cashews, sliced almonds and sultanas\n- Grated mozzarella and processed cheese\n- Mild cardamom and butter\n\nSpicy Level: Mild\n\nServing Suggestion: Excellent as a festive evening tiffin or rich dessert-style snack.\n\nTaste Profile: Nutty crunch, sweet raisin bursts, creamy cheese, and butter aroma."
    },
    {
        "slug": "mixed-cheese-dosa",
        "name": "Mixed Cheese Dosa",
        "price": 200,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Mixed cheese dosa",
        "desc": "The ultimate cheese lovers' feast: a crisp open dosa loaded with sweet corn, paneer cubes, cashews, diced capsicum, and a double layer of bubbling melted cheese.\n\nIngredients (Typical):\n- Butter roast dosa\n- Paneer, sweet corn, cashews, capsicum and onions\n- Double portion of shredded cheese\n- Spices and chutneys\n\nSpicy Level: Medium\n\nServing Suggestion: Cut into slices like a pizza roll; pair with coconut chutney.\n\nTaste Profile: Loaded, decadent, gooey, multi-textured and deeply flavourful."
    },
    # Non-Veg Specials
    {
        "slug": "parota-chicken-curry",
        "name": "Parota with Chicken Curry",
        "price": 120,
        "category": "Non-Veg Specials",
        "dietType": "nonveg",
        "query": "Parotta chicken curry",
        "desc": "Two flaky, layered, golden-brown Malabar-style parottas served with a hearty bowl of rich, spicy Andhra chicken curry packed with tender bone-in chicken pieces.\n\nIngredients (Typical):\n- Two flaky layered maida parottas\n- Spicy Andhra chicken curry (chicken pieces, onion, tomato, roasted spices, ginger-garlic)\n- Sliced raw onions and lemon wedge\n\nSpicy Level: Hot\n\nServing Suggestion: Tear the parotta into small pieces and dip deeply into the rich, oily chicken gravy.\n\nTaste Profile: Flaky, buttery bread pairing with deeply spiced, fiery chicken curry."
    },
    {
        "slug": "dosa-chicken-curry",
        "name": "Dosa with Chicken Curry",
        "price": 100,
        "category": "Non-Veg Specials",
        "dietType": "nonveg",
        "query": "Dosa chicken curry",
        "desc": "A large, crispy roasted dosa paired with a piping-hot bowl of rustic Andhra-style chicken curry infused with roasted coriander, red chillies, and ginger-garlic.\n\nIngredients (Typical):\n- Crispy tawa roast dosa\n- Andhra chicken curry (tender chicken, rich spiced gravy, curry leaves)\n- Sliced red onions\n\nSpicy Level: Hot\n\nServing Suggestion: Tear the hot crisp dosa and soak it generously into the rich chicken gravy.\n\nTaste Profile: Crispy, savoury crepe soaked in fiery, spicy and aromatic chicken gravy."
    },
    {
        "slug": "chicken-keema-dosa",
        "name": "Chicken Keema Dosa",
        "price": 100,
        "category": "Egg & Non-Veg Dosas",
        "dietType": "nonveg",
        "query": "Chicken keema dosa",
        "desc": "A legendary non-veg treat: finely minced chicken cooked with onions, tomatoes, and home-ground garam masala, spread generously over the dosa and folded crisp.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Minced chicken keema (chicken mince, onion, tomato, ginger-garlic, garam masala)\n- Coriander and mint\n- Chutneys and gravy\n\nSpicy Level: Hot\n\nServing Suggestion: Best enjoyed hot with coconut chutney and extra curry gravy on the side.\n\nTaste Profile: Meaty, spicy, succulent, aromatic and crispy."
    },
    {
        "slug": "cheese-keema-dosa",
        "name": "Cheese Keema Dosa",
        "price": 140,
        "category": "Egg & Non-Veg Dosas",
        "dietType": "nonveg",
        "query": "Cheese keema dosa",
        "desc": "Spicy minced chicken keema masala spread over hot dosa and topped with a thick blanket of shredded cheese that melts into the spiced chicken mince.\n\nIngredients (Typical):\n- Crispy dosa\n- Spiced chicken keema mince\n- Shredded melting cheese\n- Herbs, onions and chutneys\n\nSpicy Level: Medium to Hot\n\nServing Suggestion: Eat piping hot while the cheese is gooey and intertwined with the keema.\n\nTaste Profile: Fiery spiced chicken keema softened by rich, creamy melted cheese."
    },
    # Special Veg Dosas
    {
        "slug": "sweet-corn-dosa",
        "name": "Sweet Corn Dosa",
        "price": 100,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Sweet corn dosa",
        "desc": "Crispy golden dosa filled with butter-tossed juicy sweet corn, sprinkled with a touch of chaat masala, pepper, and finely diced coriander.\n\nIngredients (Typical):\n- Dosa batter and butter\n- Sweet corn kernels\n- Chaat masala and black pepper\n- Coconut and tomato chutneys\n\nSpicy Level: Mild\n\nServing Suggestion: Great light evening snack for corn lovers.\n\nTaste Profile: Sweet, juicy, buttery and crisp."
    },
    {
        "slug": "paneer-dosa",
        "name": "Paneer Dosa",
        "price": 100,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Paneer dosa",
        "desc": "Soft, freshly grated paneer tossed with diced onions, green chillies, and aromatic cumin seeds, rolled into a golden, butter-roasted crispy dosa.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Grated fresh cottage cheese (paneer)\n- Onions, green chillies, cumin and coriander\n- Chutneys and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Dip into spicy tomato-onion chutney or cool coconut chutney.\n\nTaste Profile: Soft crumbly paneer texture, fragrant cumin, and crisp crepe."
    },
    {
        "slug": "lays-dosa",
        "name": "Lays Dosa",
        "price": 100,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Lays dosa",
        "desc": "Campus favourite fusion tiffin: crispy dosa folded around crushed spicy Lay's potato chips, raw onions, and tangy chaat masala for an irresistible double-crunch.\n\nIngredients (Typical):\n- Crisp dosa crepe\n- Lay's spicy potato chips (crushed)\n- Diced red onions and chaat masala\n- Coconut chutney\n\nSpicy Level: Medium\n\nServing Suggestion: Eat immediately upon arrival to preserve the potato chip crunch.\n\nTaste Profile: Tangy, salty, double-crunchy and playful street food flavour."
    },
    {
        "slug": "kaju-dosa",
        "name": "Kaju Dosa",
        "price": 120,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Cashew kaju dosa",
        "desc": "Golden roast dosa studded generously with whole and split cashew nuts toasted in desi ghee until crunchy, golden-brown and delightfully nutty.\n\nIngredients (Typical):\n- Dosa batter roasted in ghee\n- Premium kaju (cashew nuts)\n- Mild black pepper and salt\n- Coconut chutney and allam pachadi\n\nSpicy Level: Mild\n\nServing Suggestion: Pairs wonderfully with spicy ginger (allam) chutney.\n\nTaste Profile: Crunchy nutty richness, buttery aroma, and crisp dosa shell."
    },
    {
        "slug": "dry-fruit-dosa",
        "name": "Dry Fruit Dosa",
        "price": 150,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Dry fruit dosa",
        "desc": "A luxurious blend of crunchy cashews, roasted almond slivers, and sweet sultanas toasted into a golden, fragrant ghee-roasted crepe.\n\nIngredients (Typical):\n- Desi ghee roast dosa\n- Cashews, almonds and raisins\n- Mild cardamom spice dust\n- Coconut chutney\n\nSpicy Level: Mild\n\nServing Suggestion: Savour as an evening treat or celebratory breakfast.\n\nTaste Profile: Sweet and savoury balance, crunchy nut texture, and ghee aroma."
    },
    {
        "slug": "chocolate-dosa",
        "name": "Chocolate Dosa",
        "price": 100,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Chocolate dosa",
        "desc": "A delightful dessert dosa: thin, crispy hot crepe slathered with rich hazelnut chocolate spread and dark chocolate syrup, folded and dusted with chocolate shavings.\n\nIngredients (Typical):\n- Thin crisp crepe\n- Premium chocolate spread (hazelnut/cocoa)\n- Chocolate drizzle\n- Butter\n\nSpicy Level: Sweet (No Spice)\n\nServing Suggestion: Best eaten hot as a dessert or sweet treat after a meal.\n\nTaste Profile: Crisp exterior, warm melting chocolate, sweet and decadent."
    },
    {
        "slug": "schezwan-dosa",
        "name": "Schezwan Dosa",
        "price": 100,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Schezwan dosa",
        "desc": "Street-style Indo-Chinese fusion: crisp dosa smeared with fiery red Schezwan sauce, tossed with finely shredded cabbage, capsicum, onions, and spring onions.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Spicy red chilli-garlic Schezwan sauce\n- Shredded cabbage, carrot and capsicum\n- Soy sauce and spices\n\nSpicy Level: Hot\n\nServing Suggestion: Best enjoyed hot straight from the wok-tossed dosa tawa.\n\nTaste Profile: Fiery, garlicky, tangy and crunchy."
    },
    {
        "slug": "mixed-veg-dosa",
        "name": "Mixed Veg Dosa",
        "price": 170,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Mixed veg dosa",
        "desc": "Wholesome, colourful dosa loaded with a stir-fried medley of shredded cabbage, carrots, capsicum, green peas, sweet corn, and mild Indian spices.\n\nIngredients (Typical):\n- Crisp rice-lentil dosa\n- Mixed vegetables (cabbage, carrot, capsicum, corn, peas)\n- Ginger, cumin and mild garam masala\n- Chutneys and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: A hearty, healthy dinner choice packed with fresh vegetables.\n\nTaste Profile: Fresh vegetable crunch, savoury spices, and golden crisp base."
    },
    {
        "slug": "vegetable-dosa",
        "name": "Vegetable Dosa",
        "price": 100,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Vegetable dosa",
        "desc": "Simple, hearty dosa filled with mildly spiced sautéed onions, tomatoes, green chillies, and coriander, cooked to a crisp golden finish on the tawa.\n\nIngredients (Typical):\n- Dosa crepe\n- Sautéed onion, tomato and coriander masala\n- Mustard seeds and cumin\n- Coconut chutney and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Dip into fresh peanut-coconut chutney for a quick filling meal.\n\nTaste Profile: Tangy tomato notes, sweet onions, and crisp dosa shell."
    },
    {
        "slug": "kaju-paneer-cheese-dosa",
        "name": "Kaju Paneer Cheese Dosa",
        "price": 180,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Kaju paneer cheese dosa",
        "desc": "A premium trio of toasted cashews, tender crumbled paneer, and rich molten cheese spread generously across a crisp, golden butter-roasted dosa.\n\nIngredients (Typical):\n- Dosa batter and butter\n- Roasted cashew nuts (kaju)\n- Grated fresh paneer\n- Shredded melting cheese\n- Chutneys\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: Eat piping hot to savour the contrast between crunchy nuts and gooey cheese.\n\nTaste Profile: Nutty, milky, cheesy, decadent and deeply satisfying."
    },
    {
        "slug": "kaju-corn-dosa",
        "name": "Kaju Corn Dosa",
        "price": 140,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Kaju corn dosa",
        "desc": "Crunchy toasted cashew nuts paired with juicy sweet corn kernels, tossed with mild pepper and butter on the tawa before rolling into a crisp dosa.\n\nIngredients (Typical):\n- Crispy dosa crepe\n- Toasted kaju pieces\n- Steamed sweet corn kernels\n- Butter, black pepper and salt\n\nSpicy Level: Mild\n\nServing Suggestion: Excellent with allam (ginger) chutney and mild coconut chutney.\n\nTaste Profile: Sweet corn bursts, toasted nutty crunch, and savoury crepe."
    },
    {
        "slug": "kaju-paneer-dosa",
        "name": "Kaju Paneer Dosa",
        "price": 140,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Kaju paneer dosa",
        "desc": "A hearty vegetarian favourite: roasted golden cashews and fresh grated paneer seasoned with cumin, coriander, and green chillies folded in a crispy dosa.\n\nIngredients (Typical):\n- Dosa crepe\n- Toasted cashew nuts\n- Fresh grated cottage cheese (paneer)\n- Herbs, spices and chutneys\n\nSpicy Level: Medium\n\nServing Suggestion: Pair with coconut chutney and hot drumstick sambar.\n\nTaste Profile: Rich, nutty, crumbly paneer texture, and golden crispness."
    },
    {
        "slug": "corn-paneer-dosa",
        "name": "Corn Paneer Dosa",
        "price": 120,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Corn paneer dosa",
        "desc": "Juicy sweet corn kernels and grated fresh paneer sautéed with mild Indian spices and fresh herbs, tucked into a crispy golden dosa.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Sweet corn and fresh paneer\n- Cumin, ginger, green chillies and coriander\n- Chutneys\n\nSpicy Level: Medium\n\nServing Suggestion: Great choice for students looking for a healthy, protein-rich bite.\n\nTaste Profile: Juicy, soft, savoury and nicely balanced."
    },
    {
        "slug": "schezwan-corn-dosa",
        "name": "Schezwan Corn Dosa",
        "price": 130,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Schezwan corn dosa",
        "desc": "Zesty Indo-Chinese fusion: sweet corn kernels tossed in spicy garlic-chilli Schezwan sauce, spread over a hot tawa dosa and cooked to a crisp finish.\n\nIngredients (Typical):\n- Dosa crepe\n- Schezwan chilli-garlic sauce\n- Sweet corn kernels and spring onions\n- Chutneys\n\nSpicy Level: Hot\n\nServing Suggestion: Pair with cooling coconut chutney to tame the chilli warmth.\n\nTaste Profile: Fiery, garlicky, sweet-and-spicy corn combination."
    },
    {
        "slug": "schezwan-kaju-dosa",
        "name": "Schezwan Kaju Dosa",
        "price": 150,
        "category": "Special Veg Dosas",
        "dietType": "veg",
        "query": "Schezwan kaju dosa",
        "desc": "Crunchy roasted cashews tossed directly in fiery red Schezwan sauce with garlic and spring onions, folded into a crackling crisp dosa.\n\nIngredients (Typical):\n- Crispy dosa\n- Roasted cashew nuts (kaju)\n- Spicy Schezwan sauce\n- Spring onions and coriander\n\nSpicy Level: Hot\n\nServing Suggestion: A bold, spicy tiffin option for lovers of fiery flavours.\n\nTaste Profile: Fiery garlic spice with a rich, buttery cashew nut crunch."
    },
    {
        "slug": "egg-keema-dosa",
        "name": "Egg Keema Dosa",
        "price": 140,
        "category": "Egg & Non-Veg Dosas",
        "dietType": "nonveg",
        "query": "Egg keema dosa",
        "desc": "Spicy chicken keema mince and a beaten farm egg cooked together directly onto the roasting dosa, infusing the meat and egg into a thick, juicy, savoury layer.\n\nIngredients (Typical):\n- Dosa crepe\n- Farm egg\n- Spiced minced chicken keema\n- Onions, green chillies and garam masala\n\nSpicy Level: Hot\n\nServing Suggestion: Enjoy with chicken curry gravy or coconut chutney.\n\nTaste Profile: Meaty, egg-rich, deeply spiced, hearty and filling."
    },
    # Pizza Dosas
    {
        "slug": "pizza-dosa",
        "name": "Pizza Dosa",
        "price": 120,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Pizza dosa",
        "desc": "Open-faced crispy dosa prepared pizza-style: slathered with tangy pizza sauce, topped with onions, capsicum, oregano, and a thick layer of molten mozzarella.\n\nIngredients (Typical):\n- Crispy dosa base\n- Italian pizza tomato sauce\n- Diced capsicum, onions and tomatoes\n- Shredded mozzarella cheese, oregano and chilli flakes\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: Sliced into pizza triangles; eat immediately while cheese is bubbling.\n\nTaste Profile: Tangy herb tomato sauce, gooey mozzarella cheese pull, and crisp crust."
    },
    {
        "slug": "corn-pizza-dosa",
        "name": "Corn Pizza Dosa",
        "price": 150,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Corn pizza dosa",
        "desc": "Italian-South Indian fusion: open-faced crispy dosa topped with pizza sauce, juicy sweet corn kernels, Italian herbs, and molten melted cheese.\n\nIngredients (Typical):\n- Crispy dosa base\n- Sweet corn kernels\n- Pizza tomato sauce, oregano, chilli flakes\n- Mozzarella cheese\n\nSpicy Level: Mild\n\nServing Suggestion: Perfect fusion comfort food for evening hunger pangs.\n\nTaste Profile: Sweet corn pops, tangy pizza sauce, and gooey cheese."
    },
    {
        "slug": "paneer-pizza-dosa",
        "name": "Paneer Pizza Dosa",
        "price": 150,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Paneer pizza dosa",
        "desc": "Pizza dosa loaded with seasoned paneer cubes, crunchy capsicum, tangy pizza sauce, and an abundance of melted mozzarella cheese.\n\nIngredients (Typical):\n- Dosa crust\n- Diced cottage cheese (paneer)\n- Capsicum, onions, pizza sauce\n- Mozzarella cheese and Italian herbs\n\nSpicy Level: Medium\n\nServing Suggestion: Sliced into wedges, best enjoyed hot.\n\nTaste Profile: Herb-scented, creamy paneer bites, gooey cheese, and savoury base."
    },
    {
        "slug": "kaju-pizza-dosa",
        "name": "Kaju Pizza Dosa",
        "price": 170,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Kaju pizza dosa",
        "desc": "Decadent open pizza dosa topped with roasted cashews, herb-infused pizza sauce, capsicum, onions, and molten melted mozzarella cheese.\n\nIngredients (Typical):\n- Crispy dosa\n- Roasted cashew nuts\n- Pizza sauce and Italian seasoning\n- Shredded mozzarella and cheddar cheese\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: A rich, unique fusion favourite among campus students.\n\nTaste Profile: Rich nutty crunch, tangy pizza sauce, and velvety melted cheese."
    },
    {
        "slug": "corn-paneer-pizza-dosa",
        "name": "Corn Paneer Pizza Dosa",
        "price": 180,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Corn paneer pizza dosa",
        "desc": "Double topping pizza dosa with sweet corn kernels and diced paneer cubes baked over a crisp dosa with pizza sauce and bubbling mozzarella cheese.\n\nIngredients (Typical):\n- Dosa base\n- Sweet corn and paneer cubes\n- Pizza sauce, capsicum, oregano\n- Mozzarella cheese\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: Eat piping hot for the ultimate cheese and corn indulgence.\n\nTaste Profile: Creamy paneer, sweet corn bursts, tangy sauce, and stretchy cheese."
    },
    {
        "slug": "kaju-paneer-pizza-dosa",
        "name": "Kaju Paneer Pizza Dosa",
        "price": 200,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Kaju paneer pizza dosa",
        "desc": "Luxurious fusion: roasted cashew nuts and marinated paneer cubes spread over tangy pizza sauce on a crispy dosa base, finished with bubbling cheese.\n\nIngredients (Typical):\n- Dosa crust\n- Toasted cashews and paneer\n- Italian herb pizza sauce, capsicum\n- Shredded mozzarella cheese\n\nSpicy Level: Medium\n\nServing Suggestion: A showstopper dish, best shared among friends.\n\nTaste Profile: Nutty crunch, soft paneer, aromatic pizza herbs, and molten cheese."
    },
    {
        "slug": "kaju-corn-pizza-dosa",
        "name": "Kaju Corn Pizza Dosa",
        "price": 200,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Kaju corn pizza dosa",
        "desc": "Open pizza dosa topped with toasted cashew nuts, sweet corn kernels, capsicum, pizza sauce, oregano, and generous molten mozzarella cheese.\n\nIngredients (Typical):\n- Crispy dosa base\n- Roasted kaju and sweet corn\n- Tomato pizza sauce, oregano\n- Mozzarella cheese\n\nSpicy Level: Mild to Medium\n\nServing Suggestion: Enjoy hot while the cheese stretches.\n\nTaste Profile: Sweet corn freshness, toasted cashews, tangy sauce, and rich cheese."
    },
    {
        "slug": "mixed-pizza-dosa",
        "name": "Mixed Pizza Dosa",
        "price": 250,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Special mixed pizza dosa",
        "desc": "The ultimate supreme pizza dosa: loaded with sweet corn, paneer, cashews, onions, capsicum, olives, pizza sauce, and double mozzarella cheese.\n\nIngredients (Typical):\n- Crispy large dosa base\n- Paneer, sweet corn, cashews, capsicum, onions\n- Double portion of mozzarella cheese\n- Italian pizza sauce and herbs\n\nSpicy Level: Medium\n\nServing Suggestion: Cut into 6 pizza slices; perfect for sharing.\n\nTaste Profile: Incredibly rich, multi-textured, gooey, aromatic and deeply satisfying."
    },
    {
        "slug": "dry-fruits-pizza-dosa",
        "name": "Dry Fruits Pizza Dosa",
        "price": 250,
        "category": "Pizza Dosas",
        "dietType": "veg",
        "query": "Dry fruits pizza dosa",
        "desc": "Exotic fusion masterpiece: crispy dosa base topped with roasted cashews, sliced almonds, raisins, sweet-savoury pizza glaze, and melted mozzarella.\n\nIngredients (Typical):\n- Crispy dosa base\n- Cashews, almonds, raisins\n- Special glaze, mozzarella cheese\n- Mild herbs\n\nSpicy Level: Mild\n\nServing Suggestion: A unique, rich gourmet dosa experience.\n\nTaste Profile: Sweet raisin bursts, crunchy toasted nuts, and creamy melted cheese."
    },
    # Egg Dosas
    {
        "slug": "egg-dosa",
        "name": "Egg Dosa",
        "price": 60,
        "category": "Egg & Non-Veg Dosas",
        "dietType": "egg",
        "query": "Egg dosa",
        "desc": "Fresh farm egg cracked onto the roasting dosa, spread evenly with finely chopped onions, green chillies, curry leaves, and freshly ground black pepper.\n\nIngredients (Typical):\n- Fermented dosa batter\n- Farm fresh egg\n- Diced red onions, green chillies, black pepper and cumin\n- Coconut chutney and sambar\n\nSpicy Level: Medium\n\nServing Suggestion: Eat hot with spicy tomato chutney or coconut chutney.\n\nTaste Profile: Fluffy egg omelette fused with a golden, crispy dosa crust."
    },
    {
        "slug": "kaju-corn-cheese-special-dosa",
        "name": "Kaju Corn Cheese Special Dosa",
        "price": 180,
        "category": "Cheese Dosas",
        "dietType": "veg",
        "query": "Special kaju corn cheese dosa",
        "desc": "Special house edition: extra toasted cashews, sweet corn kernels, and double cheddar-mozzarella cheese melted over a large butter-crisped dosa.\n\nIngredients (Typical):\n- Butter roast large dosa\n- Double portion of toasted kaju\n- Sweet corn kernels\n- Extra shredded cheese and herbs\n\nSpicy Level: Mild\n\nServing Suggestion: An extraordinary treat for cheese and cashew lovers.\n\nTaste Profile: Extra rich, ultra-cheesy, crunchy and savoury."
    }
]

print(f"Total items defined: {len(ITEMS)}")

