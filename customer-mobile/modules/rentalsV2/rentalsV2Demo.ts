/**
 * Rentals v2 demo content (owner decision, 25 Oct 2026: "mock data with great images, to show users").
 *
 * One switch: RENTALS_V2_DEMO_CONTENT. While it is on, sample bikes, cars and flats fill the screens so the
 * section looks full while real listings are thin. Real data always wins and is listed first.
 * Every sample carries `isDemoContent: true`: the screens show a small "Sample" tag on it, and its Book Now
 * opens a polite "sample listing" sheet. Samples never reach a booking endpoint.
 * Prices are typical Indian student-market rates around Mangalagiri / Amaravati (Oct 2026).
 */
import type { ImageSourcePropType } from 'react-native';
import { DEMO_ART } from './rentalsV2Art';
import type { Category } from './rentalsV2Theme';

export const RENTALS_V2_DEMO_CONTENT = true;

export interface Feature { icon: FeatureIcon; label: string }
export type FeatureIcon = 'engine' | 'helmet' | 'doc' | 'wrench' | 'seats' | 'snow' | 'bluetooth' | 'shield' | 'fuel' | 'gauge'
  | 'wifi' | 'bath' | 'desk' | 'bed' | 'sofa' | 'kitchen' | 'parking' | 'power' | 'water' | 'home';

export interface DemoItem {
  slug: string;
  category: Category;
  tags: string[];
  title: string;
  /** Per day for vehicles, per month for flats. */
  price: number;
  priceWeek?: number;
  priceMonth?: number;
  deposit: number;
  rating: number;
  reviews: number;
  specs: string[];
  features: Feature[];
  area: string;
  distanceKm: number;
  owner: string;
  about: string;
  fuel?: 'Petrol' | 'Diesel' | 'Electric' | 'CNG';
  gear?: 'Manual' | 'Automatic';
  helmet?: boolean;
  kmPerDay?: number;
  createdAt: string;
  isDemoContent: true;
}

const v = (d: Omit<DemoItem, 'isDemoContent' | 'createdAt'> & { createdAt?: string }): DemoItem => ({ createdAt: '2026-10-20T10:00:00Z', ...d, isDemoContent: true });
const bikeFeatures = (cc: string, helmet: boolean): Feature[] => [
  { icon: 'engine', label: cc }, { icon: 'helmet', label: helmet ? 'Helmet included' : 'Bring a helmet' },
  { icon: 'doc', label: 'Valid RC' }, { icon: 'wrench', label: 'Well maintained' },
];
const carFeatures = (seats: number, extra: string): Feature[] => [
  { icon: 'seats', label: `${seats} seats` }, { icon: 'snow', label: 'AC' }, { icon: 'bluetooth', label: extra }, { icon: 'shield', label: 'ABS' },
];

