// Help & FAQ content (app/help.tsx). Owner-editable: change the text here, keep it true to how the app
// works today. Plain sentence case, no emoji, no exclamation marks.
// Facts used below: food and grocery ordering 6 am to 9 pm IST; Cash on delivery and Zenvy Wallet only;
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
        a: 'Food and groceries can be ordered from 6 am to 9 pm. Outside these hours you can still browse, and the app shows when ordering opens again.',
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
        a: 'Pay with cash on delivery or with your ZCS Wallet. Card and UPI payments are not available in the app.',
      },
      {
        q: 'What is the ZCS Wallet?',
        a: 'Your Wallet holds refunds, rewards and credits. You can use the balance at checkout. Profile shows your balance and Wallet history.',
      },
    ],
  },
  {
    title: 'Delivery',
    items: [
      {
        q: 'What is the Delivery PIN?',
        a: 'Each order has a Delivery PIN on its tracking screen. Share it with the rider only when you have the order in your hands. After several wrong tries the PIN is locked for a while to keep your order safe.',
      },
      {
        q: 'Where is my order delivered?',
        a: 'To the address you confirm at checkout. Your saved hostel and room are filled in for you, and you can pick a saved place or type a different one.',
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
    title: 'Others',
    items: [
      {
        q: 'What is in Others?',
        a: 'Others has Food and groceries, Tech and repairs, PG stays, Co-Ride, Rentals, Campus events and Deals. Pick a section at the top of the Others tab.',
      },
      {
        q: 'How do repair and tech bookings work?',
        a: 'Book from Others, Tech and repairs. Some jobs need a quote first; when it is ready you approve it in Orders, Services.',
      },
      {
        q: 'How do PG stays work?',
        a: 'Browse PGs near campus with rooms, mess menu, photos and reviews, then send a booking request. The PG confirms it with you, and you can follow it from Others, PG stays.',
      },
    ],
  },
  {
    title: 'Campus',
    items: [
      {
        q: 'What is Campus?',
        a: 'Campus is the student side of ZCS, opened from the Campus button on Home. It has Chats, Friends (Pulse, Spaces, Forum, Tasks and Connect), Around campus (Lost and found, rides and rooms) and Me.',
      },
      {
        q: 'Why should I verify my student ID?',
        a: 'Most Campus features are for verified students of your campus. Verify once from Campus, Me, with your college email or ID card.',
      },
    ],
  },
  {
    title: 'Account and notifications',
    items: [
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
        q: 'How do I reach ZCS support?',
        a: 'Raise a ticket in the Support centre and reply there when support answers. For a live order that needs help now, call or message the ZCS helpline from the Support centre.',
      },
    ],
  },
];
