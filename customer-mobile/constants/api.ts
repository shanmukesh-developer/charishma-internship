// ── Zenvy Mobile API Config ──────────────────────────────────────────────────
// Same backend as the website — no backend changes needed.
export const API_URL = 'http://localhost:5005';

export const ENDPOINTS = {
  // Auth
  login: `${API_URL}/api/users/login`,
  register: `${API_URL}/api/users/register`,
  profile: `${API_URL}/api/users/profile`,
  forgotPassword: `${API_URL}/api/users/forgot-password`,

  // Restaurants
  restaurants: `${API_URL}/api/users/restaurants`,
  restaurantMenu: (id: string) => `${API_URL}/api/restaurants/${id}/menu`,
  restaurantClick: (id: string) => `${API_URL}/api/restaurants/${id}/click`,
  localVendors: `${API_URL}/api/restaurants/local-vendors`,

  // Orders
  placeOrder: `${API_URL}/api/orders`,
  myOrders: `${API_URL}/api/orders/myorders`,
  cancelOrder: (id: string) => `${API_URL}/api/orders/${id}/cancel`,
  rateOrder: (id: string) => `${API_URL}/api/orders/${id}/rate`,
  trackOrder: (id: string) => `${API_URL}/api/orders/${id}/track`,

  // Config
  config: `${API_URL}/api/users/config`,

  // Recommendations
  recommendations: `${API_URL}/api/features/recommendations`,

  // Support
  support: `${API_URL}/api/tickets`,

  // PG & Residences
  pgList: `${API_URL}/api/pg`,
  pgDetail: (id: string) => `${API_URL}/api/pg/${id}`,
  pgBook: (roomId: string) => `${API_URL}/api/pg/${roomId}/book`,

  // Co-Ride / Bikepool
  bikepoolPosts: `${API_URL}/api/bikepool/posts`,
  bikepoolMyRides: `${API_URL}/api/bikepool/my-rides`,
  bikepoolJoin: (id: string) => `${API_URL}/api/bikepool/posts/${id}/join`,
  bikepoolComplete: (id: string) => `${API_URL}/api/bikepool/posts/${id}/complete`,
  bikepoolCancel: (id: string) => `${API_URL}/api/bikepool/posts/${id}/cancel`,

  // Vault
  vaultList: `${API_URL}/api/vault`,
  vaultClaim: (id: string) => `${API_URL}/api/vault/claim/${id}`,

  // Challenges / BlockWars
  activeChallenge: `${API_URL}/api/features/challenges/active`,
  blockActivity: `${API_URL}/api/blocks/activity`,

  // Community / Gallery
  communityPosts: `${API_URL}/api/community`,
  communityReviews: `${API_URL}/api/community/reviews`,
  communityLike: (id: string) => `${API_URL}/api/community/${id}/like`,
  communityDelete: (id: string) => `${API_URL}/api/community/${id}`,
  uploadImage: `${API_URL}/api/upload`,
  
  // Mega Basket
  megaBasketList: `${API_URL}/api/mega-basket`,
  megaBasketCreate: `${API_URL}/api/mega-basket`,
  megaBasketPay: (id: string) => `${API_URL}/api/mega-basket/${id}/pay`,
  megaBasketApprove: (id: string) => `${API_URL}/api/mega-basket/${id}/approve`,

  // Birthdays
  birthdaysActive: `${API_URL}/api/birthdays/active`,
  birthdaysPending: `${API_URL}/api/birthdays/pending`,
  birthdaysSubmit: `${API_URL}/api/birthdays`,
  birthdaysApprove: (id: string) => `${API_URL}/api/birthdays/${id}/approve`,
  birthdaysReject: (id: string) => `${API_URL}/api/birthdays/${id}/reject`,
  birthdaysWish: (id: string) => `${API_URL}/api/birthdays/${id}/wish`,
  birthdaysWishes: (id: string) => `${API_URL}/api/birthdays/${id}/wishes`,

  // Friends & Secure Chat
  friendsList: `${API_URL}/api/friends`,
  friendsContacts: `${API_URL}/api/friends/contacts`,
  friendsRequest: `${API_URL}/api/friends/request`,
  friendsAccept: `${API_URL}/api/friends/accept`,
  friendsPending: `${API_URL}/api/friends/pending`,
  friendsTheme: (id: string) => `${API_URL}/api/friends/${id}/theme`,
  friendsSendMessage: `${API_URL}/api/friends/message`,
  friendsMessages: (convId: string) => `${API_URL}/api/friends/messages/${convId}`,
};

