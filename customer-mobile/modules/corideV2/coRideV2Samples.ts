/**
 * LAYOUT SAMPLES for the dev strip only (demo "samples"): production has no open rides right now, so the owner
 * can still review the ride cards, detail and My rides with content. Every sample carries isSample: true and
 * the cards say "Sample". Screens never fall back to these on their own.
 */
const inMin = (m: number) => new Date(Date.now() + m * 60000).toISOString();
/** The next 5:30 PM (IST): a realistic "home after college" time for the host sample. */
const next1730 = () => {
  const IST = 330 * 60000; const n = new Date(Date.now() + IST);
  let t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 17, 30) - IST;
  if (t < Date.now() + 15 * 60000) t += 86400000;
  return new Date(t).toISOString();
};
const person = (id: string, name: string, gender = 'Prefer not to say') => ({ id, name, gender, profileImage: null });

export function sampleRides() {
  return [
    { id: 'sample-1', isSample: true, creatorId: 'sample-h1', creatorRole: 'rider', origin: 'Hostel Sector', destination: 'Vijayawada Stn', departureTime: inMin(35), estimatedFuelCost: 120, vehicleType: 'Car', availableSeats: 3, autoApprove: false, rideVibe: 'Chatty 💬', vehicleInfo: 'White Swift AP 39 AB 1234', genderPreference: 'Any', notes: 'Small bag is fine', stopovers: ['Mangalagiri'], creator: person('sample-h1', 'Arjun Rao', 'Male') },
    { id: 'sample-2', isSample: true, creatorId: 'sample-h2', creatorRole: 'rider', origin: 'Campus Gate', destination: 'PVP Square Mall', departureTime: inMin(80), estimatedFuelCost: 50, vehicleType: 'Bike', availableSeats: 1, autoApprove: true, rideVibe: 'Any', vehicleInfo: 'Blue Activa', genderPreference: 'Same Gender Only', notes: '', creator: person('sample-h2', 'Meera Iyer', 'Female') },
    { id: 'sample-3', isSample: true, creatorId: 'sample-h3', creatorRole: 'rider', origin: 'Main Campus', destination: 'Guntur Bus Stand', departureTime: inMin(26 * 60), estimatedFuelCost: 0, vehicleType: 'Car', availableSeats: 2, autoApprove: false, rideVibe: 'Silent Ride 🤫', vehicleInfo: '', genderPreference: 'Any', notes: '', creator: person('sample-h3', 'Kiran Kumar', 'Male') },
    { id: 'sample-4', isSample: true, creatorId: 'sample-h4', creatorRole: 'passenger', origin: 'Hostel Sector', destination: 'Gannavaram Airport', departureTime: inMin(5 * 60), estimatedFuelCost: 300, vehicleType: 'Car', availableSeats: 1, autoApprove: false, rideVibe: 'Any', genderPreference: 'Any', notes: 'Flight at 9 PM', creator: person('sample-h4', 'Sana Shaik', 'Female') },
  ];
}

export function sampleMyRides(myId: string) {
  const me = person(myId, 'You');
  return [
    { id: 'sample-m1', isSample: true, creatorId: myId, creatorRole: 'rider', status: 'Available', origin: 'Main Campus', destination: 'Vijayawada Stn', departureTime: next1730(), estimatedFuelCost: 90, vehicleType: 'Car', availableSeats: 2, creator: me,
      requests: [
        { id: 'sample-r1', status: 'Pending', passengerId: 'sample-p1', passenger: person('sample-p1', 'Divya Reddy', 'Female') },
        { id: 'sample-r2', status: 'Pending', passengerId: 'sample-p2', passenger: person('sample-p2', 'Rahul Varma', 'Male') },
        { id: 'sample-r3', status: 'Approved', passengerId: 'sample-p3', passenger: { ...person('sample-p3', 'Nikhil Teja', 'Male'), phone: null } },
      ] },
    { id: 'sample-m2', isSample: true, creatorId: 'sample-h1', creatorRole: 'rider', status: 'Available', origin: 'Hostel Sector', destination: 'Vijayawada Stn', departureTime: inMin(35), estimatedFuelCost: 120, vehicleType: 'Car', availableSeats: 3, creator: person('sample-h1', 'Arjun Rao', 'Male'),
      requests: [{ id: 'sample-r4', status: 'Pending', passengerId: myId, passenger: me }] },
    { id: 'sample-m3', isSample: true, creatorId: 'sample-h2', creatorRole: 'rider', status: 'Completed', origin: 'Campus Gate', destination: 'PVP Square Mall', departureTime: inMin(-3 * 24 * 60), estimatedFuelCost: 50, vehicleType: 'Bike', availableSeats: 0, creator: person('sample-h2', 'Meera Iyer', 'Female'),
      requests: [{ id: 'sample-r5', status: 'Approved', passengerId: myId, passenger: me }] },
  ];
}

/** Shared-auto board sample (one stand with an auto on charge, seat map, and two autos waiting). */
export function sampleAutoLines(): any[] {
  const auto = (id: string, position: number, driver: string, reg: string, remaining: number, seats: [number, string][]) => ({
    id, position, isSample: true, status: 'OPEN_FOR_BOOKING', availability: 'AVAILABLE', availabilityLabel: '', mode: 'SHARED', capacity: 6,
    confirmedSeats: 6 - remaining, heldSeats: 0, boardedSeats: 0, remainingSeats: remaining, minSeatsToDepart: 3, queueNumber: position,
    departureAt: null, originalDepartureAt: null, delayMinutes: 0, version: 1,
    driver: { name: driver, firstName: driver, verified: true, photo: null, rating: null },
    vehicle: { registration: reg, registrationMasked: true, make: 'Bajaj', model: 'RE', colour: 'Green', fuel: 'CNG' },
    route: null, pickup: null, destination: 'Mangalagiri', stops: [], seatFare: 30, fullAutoFare: null,
    seatSelectionEnabled: false, sharedBookingAllowed: true, privateBookingAllowed: false, queueNote: '', myBookingId: null, myBookingStatus: null,
    seatMap: { layout: { rows: [['D', 1], [2, 3, 4], [5, null, 6]] }, seats: seats.map(([seatNo, state]) => ({ seatNo, state })), legend: [] },
  });
  return [{
    key: 'sample-stand', isSample: true, route: null, destination: 'Mangalagiri (sample)', seatFare: 30, waitingCount: 2, waiting: [],
    pickup: { id: 'sample-pp', name: 'Campus Gate stand', landmark: 'Near the main gate', lat: null, lon: null, mapsUrl: null },
    onCharge: auto('sample-a1', 1, 'Ramesh', 'AP •• T• ••41', 2, [[1, 'BOOKED'], [2, 'BOOKED'], [3, 'AVAILABLE'], [4, 'BOOKED'], [5, 'HELD'], [6, 'AVAILABLE']]),
    waitingAutos: [auto('sample-a2', 2, 'Suresh', 'AP •• T• ••07', 6, []), auto('sample-a3', 3, 'Prasad', 'AP •• T• ••19', 6, [])],
  }];
}