export const DEMO_ITEMS: DemoItem[] = [
  // ── Bikes and scooters ──
  v({ slug: 'activa', category: 'bike', tags: ['scooter'], title: 'Honda Activa 6G', price: 349, priceWeek: 1999, priceMonth: 5499, deposit: 1500, rating: 4.8, reviews: 120, specs: ['Petrol', 'Automatic'], fuel: 'Petrol', gear: 'Automatic', helmet: true, kmPerDay: 120, features: bikeFeatures('109cc', true), area: 'Near SRM University', distanceKm: 0.6, owner: 'Rahul', about: 'Smooth, light and easy for city rides between campus, Neerukonda and Mangalagiri. Serviced last month, two helmets on request.', createdAt: '2026-10-24T09:00:00Z' }),
  v({ slug: 'jupiter', category: 'bike', tags: ['scooter'], title: 'TVS Jupiter', price: 329, priceWeek: 1899, priceMonth: 5199, deposit: 1500, rating: 4.7, reviews: 86, specs: ['Petrol', 'Automatic'], fuel: 'Petrol', gear: 'Automatic', helmet: true, kmPerDay: 120, features: bikeFeatures('110cc', true), area: 'Neerukonda', distanceKm: 1.4, owner: 'Sai Teja', about: 'Comfortable everyday scooter with a big under-seat boot. Ideal for grocery runs and daily college commute.' }),
  v({ slug: 'ntorq', category: 'bike', tags: ['scooter', 'sports'], title: 'TVS Ntorq 125', price: 399, priceWeek: 2299, priceMonth: 6299, deposit: 2000, rating: 4.8, reviews: 64, specs: ['Petrol', 'Automatic'], fuel: 'Petrol', gear: 'Automatic', helmet: true, kmPerDay: 140, features: bikeFeatures('124cc', true), area: 'Near SRM University', distanceKm: 0.9, owner: 'Karthik', about: 'Sporty 125cc scooter with quick pickup and a digital console. Great for weekend rides to Undavalli and Prakasam Barrage.' }),
  v({ slug: 'dio', category: 'bike', tags: ['scooter'], title: 'Honda Dio', price: 299, priceWeek: 1749, priceMonth: 4799, deposit: 1500, rating: 4.6, reviews: 52, specs: ['Petrol', 'Automatic'], fuel: 'Petrol', gear: 'Automatic', helmet: false, kmPerDay: 100, features: bikeFeatures('109cc', false), area: 'Mangalagiri', distanceKm: 8.6, owner: 'Priya', about: 'Bright, nimble scooter that is easy to park anywhere. Light enough for first-time riders.' }),
  v({ slug: 'ather', category: 'bike', tags: ['scooter', 'premium'], title: 'Ather 450X', price: 549, priceWeek: 3199, priceMonth: 8499, deposit: 3000, rating: 4.9, reviews: 41, specs: ['Electric', 'Automatic'], fuel: 'Electric', gear: 'Automatic', helmet: true, kmPerDay: 90, features: bikeFeatures('105 km range', true), area: 'Near SRM University', distanceKm: 0.7, owner: 'Ananya', about: 'Electric scooter with a touchscreen and navigation. Charged to 100% at pickup; home charger cable included.' }),
  v({ slug: 'splendor', category: 'bike', tags: ['commuter'], title: 'Hero Splendor Plus', price: 279, priceWeek: 1599, priceMonth: 4499, deposit: 1500, rating: 4.7, reviews: 98, specs: ['Petrol', 'Manual'], fuel: 'Petrol', gear: 'Manual', helmet: true, kmPerDay: 150, features: bikeFeatures('97cc', true), area: 'Tadepalli', distanceKm: 13.8, owner: 'Venkatesh', about: 'The most fuel-efficient way to get around. Simple, reliable, and cheap to run for long commutes.' }),
  v({ slug: 'fz', category: 'bike', tags: ['sports'], title: 'Yamaha FZ-S', price: 549, priceWeek: 3199, priceMonth: 8299, deposit: 3000, rating: 4.8, reviews: 57, specs: ['Petrol', 'Manual'], fuel: 'Petrol', gear: 'Manual', helmet: true, kmPerDay: 150, features: bikeFeatures('149cc', true), area: 'Near SRM University', distanceKm: 1.1, owner: 'Arjun', about: 'Street bike with a muscular stance and a smooth 150cc engine. Riding gloves available on request.' }),
  v({ slug: 'pulsar', category: 'bike', tags: ['sports'], title: 'Bajaj Pulsar NS200', price: 649, priceWeek: 3799, priceMonth: 9999, deposit: 3500, rating: 4.7, reviews: 39, specs: ['Petrol', 'Manual'], fuel: 'Petrol', gear: 'Manual', helmet: true, kmPerDay: 180, features: bikeFeatures('199cc', true), area: 'Mangalagiri', distanceKm: 8.9, owner: 'Nikhil', about: 'Sharp, sporty 200cc for experienced riders. Licence with gear (MCWG) required.' }),
  v({ slug: 'classic350', category: 'bike', tags: ['premium'], title: 'Royal Enfield Classic 350', price: 899, priceWeek: 5299, priceMonth: 13999, deposit: 5000, rating: 4.9, reviews: 73, specs: ['Petrol', 'Manual'], fuel: 'Petrol', gear: 'Manual', helmet: true, kmPerDay: 200, features: bikeFeatures('349cc', true), area: 'Near SRM University', distanceKm: 1.0, owner: 'Harsha', about: 'The classic thump for long weekend trips. Saddle bags and a phone mount included.' }),
  // ── Cars ──
  v({ slug: 'swift', category: 'car', tags: ['hatchback'], title: 'Maruti Swift', price: 1499, priceWeek: 8999, priceMonth: 27999, deposit: 5000, rating: 4.8, reviews: 112, specs: ['Petrol', 'Manual'], fuel: 'Petrol', gear: 'Manual', kmPerDay: 250, features: carFeatures(5, 'Bluetooth'), area: 'Near SRM University', distanceKm: 0.8, owner: 'Vamsi', about: 'Peppy, easy-to-drive hatchback for city trips and airport runs to Gannavaram. Clean interiors, music system with Bluetooth.' }),
  v({ slug: 'i20', category: 'car', tags: ['hatchback'], title: 'Hyundai i20', price: 1799, priceWeek: 10499, priceMonth: 32999, deposit: 6000, rating: 4.7, reviews: 68, specs: ['Petrol', 'Automatic'], fuel: 'Petrol', gear: 'Automatic', kmPerDay: 250, features: carFeatures(5, 'Bluetooth'), area: 'Neerukonda', distanceKm: 1.5, owner: 'Sneha', about: 'Premium hatchback with an automatic gearbox, rear camera and a quiet cabin. Easy for new drivers.' }),
  v({ slug: 'baleno', category: 'car', tags: ['hatchback'], title: 'Maruti Baleno', price: 1699, priceWeek: 9999, priceMonth: 30999, deposit: 5000, rating: 4.6, reviews: 47, specs: ['Petrol', 'Manual'], fuel: 'Petrol', gear: 'Manual', kmPerDay: 250, features: carFeatures(5, 'Bluetooth'), area: 'Mangalagiri', distanceKm: 9.1, owner: 'Ravi', about: 'Spacious hatchback with a big boot, perfect for moving-in day or a family visit.' }),
  v({ slug: 'city', category: 'car', tags: ['sedan'], title: 'Honda City', price: 2299, priceWeek: 13499, priceMonth: 41999, deposit: 8000, rating: 4.8, reviews: 59, specs: ['Petrol', 'Automatic'], fuel: 'Petrol', gear: 'Automatic', kmPerDay: 300, features: carFeatures(5, 'Cruise control'), area: 'Near SRM University', distanceKm: 1.2, owner: 'Aditya', about: 'Comfortable sedan for long drives to Vijayawada and Guntur. Automatic, with cruise control and rear AC vents.' }),
  v({ slug: 'nexon', category: 'car', tags: ['suv'], title: 'Tata Nexon', price: 2199, priceWeek: 12999, priceMonth: 39999, deposit: 8000, rating: 4.7, reviews: 44, specs: ['Diesel', 'Manual'], fuel: 'Diesel', gear: 'Manual', kmPerDay: 300, features: carFeatures(5, 'Bluetooth'), area: 'Tadepalli', distanceKm: 13.6, owner: 'Manoj', about: 'Five-star safety compact SUV with high ground clearance for village roads around Amaravati.' }),
  v({ slug: 'creta', category: 'car', tags: ['suv'], title: 'Hyundai Creta', price: 2799, priceWeek: 16499, priceMonth: 49999, deposit: 10000, rating: 4.9, reviews: 51, specs: ['Diesel', 'Automatic'], fuel: 'Diesel', gear: 'Automatic', kmPerDay: 300, features: carFeatures(5, 'Sunroof'), area: 'Near SRM University', distanceKm: 1.3, owner: 'Kiran', about: 'Roomy SUV with a sunroof and ventilated seats. Ideal for group trips on long weekends.' }),
  v({ slug: 'innova', category: 'car', tags: ['suv'], title: 'Toyota Innova Crysta', price: 3499, priceWeek: 20999, priceMonth: 62999, deposit: 12000, rating: 4.8, reviews: 36, specs: ['Diesel', 'Manual'], fuel: 'Diesel', gear: 'Manual', kmPerDay: 300, features: carFeatures(7, 'Rear AC'), area: 'Mangalagiri', distanceKm: 8.7, owner: 'Srinivas', about: 'Seven-seater for team trips and airport pickups with luggage. Captain seats in the middle row.' }),
  // ── Flats ──
  v({ slug: 'flat-1bhk-neerukonda', category: 'flat', tags: ['1bhk'], title: '1BHK near SRM main gate', price: 9500, deposit: 20000, rating: 4.7, reviews: 18, specs: ['Semi-furnished', 'Wi-Fi ready'], features: [{ icon: 'bed', label: '1 bedroom' }, { icon: 'kitchen', label: 'Kitchen' }, { icon: 'power', label: 'Power backup' }, { icon: 'water', label: '24h water' }], area: 'Neerukonda', distanceKm: 1.2, owner: 'Lakshmi', about: 'Bright 1BHK on the second floor, a short walk from the main gate. Wardrobe, geyser and ceiling fans in every room.' }),
  v({ slug: 'flat-1bhk-tadepalli', category: 'flat', tags: ['1bhk'], title: '1BHK with balcony', price: 8500, deposit: 17000, rating: 4.6, reviews: 11, specs: ['Furnished', 'Parking'], features: [{ icon: 'bed', label: '1 bedroom' }, { icon: 'sofa', label: 'Furnished' }, { icon: 'parking', label: 'Bike parking' }, { icon: 'water', label: '24h water' }], area: 'Tadepalli', distanceKm: 13.9, owner: 'Ramesh', about: 'Fully furnished 1BHK with a sit-out balcony, close to the Vijayawada highway and the bus stop.' }),
  v({ slug: 'flat-2bhk-mangalagiri', category: 'flat', tags: ['2bhk'], title: '2BHK family flat', price: 14000, deposit: 30000, rating: 4.8, reviews: 23, specs: ['Semi-furnished', 'Lift'], features: [{ icon: 'bed', label: '2 bedrooms' }, { icon: 'kitchen', label: 'Modular kitchen' }, { icon: 'parking', label: 'Car parking' }, { icon: 'power', label: 'Power backup' }], area: 'Mangalagiri', distanceKm: 8.8, owner: 'Padma', about: 'Spacious 2BHK in a gated block with a lift and covered parking. Good for two to four students sharing.' }),
  v({ slug: 'flat-2bhk-kaza', category: 'flat', tags: ['2bhk'], title: '2BHK in a gated community', price: 13000, deposit: 26000, rating: 4.7, reviews: 15, specs: ['Unfurnished', 'Security'], features: [{ icon: 'bed', label: '2 bedrooms' }, { icon: 'shield', label: '24h security' }, { icon: 'parking', label: 'Parking' }, { icon: 'water', label: '24h water' }], area: 'Kaza', distanceKm: 7.9, owner: 'Suresh', about: 'Quiet 2BHK with CCTV, a security guard and a children’s park. Near the Kaza toll plaza on NH16.' }),
  v({ slug: 'flat-house-nidamarru', category: 'flat', tags: ['independent'], title: 'Independent house with garden', price: 18000, deposit: 40000, rating: 4.9, reviews: 9, specs: ['Furnished', 'Garden'], features: [{ icon: 'home', label: 'Independent' }, { icon: 'bed', label: '3 bedrooms' }, { icon: 'parking', label: 'Car parking' }, { icon: 'sofa', label: 'Furnished' }], area: 'Nidamarru', distanceKm: 6.8, owner: 'Venkata Rao', about: 'Independent house with a lawn and a private gate, ideal for a group of friends. Owner lives nearby for help.' }),
];

export const demoArt = (slug: string): { cut: ImageSourcePropType | null; gallery: ImageSourcePropType[] } => {
  const a = DEMO_ART[slug];
  return a ? { cut: a.cut, gallery: a.gallery } : { cut: null, gallery: [] };
};
