import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getMessaging, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "dummy-api-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "dummy-auth-domain",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "dummy-project-id",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "dummy-sender-id",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "dummy-app-id",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Safe export for environments where messaging might not be supported (e.g. server-side Next.js)
export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;
export default app;
