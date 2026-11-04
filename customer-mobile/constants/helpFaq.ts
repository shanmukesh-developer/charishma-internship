// Help & FAQ content (app/help.tsx). Owner-editable: change the text here, keep it true to how the app
// works today. Plain sentence case, no emoji, no exclamation marks.
// Facts used below: food and grocery orders are delivered in 3 daily IST slots (12:30–1:00 PM, 4:30–5:30 PM,
// 8:30–9:30 PM; booking closes 1 h before, cakes 2 h); Cash on delivery and Zenvy Wallet only;
// stores have 7 minutes to accept; customer cancel while Pending or within 2 minutes while the store
// has it; refunds go to the Zenvy Wallet; delivery PIN at handover.

export type FaqItem = { q: string; a: string };
export type FaqSection = { title: string; items: FaqItem[] };

export const HELP_FAQ: FaqSection[] = [
  {
    title: 'Ordering',
    items: [
      {
        q: 'When can I order?',
        a: 'Food and groceries are delivered in three daily slots: 12:30–1:00 PM, 4:30–5:30 PM and 8:30–9:30 PM. Order any time; booking for a slot closes 1 hour before it starts (2 hours for cakes), and you can always pick one of tomorrow\'s slots. Campus stalls deliver while they are open.',
      },
      {
        q: 'What happens after I place an order?',
        a: 'The store gets 7 minutes to accept it. If it does not, the order is cancelled automatically and anything you paid from your Wallet goes back to your Wallet.',
      },
      {
        q: 'How do I follow my order?',
        a: 'Open Orders and tap the order. The tracking screen shows each step, from accepted to out for delivery to delivered.',
      },
    ],
  },
  {
    title: 'Payments and Wallet',
    items: [
      {
        q: 'How can I pay?',
        a: 'Food and grocery orders: cash on delivery or your ZENV Wallet (no card or UPI checkout). In-Campus Booking is different: you pay the stall directly by UPI and send the payment screenshot and transaction ID.',
      },
      {
        q: 'What is the ZENV Wallet?',
        a: 'Your Wallet holds refunds, rewards and credits. You can use the balance at checkout. Profile shows your balance and Wallet history.',
      },
    ],
  },
  {
    title: 'Delivery',
    items: [
      {
        q: 'What is the Delivery PIN?',
        a: 'Orders delivered by a ZENV rider have a 4-digit Delivery PIN on the tracking screen and in Orders. Share it only when you have the order in your hands. Stall orders have no PIN. After 5 wrong tries the PIN is locked and ZENV support completes the handover: contact support from the order page.',
      },
      {
        q: 'Where is my order delivered?',
        a: 'At your hostel gate: your rider calls you when they arrive. The hostel block and room number you confirm at checkout (filled in from your profile) help them find you; you can pick a saved place or type a different one.',
      },
    ],
  },
  {
    title: 'Cancellations and refunds',
    items: [
      {
        q: 'Can I cancel an order?',
        a: 'Yes, while the store has not accepted it yet, or within 2 minutes of placing it while the store is preparing it. Once a rider is on the way it can no longer be cancelled. Contact support from the order page if something is wrong.',
      },
      {
        q: 'How do refunds work?',
        a: 'Money paid from your Wallet is refunded to your Wallet. Cash on delivery orders are not charged when they are cancelled. For a missing or wrong item, raise a ticket from the order page; approved refunds go to your Wallet.',
      },
    ],
  },
  {
    title: 'Local, Groceries and Services',
    items: [
      {
        q: 'What is in the Local, Groceries and Services tabs?',
        a: 'Local has In-Campus Booking and the stalls and shops near campus that deliver themselves. Groceries has Food and groceries and Deals. Services has PG stays, Co-Ride, Rentals, Campus events and Tech and repairs. Pick a section at the top of Groceries or Services. Your basket opens from the round button on Home and Local, and Profile from the round picture at the top left of Home.',
      },
      {
        q: 'How do repair and tech bookings work?',
        a: 'Book from the Services tab, Tech and repairs. Some jobs need a quote first; when it is ready you approve it in Orders, Services.',
      },
      {
        q: 'How do PG stays work?',
        a: 'Browse PGs near campus with rooms, mess menu, photos and reviews, then send a booking request. The PG confirms it with you, and you can follow it from the Services tab, PG stays.',
      },
    ],
  },
  {
    title: 'Campus',
    items: [
      {
        q: 'What is Campus?',
        a: 'Campus is the student side of ZENV, opened from the Campus button on Home. It has Chats, Friends (Pulse, Spaces, Forum, Tasks and Connect), Around campus (Lost and found, rides and rooms) and Me.',
      },
    ],
  },
  {
    title: 'Account and notifications',
    items: [
      {
        q: 'Why should I verify my student ID?',
        a: 'Rentals, Campus events and Campus are for verified students of your college. Verify once with your college email or ID card: tap Verify my college where a feature asks for it.',
      },
      {
        q: 'Can I choose which notifications I get?',
        a: 'Yes. In Profile, Notifications, switch Orders and deliveries, Offers, Campus activity and Reminders on or off. Chats, calls, Wallet and support replies always come through.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Profile has a Delete account option at the bottom. It explains what is removed before you confirm.',
      },
    ],
  },
  {
    title: 'Contact us',
    items: [
      {
        q: 'How do I reach ZENV support?',
        a: 'Raise a ticket in the Support centre and reply there when support answers. For a live order that needs help now, call or message the ZENV helpline from the Support centre.',
      },
    ],
  },
];
