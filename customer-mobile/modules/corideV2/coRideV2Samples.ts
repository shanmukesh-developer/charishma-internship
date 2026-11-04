/**
 * Co-Ride: no sample rides (owner, 3 Nov 2026: "remove mock data from everywhere in the entire project"). The dev
 * strip's "samples" view used to fill the ride cards, My rides and the shared-auto board with invented people and
 * autos; it now shows the same empty lists as production. The exports stay so coRideV2Data's imports are unchanged.
 */
export function sampleRides(): any[] {
  return [];
}

export function sampleMyRides(_myId: string): any[] {
  return [];
}

export function sampleAutoLines(): any[] {
  return [];
}
